import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { generateText } from 'ai';
import { assistantModelStatus, getAssistantModel } from './assistantModel.js';

const originalBaseURL = process.env.OLLAMA_BASE_URL;
const originalModel = process.env.OLLAMA_MODEL;

test.after(() => {
  if (originalBaseURL === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = originalBaseURL;
  if (originalModel === undefined) delete process.env.OLLAMA_MODEL;
  else process.env.OLLAMA_MODEL = originalModel;
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
