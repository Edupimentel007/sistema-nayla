import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
const DEFAULT_MODEL = 'qwen3:8b';

export type AssistantModelStatus = {
  aiAvailable: boolean;
  provider: 'ollama';
  model: string;
  reason?: 'server_offline' | 'model_missing' | 'invalid_config';
};

function config() {
  const model = process.env.OLLAMA_MODEL?.trim() || DEFAULT_MODEL;
  const rawBaseURL = process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_BASE_URL;
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

export function getAssistantModel(): LanguageModel | null {
  const settings = config();
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
  const settings = config();
  const model = process.env.OLLAMA_MODEL?.trim() || DEFAULT_MODEL;
  if (!settings) return { aiAvailable: false, provider: 'ollama', model, reason: 'invalid_config' };
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
