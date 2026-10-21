import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { generateText } from 'ai';
import { assistantModelStatus, getAssistantModel } from './assistantModel.js';

const originalBaseURL = process.env.OLLAMA_BASE_URL;
const originalModel = process.env.OLLAMA_MODEL;
const originalProvider = process.env.AI_PROVIDER;
const originalGroqKey = process.env.GROQ_API_KEY;
const originalGroqModel = process.env.GROQ_MODEL;

process.env.AI_PROVIDER = 'ollama';

test.after(() => {
  if (originalBaseURL === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = originalBaseURL;
  if (originalModel === undefined) delete process.env.OLLAMA_MODEL;
  else process.env.OLLAMA_MODEL = originalModel;
  if (originalProvider === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = originalProvider;
  if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalGroqKey;
  if (originalGroqModel === undefined) delete process.env.GROQ_MODEL;
  else process.env.GROQ_MODEL = originalGroqModel;
});

test('rejects a remote Ollama endpoint before contacting it', async () => {
  process.env.OLLAMA_BASE_URL = 'https://ollama.com/v1';
  assert.equal(getAssistantModel(), null);
  assert.deepEqual(await assistantModelStatus(), {
    aiAvailable: false, provider: 'ollama', model: 'qwen3:8b', reason: 'invalid_config',
  });
});

test('reports a missing local model and an unavailable local server', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ models: [{ name: 'other:latest' }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível');
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.OLLAMA_MODEL = 'qwen3:8b';
  assert.deepEqual(await assistantModelStatus(), {
    aiAvailable: false, provider: 'ollama', model: 'qwen3:8b', reason: 'model_missing',
  });
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  assert.deepEqual(await assistantModelStatus(), {
    aiAvailable: false, provider: 'ollama', model: 'qwen3:8b', reason: 'server_offline',
  });
});

test('detects local model availability and generates through the local chat endpoint', async () => {
  const paths: string[] = [];
  const server = createServer(async (request, response) => {
    paths.push(request.url || '');
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/tags') {
      response.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }));
      return;
    }
    if (request.url === '/v1/chat/completions') {
      response.end(JSON.stringify({
        id: 'local-chat', object: 'chat.completion', created: 1, model: 'qwen3:8b',
        choices: [{ index: 0, finish_reason: 'stop', message: {
          role: 'assistant', content: 'Olá, sou a Nayla.',
        } }],
        usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
      }));
      return;
    }
    response.writeHead(404);
    response.end('{}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível');
    process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
    process.env.OLLAMA_MODEL = 'qwen3:8b';
    assert.deepEqual(await assistantModelStatus(), {
      aiAvailable: true, provider: 'ollama', model: 'qwen3:8b',
    });
    const model = getAssistantModel();
    assert.ok(model);
    const result = await generateText({ model, prompt: 'Apresente-se.' });
    assert.equal(result.text, 'Olá, sou a Nayla.');
    assert.deepEqual(paths, ['/api/tags', '/v1/chat/completions']);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('Groq requires a server key and a currently allowed Free plan model', async () => {
  process.env.AI_PROVIDER = 'groq';
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_MODEL;
  assert.equal(getAssistantModel(), null);
  assert.deepEqual(await assistantModelStatus(), {
    aiAvailable: false, provider: 'groq', model: 'openai/gpt-oss-120b',
    reason: 'not_configured',
  });

  process.env.GROQ_API_KEY = 'test-secret-for-unit-only';
  process.env.GROQ_MODEL = 'llama-3.3-70b-versatile';
  assert.equal(getAssistantModel(), null);
  assert.deepEqual(await assistantModelStatus(), {
    aiAvailable: false, provider: 'groq', model: 'openai/gpt-oss-120b',
    reason: 'invalid_config',
  });

  process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
  process.env.GROQ_API_KEY = 'key-with\r\nheaders';
  assert.equal(getAssistantModel(), null);
  assert.equal((await assistantModelStatus()).reason, 'invalid_config');
  process.env.AI_PROVIDER = 'ollama';
});

test('Groq status and generation use only its fixed HTTPS API and keep the key out of status', async () => {
  const fetchBefore = globalThis.fetch;
  const requests: Array<{ url: string; authorization: string | null; body?: string }> = [];
  process.env.AI_PROVIDER = 'groq';
  process.env.GROQ_API_KEY = 'test-secret-for-unit-only';
  delete process.env.GROQ_MODEL;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get('authorization');
    requests.push({ url, authorization, body: init?.body?.toString() });
    if (url === 'https://api.groq.com/openai/v1/models') {
      return Response.json({ data: [{ id: 'openai/gpt-oss-120b' }] });
    }
    if (url === 'https://api.groq.com/openai/v1/chat/completions') {
      return Response.json({
        id: 'groq-chat', object: 'chat.completion', created: 1,
        model: 'openai/gpt-oss-120b',
        choices: [{ index: 0, finish_reason: 'stop', message: {
          role: 'assistant', content: 'Olá, sou a Nayla.',
        } }],
        usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
      });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    const status = await assistantModelStatus();
    assert.deepEqual(status, {
      aiAvailable: true, provider: 'groq', model: 'openai/gpt-oss-120b',
    });
    assert.doesNotMatch(JSON.stringify(status), /test-secret-for-unit-only/);
    const model = getAssistantModel();
    assert.ok(model);
    assert.equal((await generateText({ model, prompt: 'Apresente-se.' })).text,
      'Olá, sou a Nayla.');
    assert.deepEqual(requests.map(request => request.url), [
      'https://api.groq.com/openai/v1/models',
      'https://api.groq.com/openai/v1/chat/completions',
    ]);
    assert.ok(requests.every(request => request.authorization ===
      'Bearer test-secret-for-unit-only'));
    assert.equal(JSON.parse(requests[1].body || '{}').model, 'openai/gpt-oss-120b');
  } finally {
    globalThis.fetch = fetchBefore;
    process.env.AI_PROVIDER = 'ollama';
  }
});

test('Groq does not claim availability when the provider rejects the key', async () => {
  const fetchBefore = globalThis.fetch;
  process.env.AI_PROVIDER = 'groq';
  process.env.GROQ_API_KEY = 'test-secret-for-unit-only';
  delete process.env.GROQ_MODEL;
  globalThis.fetch = async () => new Response('{}', { status: 401 });
  try {
    assert.deepEqual(await assistantModelStatus(), {
      aiAvailable: false, provider: 'groq', model: 'openai/gpt-oss-120b',
      reason: 'provider_unavailable',
    });
  } finally {
    globalThis.fetch = fetchBefore;
    process.env.AI_PROVIDER = 'ollama';
  }
});
