import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createPortServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { catalog } from './catalog.js';

type ModelCall = {
  toolNames: string[];
  messages: Array<{ role?: string; content?: unknown }>;
  requestChars: number;
};
let api: ChildProcessWithoutNullStreams;
let ollama: Server;
let directory: string;
let baseUrl: string;
let apiOutput = '';
const modelCalls: ModelCall[] = [];

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

function shiftedDate(days: number) {
  const date = new Date(`${saoPauloDate()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function registerOwner(suffix: string) {
  const registered = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
    ownerName: 'Ana Silva', businessName: 'Estúdio Ana', slug: `estudio-ana-${suffix}`,
    email: `ana-${suffix}@example.test`, password: 'SenhaMuitoForte123', specialties: ['unhas'],
    selectedServices: catalog.filter(item => item.category === 'unhas').map(item => item.id),
  }) });
  assert.equal(registered.status, 201);
  assert.ok(registered.cookie);
  return registered.cookie;
}

const model = 'nayla-qwen3:4b-cpu';
const completion = (id: string, content: string) => ({
  id, object: 'chat.completion', created: 1, model,
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
});

describe('Nayla AI sends only relevant tenant data and tools', () => {
  before(async () => {
    directory = mkdtempSync(join(tmpdir(), 'nayla-assistant-integration-'));
    ollama = createServer(async (req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') {
        res.end(JSON.stringify({ models: [{ name: model }] }));
        return;
      }
      if (req.url !== '/v1/chat/completions') {
        res.writeHead(404);
        res.end('{}');
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = JSON.parse(raw) as {
        tools?: Array<{ function?: { name?: string } }>;
        messages?: Array<{ role?: string; content?: unknown }>;
      };
      const call: ModelCall = {
        toolNames: (body.tools || []).map(item => item.function?.name || ''),
        messages: body.messages || [], requestChars: raw.length,
      };
      modelCalls.push(call);
      if (call.messages.some(item => item.role === 'tool')) {
        res.end(JSON.stringify(completion('finance-details',
          'Consulta realizada; nos últimos 7 dias, o faturamento registrado foi R$ 123,45.')));
        return;
      }
      if (call.toolNames.length) {
        const current = String(call.messages.at(-1)?.content || '');
        const toolName = call.toolNames[0];
        const displayedDate = current.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
        const exactDate = displayedDate
          ? `${displayedDate[3]}-${displayedDate[2].padStart(2, '0')}-${displayedDate[1].padStart(2, '0')}`
          : '';
        const args = toolName === 'consultar_clientes_frequentes'
          ? { period: 'previousMonth' }
          : toolName === 'consultar_agenda' && current.includes('amanhã')
            ? { period: 'tomorrow' }
            : toolName === 'consultar_agenda' && current.includes('ontem')
              ? { period: 'custom', from: shiftedDate(-1), to: shiftedDate(-1), status: 'no_show' }
              : toolName === 'consultar_agenda' && exactDate
                ? { period: 'custom', from: exactDate, to: exactDate }
                : { period: 'last7' };
        res.end(JSON.stringify({
          id: 'finance-tool', object: 'chat.completion', created: 1, model,
          choices: [{ index: 0, finish_reason: 'tool_calls', message: {
            role: 'assistant', content: null, tool_calls: [{
              id: 'call_financeiro_1', type: 'function', function: {
                name: toolName, arguments: JSON.stringify(args),
              },
            }],
          } }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        }));
        return;
      }
      const current = String(call.messages.at(-1)?.content || '');
      res.end(JSON.stringify(current.includes('faturamento de hoje')
        ? completion('today-revenue', 'Hoje seu faturamento registrado é R$ 123,45.')
        : completion('free-chat', 'Convide a cliente a agendar o retorno e registre suas preferências.')));
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
        OLLAMA_BASE_URL: `http://127.0.0.1:${address.port}/v1`, OLLAMA_MODEL: model,
        GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', MERCADO_PAGO_ACCESS_TOKEN: '',
        WHATSAPP_MODE: 'simulate',
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
    if (directory && dirname(resolve(directory)) === resolve(tmpdir()) &&
        /^nayla-assistant-integration-[a-zA-Z0-9]{6}$/.test(basename(directory)))
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  it('answers a current fact and open advice without tools, then queries a detailed period',
    { timeout: 20_000 }, async () => {
      const cookie = await registerOwner('ia-test');
      const status = await request('/api/assistant/status', {}, cookie);
      assert.equal(status.status, 200);
      assert.equal(status.body.aiAvailable, true);
      const created = await request('/api/finance', { method: 'POST', body: JSON.stringify({
        type: 'income', description: 'Manicure recebida', category: 'Serviço',
        amount: 123.45, date: saoPauloDate(),
      }) }, cookie);
      assert.equal(created.status, 201);

      const today = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Quanto foi meu faturamento de hoje?',
      }) }, cookie);
      assert.equal(today.status, 200);
      assert.equal(today.body.mode, 'instant');
      assert.match(today.body.answer, /123,45/);
      assert.equal(modelCalls.length, 0);

      const month = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Quanto faturei este mês?',
      }) }, cookie);
      assert.equal(month.status, 200);
      assert.equal(month.body.mode, 'instant');
      assert.match(month.body.answer, /123,45/);
      assert.equal(modelCalls.length, 0);

      const todayAgenda = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Quais são os atendimentos de hoje?',
      }) }, cookie);
      assert.equal(todayAgenda.status, 200);
      assert.equal(todayAgenda.body.mode, 'instant');
      assert.match(todayAgenda.body.answer, /hoje/i);
      assert.equal(modelCalls.length, 0);

      const advice = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Sou manicure. Como posso aumentar o retorno das clientes sem reduzir preços?',
      }) }, cookie);
      assert.equal(advice.status, 200);
      assert.equal(advice.body.mode, 'ai');
      assert.match(advice.body.answer, /retorno/);
      assert.deepEqual(modelCalls[0].toolNames, []);
      assert.ok(modelCalls[0].requestChars < 4500, `Prompt livre: ${modelCalls[0].requestChars} caracteres`);
      assert.match(String(modelCalls[0].messages.find(item => item.role === 'user')?.content), /orientacaoDaArea/);
      assert.match(String(modelCalls[0].messages.at(-1)?.content), /\/no_think/);

      const details = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Qual foi meu faturamento nos últimos 7 dias?',
      }) }, cookie);
      assert.equal(details.status, 200);
      assert.equal(details.body.mode, 'ai');
      assert.match(details.body.answer, /123,45/);
      assert.deepEqual(modelCalls[1].toolNames, ['consultar_financeiro']);
      assert.deepEqual(modelCalls[2].toolNames, ['consultar_financeiro']);
      assert.match(JSON.stringify(modelCalls[2].messages.filter(item => item.role === 'tool')), /123\.45/);
      assert.equal(modelCalls.length, 3);
  });

  it('routes tomorrow, a written date and yesterday absence to the agenda query',
    { timeout: 20_000 }, async () => {
      const cookie = await registerOwner('agenda-test');
      const tomorrow = shiftedDate(1);
      const written = tomorrow.split('-').reverse().join('/');
      const cases = [
        { message: 'Que clientes tenho amanhã?', period: 'tomorrow' },
        { message: `Que clientes tenho em ${written}?`, period: 'custom' },
        { message: 'Quem faltou ontem?', period: 'custom' },
      ];
      for (const item of cases) {
        const start = modelCalls.length;
        const answered = await request('/api/assistant', { method: 'POST',
          body: JSON.stringify({ message: item.message }) }, cookie);
        assert.equal(answered.status, 200);
        assert.equal(answered.body.mode, 'ai');
        assert.deepEqual(modelCalls[start].toolNames, ['consultar_agenda']);
        const result = JSON.parse(String(modelCalls[start + 1].messages
          .find(message => message.role === 'tool')?.content));
        assert.equal(result.range.period, item.period);
      }
    });

  it('keeps the requested period on ticket follow-up and queries frequent clients in the prior month',
    { timeout: 20_000 }, async () => {
      const cookie = await registerOwner('analytics-test');
      const start = modelCalls.length;
      const ticket = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'E nos últimos 90 dias?', history: [{ role: 'user',
          text: 'Qual foi meu ticket médio nos últimos 30 dias?' }],
      }) }, cookie);
      assert.equal(ticket.status, 200);
      assert.equal(ticket.body.mode, 'ai');
      assert.deepEqual(modelCalls[start].toolNames, []);
      const context = String(modelCalls[start].messages.find(item => item.role === 'user')?.content);
      assert.match(context, /Nos últimos 90 dias/);
      assert.match(context, /ticket médio/i);
      assert.doesNotMatch(context, /Nos últimos 30 dias/);

      const ranked = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Quem foram as clientes que mais vieram no mês passado?',
      }) }, cookie);
      assert.equal(ranked.status, 200);
      assert.equal(ranked.body.mode, 'ai');
      assert.deepEqual(modelCalls[start + 1].toolNames, ['consultar_clientes_frequentes']);
      assert.doesNotMatch(String(modelCalls[start + 1].messages.find(item => item.role === 'user')?.content),
        /"analise"/);
      const result = JSON.parse(String(modelCalls[start + 2].messages
        .find(item => item.role === 'tool')?.content));
      assert.equal(result.range.period, 'previousMonth');
    });

  it('includes product guidance when asked how to use Nayla', { timeout: 20_000 }, async () => {
    const cookie = await registerOwner('help-test');
    const start = modelCalls.length;
    const answered = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
      message: 'Como uso a Nayla?',
    }) }, cookie);
    assert.equal(answered.status, 200);
    assert.equal(answered.body.mode, 'ai');
    assert.deepEqual(modelCalls[start].toolNames, []);
    const context = String(modelCalls[start].messages.find(item => item.role === 'user')?.content);
    assert.match(context, /ajudaApp/);
    assert.match(context, /\/app\/assistente/);
  });
});
