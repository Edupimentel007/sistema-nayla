import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

const OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';
const OLLAMA_MODEL = 'qwen3:8b';
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const GROQ_MODEL = 'openai/gpt-oss-120b';
// These IDs are listed in Groq's current Free plan limits. An arbitrary model
// ID must not let a configuration typo silently select a paid-only model.
const GROQ_FREE_MODELS = new Set([
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
]);

export type AssistantModelStatus = {
  aiAvailable: boolean;
  provider: 'ollama' | 'groq';
  model: string;
  reason?: 'server_offline' | 'model_missing' | 'invalid_config'
    | 'not_configured' | 'provider_unavailable';
};

function provider() {
  const selected = process.env.AI_PROVIDER?.trim().toLowerCase();
  return selected === undefined || selected === '' || selected === 'ollama'
    ? 'ollama' : selected;
}

function ollamaConfig() {
  const model = process.env.OLLAMA_MODEL?.trim() || OLLAMA_MODEL;
  const rawBaseURL = process.env.OLLAMA_BASE_URL?.trim() || OLLAMA_BASE_URL;
  try {
    const url = new URL(rawBaseURL);
    // The app only talks to an Ollama process on the same server. A public or
    // user-controlled URL could send private client and financial data away.
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash
      || url.pathname.replace(/\/$/, '') !== '/v1'
      || !/^[a-z0-9][a-z0-9._:-]{0,99}$/i.test(model)
      || /(?:^|[:_-])cloud(?:$|[:_-])/i.test(model)) return null;
    return { baseURL: url.toString().replace(/\/$/, ''), model };
  } catch {
    return null;
  }
}

function groqConfig() {
  const rawKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL?.trim() || GROQ_MODEL;
  if (!rawKey) return { reason: 'not_configured' as const };
  // No custom endpoint is accepted. The key and assistant context go only to
  // Groq's documented HTTPS API, never to an address supplied by a client.
  if (rawKey !== rawKey.trim() || !/^[\x21-\x7e]{12,256}$/.test(rawKey)
    || !GROQ_FREE_MODELS.has(model)) return { reason: 'invalid_config' as const };
  return { key: rawKey, model };
}

export function getAssistantModel(): LanguageModel | null {
  if (provider() === 'groq') {
    const settings = groqConfig();
    if (!('key' in settings) || !settings.key) return null;
    return createOpenAI({
      name: 'groq',
      baseURL: GROQ_BASE_URL,
      apiKey: settings.key,
    }).chat(settings.model);
  }
  if (provider() !== 'ollama') return null;
  const settings = ollamaConfig();
  if (!settings) return null;
  // Ollama implements /v1/chat/completions. Its local endpoint ignores the
  // required placeholder API key; no paid model provider is contacted.
  return createOpenAI({
    name: 'ollama',
    baseURL: settings.baseURL,
    apiKey: 'ollama-local',
  }).chat(settings.model);
}

export async function assistantModelStatus(): Promise<AssistantModelStatus> {
  if (provider() === 'groq') {
    const settings = groqConfig();
    const model = 'model' in settings && settings.model && GROQ_FREE_MODELS.has(settings.model)
      ? settings.model : GROQ_MODEL;
    if ('reason' in settings) return {
      aiAvailable: false, provider: 'groq', model, reason: settings.reason,
    };
    try {
      const response = await fetch(`${GROQ_BASE_URL}/models`, {
        signal: AbortSignal.timeout(1500),
        headers: { authorization: `Bearer ${settings.key}`, accept: 'application/json' },
      });
      if (!response.ok) return {
        aiAvailable: false, provider: 'groq', model, reason: 'provider_unavailable',
      };
      const data = await response.json() as { data?: Array<{ id?: string }> };
      const available = Array.isArray(data.data) && data.data.some(item => item.id === model);
      return available
        ? { aiAvailable: true, provider: 'groq', model }
        : { aiAvailable: false, provider: 'groq', model, reason: 'model_missing' };
    } catch {
      return { aiAvailable: false, provider: 'groq', model, reason: 'provider_unavailable' };
    }
  }
  const settings = ollamaConfig();
  const model = process.env.OLLAMA_MODEL?.trim() || OLLAMA_MODEL;
  if (provider() !== 'ollama' || !settings) return {
    aiAvailable: false, provider: 'ollama', model, reason: 'invalid_config',
  };
  try {
    const base = new URL(settings.baseURL);
    const response = await fetch(new URL('/api/tags', base), {
      signal: AbortSignal.timeout(2500),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return { aiAvailable: false, provider: 'ollama', model, reason: 'server_offline' };
    const data = await response.json() as { models?: Array<{ name?: string; model?: string }> };
    const requestedNames = settings.model.includes(':')
      ? [settings.model] : [settings.model, `${settings.model}:latest`];
    const installed = Array.isArray(data.models) && data.models.some(item =>
      requestedNames.includes(item.name || item.model || ''));
    return installed
      ? { aiAvailable: true, provider: 'ollama', model }
      : { aiAvailable: false, provider: 'ollama', model, reason: 'model_missing' };
  } catch {
    return { aiAvailable: false, provider: 'ollama', model, reason: 'server_offline' };
  }
}
