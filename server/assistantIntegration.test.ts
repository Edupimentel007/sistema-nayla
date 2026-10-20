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

async function registerOwner(suffix: string,
  specialty: 'unhas' | 'cilios' | Array<'unhas' | 'cilios' | 'maquiagem' | 'massagens'> = 'unhas') {
  const specialties = Array.isArray(specialty) ? specialty : [specialty];
  const registered = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
    ownerName: 'Ana Silva', businessName: 'Estúdio Ana', slug: `estudio-ana-${suffix}`,
    email: `ana-${suffix}@example.test`, password: 'SenhaMuitoForte123', specialties,
    selectedServices: catalog.filter(item => specialties.some(area => area === item.category)).map(item => item.id),
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
      if (raw.includes('resposta lenta')) return;
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
      assert.equal(advice.body.mode, 'instant');
      assert.match(advice.body.answer, /Unhas/);
      assert.match(advice.body.answer, /sem base|ainda nÃ£o hÃ¡ base/i);
      assert.equal(modelCalls.length, 0);

      const open = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Como organizar uma conversa inicial para uma cliente que pergunta sobre alongamento em gel?',
      }) }, cookie);
      assert.equal(open.status, 200);
      assert.equal(open.body.mode, 'ai');
      assert.deepEqual(modelCalls[0].toolNames, []);
      assert.ok(modelCalls[0].requestChars < 5000, `Prompt livre: ${modelCalls[0].requestChars} caracteres`);
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

  it('gives specific business advice from the authenticated owner and requested period',
    { timeout: 20_000 }, async () => {
      const nails = await registerOwner('advice-nails');
      const lashes = await registerOwner('advice-lashes', 'cilios');
      assert.equal((await request('/api/finance', { method: 'POST', body: JSON.stringify({
        type: 'income', description: 'Recebimento recente', category: 'Serviço',
        amount: 137.15, date: saoPauloDate(),
      }) }, nails)).status, 201);
      assert.equal((await request('/api/finance', { method: 'POST', body: JSON.stringify({
        type: 'income', description: 'Recebimento antigo', category: 'Serviço',
        amount: 501.23, date: shiftedDate(-10),
      }) }, nails)).status, 201);
      assert.equal((await request('/api/finance', { method: 'POST', body: JSON.stringify({
        type: 'income', description: 'Outro espaço', category: 'Serviço',
        amount: 789.02, date: saoPauloDate(),
      }) }, lashes)).status, 201);
      const first = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Dicas para melhorar meu negócio nos últimos 7 dias',
      }) }, nails);
      assert.equal(first.status, 200);
      assert.equal(first.body.mode, 'instant');
      assert.match(first.body.answer, /137,15/);
      assert.match(first.body.answer, /Unhas/);
      assert.doesNotMatch(first.body.answer, /501,23|789,02|Cílios/);
      assert.match(first.body.answer, /7 dias/);

      const second = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Dicas para melhorar meu negócio',
      }) }, lashes);
      assert.equal(second.status, 200);
      assert.equal(second.body.mode, 'instant');
      assert.match(second.body.answer, /789,02/);
      assert.match(second.body.answer, /Cílios/);
      assert.doesNotMatch(second.body.answer, /137,15|501,23|Unhas/);

      const standoutNails = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Dicas de como posso me destacar no meu ramo',
      }) }, nails);
      const standoutLashes = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Dicas de como posso me destacar no meu ramo',
      }) }, lashes);
      assert.equal(standoutNails.status, 200);
      assert.equal(standoutLashes.status, 200);
      assert.match(standoutNails.body.answer, /destacar em Unhas/i);
      assert.match(standoutNails.body.answer, /portfólio por estilo|aplicação, manutenção e remoção/i);
      assert.match(standoutLashes.body.answer, /destacar em Cílios/i);
      assert.match(standoutLashes.body.answer, /fotos autorizadas por efeito|aplicação, manutenção e remoção/i);
      assert.notEqual(standoutNails.body.answer, standoutLashes.body.answer);
      assert.doesNotMatch(standoutNails.body.answer, /Não consegui concluir uma resposta confiável/i);

      const followup = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Como posso me diferenciar da concorrência?',
        conversationId: standoutNails.body.conversationId,
      }) }, nails);
      assert.equal(followup.status, 200);
      assert.match(followup.body.answer, /destacar em Unhas/i);

      const moreIdeas = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'e mais dicas?', conversationId: followup.body.conversationId,
      }) }, nails);
      assert.equal(moreIdeas.status, 200);
      assert.match(moreIdeas.body.answer, /Mais três ideias para Unhas/i);
      assert.notEqual(moreIdeas.body.answer, followup.body.answer);

      const recentStandout = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Dicas para me destacar e conseguir mais clientes nos últimos 7 dias',
      }) }, nails);
      assert.equal(recentStandout.status, 200);
      assert.match(recentStandout.body.answer, /7 dias/);
      assert.match(recentStandout.body.answer, /destacar em Unhas/i);
      assert.match(recentStandout.body.answer, /reserva/i);
      assert.doesNotMatch(recentStandout.body.answer, /501,23|789,02/);

      const acquisition = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Ideias para atrair clientes para meus serviços de unhas',
      }) }, nails);
      assert.equal(acquisition.status, 200);
      assert.match(acquisition.body.answer, /Unhas|unhas/i);
      assert.match(acquisition.body.answer, /agendar\/estudio-ana-advice-nails/);
      assert.notEqual(acquisition.body.answer, standoutNails.body.answer);

      const trends = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Quais tendências e novidades existem no meu ramo de unhas?',
      }) }, nails);
      assert.equal(trends.status, 200);
      assert.match(trends.body.answer, /novidades em Unhas/i);
      assert.match(trends.body.answer, /sem uma fonte externa atual|fonte externa/i);
      assert.doesNotMatch(trends.body.answer, /pesquisei|encontrei na internet/i);

      const thirdArea = await registerOwner('advice-third-area',
        ['unhas', 'cilios', 'maquiagem', 'massagens']);
      const targeted = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Como melhorar meu negócio de maquiagem?',
      }) }, thirdArea);
      assert.equal(targeted.status, 200);
      assert.equal(targeted.body.mode, 'instant');
      assert.match(targeted.body.answer, /Na sua área \(Maquiagem\)/);
      assert.doesNotMatch(targeted.body.answer, /Na sua área \(Unhas|Na sua área \(Cílios/);

      const targetedStandout = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Como me diferenciar na maquiagem?',
      }) }, thirdArea);
      assert.equal(targetedStandout.status, 200);
      assert.match(targetedStandout.body.answer, /destacar em Maquiagem/i);
      assert.doesNotMatch(targetedStandout.body.answer, /destacar em Unhas|destacar em Cílios/i);

      const financialAdvice = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Dicas para melhorar meu faturamento nos últimos 7 dias',
      }) }, nails);
      assert.equal(financialAdvice.status, 200);
      assert.equal(financialAdvice.body.mode, 'instant');
      assert.match(financialAdvice.body.answer, /137,15/);
      assert.doesNotMatch(financialAdvice.body.answer, /501,23|789,02/);

      const unrelated = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Como melhorar meu negócio de sobrancelhas?',
      }) }, nails);
      assert.equal(unrelated.status, 200);
      assert.match(unrelated.body.answer, /área citada.*não está selecionada/i);
      assert.doesNotMatch(unrelated.body.answer, /Na sua área \(Sobrancelhas\)/);
    });

  it('returns within 30 seconds when the model stalls, without using numbers from the wrong period',
    { timeout: 32_000 }, async () => {
      const cookie = await registerOwner('timeout-test');
      assert.equal((await request('/api/finance', { method: 'POST', body: JSON.stringify({
        type: 'income', description: 'Hoje apenas', category: 'Serviço',
        amount: 321.45, date: saoPauloDate(),
      }) }, cookie)).status, 201);
      const started = performance.now();
      const answer = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Qual foi meu faturamento no mês passado? resposta lenta',
      }) }, cookie);
      const elapsed = performance.now() - started;
      assert.equal(answer.status, 200);
      assert.equal(answer.body.mode, 'timeout');
      assert.ok(elapsed < 30_000, `Resposta demorou ${Math.round(elapsed)} ms`);
      assert.match(answer.body.answer, /não consegui consultar esse detalhe ou período/i);
      assert.doesNotMatch(answer.body.answer, /321,45/);
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
      const first = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Qual foi meu ticket médio nos últimos 30 dias?',
      }) }, cookie);
      assert.equal(first.status, 200);
      assert.match(first.body.conversationId, /^[0-9a-f-]{36}$/);
      const start = modelCalls.length;
      const ticket = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'E nos últimos 90 dias?', conversationId: first.body.conversationId,
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
