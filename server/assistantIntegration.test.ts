import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createPortServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { catalog } from './catalog.js';

let api: ChildProcessWithoutNullStreams;
let ollama: Server;
let directory: string;
let baseUrl: string;
let apiOutput = '';
let modelCalls = 0;
let firstRequestTools: string[] = [];
let toolResultPayload = '';

async function freePort() {
  const server = createPortServer();
  await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Porta de teste indisponível.');
  await new Promise<void>(closed => server.close(() => closed()));
  return address.port;
}

async function request(path: string, options: RequestInit = {}, cookie?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
  });
  return { status: response.status, body: await response.json() as Record<string, any>,
    cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

function saoPauloDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

describe('Nayla AI uses current tenant data through a model tool call', () => {
  before(async () => {
    directory = mkdtempSync(join(tmpdir(), 'nayla-assistant-integration-'));
    ollama = createServer(async (req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') {
        res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }));
        return;
      }
      if (req.url !== '/v1/chat/completions') {
        res.writeHead(404);
        res.end('{}');
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        tools?: Array<{ function?: { name?: string } }>;
        messages?: Array<{ role?: string; content?: unknown }>;
      };
      modelCalls += 1;
      if (modelCalls === 1) {
        firstRequestTools = (body.tools || []).map(item => item.function?.name || '');
        res.end(JSON.stringify({
          id: 'nayla-tool-request', object: 'chat.completion', created: 1, model: 'qwen3:8b',
          choices: [{ index: 0, finish_reason: 'tool_calls', message: {
            role: 'assistant', content: null, tool_calls: [{
              id: 'call_financeiro_1', type: 'function', function: {
                name: 'consultar_financeiro', arguments: '{"period":"today"}',
              },
            }],
          } }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        }));
        return;
      }
      toolResultPayload = JSON.stringify((body.messages || []).filter(item => item.role === 'tool'));
      res.end(JSON.stringify({
        id: 'nayla-final-answer', object: 'chat.completion', created: 2, model: 'qwen3:8b',
        choices: [{ index: 0, finish_reason: 'stop', message: {
          role: 'assistant', content: 'Hoje seu faturamento registrado é R$ 123,45.',
        } }],
        usage: { prompt_tokens: 130, completion_tokens: 12, total_tokens: 142 },
      }));
    });
    await new Promise<void>(ready => ollama.listen(0, '127.0.0.1', ready));
    const address = ollama.address();
    if (!address || typeof address === 'string') throw new Error('Porta Ollama indisponível.');
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    api = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: resolve('.'),
      env: { ...process.env, PORT: String(port), DATABASE_PATH: join(directory, 'nayla.sqlite'),
        NODE_ENV: 'test', APP_ORIGIN: baseUrl, OPENAI_API_KEY: '',
        OLLAMA_BASE_URL: `http://127.0.0.1:${address.port}/v1`, OLLAMA_MODEL: 'qwen3:8b',
        GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', WHATSAPP_MODE: 'simulate',
        WHATSAPP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') },
    });
    api.stdout.on('data', chunk => { apiOutput += String(chunk); });
    api.stderr.on('data', chunk => { apiOutput += String(chunk); });
    for (let attempt = 0; attempt < 150; attempt++) {
      try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; }
      catch { /* server still starting */ }
      if (api.exitCode !== null) break;
      await new Promise(wait => setTimeout(wait, 100));
    }
    throw new Error(`Nayla API did not start: ${apiOutput}`);
  }, { timeout: 25_000 });

  after(async () => {
    if (api && api.exitCode === null) {
      api.kill();
      await Promise.race([
        new Promise<void>(done => api.once('exit', () => done())),
        new Promise<void>(done => setTimeout(done, 3000)),
      ]);
    }
    if (ollama) {
      ollama.closeAllConnections();
      await new Promise<void>(done => ollama.close(() => done()));
    }
    if (directory?.startsWith(join(tmpdir(), 'nayla-assistant-integration-')))
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  it('reads a newly saved financial entry and returns the model answer', { timeout: 20_000 }, async () => {
    const registered = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
      ownerName: 'Ana Silva', businessName: 'Estúdio Ana', slug: 'estudio-ana-ia-test',
      email: 'ana-ia@example.test', password: 'SenhaMuitoForte123', specialties: ['unhas'],
      selectedServices: catalog.filter(item => item.category === 'unhas').map(item => item.id),
    }) });
    assert.equal(registered.status, 201);
    assert.ok(registered.cookie);
    const cookie = registered.cookie;
    const status = await request('/api/assistant/status', {}, cookie);
    assert.equal(status.status, 200);
    assert.equal(status.body.aiAvailable, true);
    const created = await request('/api/finance', { method: 'POST', body: JSON.stringify({
      type: 'income', description: 'Manicure recebida', category: 'Serviço',
      amount: 123.45, date: saoPauloDate(),
    }) }, cookie);
    assert.equal(created.status, 201);
    const answered = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
      message: 'Quanto foi meu faturamento de hoje?',
    }) }, cookie);
    assert.equal(answered.status, 200, JSON.stringify(answered.body));
    assert.equal(answered.body.mode, 'ai', JSON.stringify(answered.body));
    assert.match(answered.body.answer, /123,45/);
    assert.ok(firstRequestTools.includes('consultar_financeiro'));
    assert.equal(modelCalls, 2);
    assert.match(toolResultPayload, /123\.45/);
  });
});
