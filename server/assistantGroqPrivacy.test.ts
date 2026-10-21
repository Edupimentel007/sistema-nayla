import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let directory: string;
let database: typeof import('./db.js');
let assistant: typeof import('./assistant.js');
let quota: typeof import('./assistantQuota.js');
let originalFetch: typeof fetch;
const requests: string[] = [];
let failNextCompletion = false;

describe('Nayla hosted model privacy and advice', () => {
  before(async () => {
    directory = mkdtempSync(join(tmpdir(), 'nayla-groq-privacy-'));
    process.env.DATABASE_PATH = join(directory, 'nayla.sqlite');
    process.env.AI_PROVIDER = 'groq';
    process.env.GROQ_API_KEY = 'gsk_testabcdefghijklmnop';
    process.env.NAYLA_EXTERNAL_RESEARCH = 'off';
    process.env.NODE_ENV = 'test';
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === 'https://api.groq.com/openai/v1/models')
        return Response.json({ data: [{ id: 'openai/gpt-oss-120b' }] });
      if (url === 'https://api.groq.com/openai/v1/chat/completions') {
        const body = String(init?.body || '');
        requests.push(body);
        if (failNextCompletion) {
          failNextCompletion = false;
          throw new Error('Provider unavailable');
        }
        return Response.json({
          id: `chat-${requests.length}`, object: 'chat.completion', created: 1,
          model: 'openai/gpt-oss-120b',
          choices: [{ index: 0, finish_reason: 'stop', message: {
            role: 'assistant', content: requests.length === 1
              ? 'Para se destacar, mostre os resultados de manicure, facilite o agendamento e acompanhe o retorno das clientes.'
              : 'A próxima cliente é NAYLA_CLIENTE_1.',
          } }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        });
      }
      throw new Error(`Unexpected external fetch: ${url}`);
    }) as typeof fetch;
    database = await import('./db.js');
    assistant = await import('./assistant.js');
    quota = await import('./assistantQuota.js');
    database.db.prepare(`INSERT INTO businesses(id,slug,name,specialties)
      VALUES('b1','estudio-ana','Estúdio Ana','["unhas"]')`).run();
    database.db.prepare(`INSERT INTO businesses(id,slug,name,specialties)
      VALUES('b2','outro-espaco','Outro Espaço','["cilios"]')`).run();
    database.db.prepare(`INSERT INTO users
      (id,business_id,role,name,phone,cpf,password_hash)
      VALUES('u1','b1','client','José Almeida','11988887777','12345678909','hash')`).run();
    database.db.prepare(`INSERT INTO services
      (id,business_id,name,category,duration_minutes,price_cents)
      VALUES('s1','b1','Manicure','unhas',60,10000)`).run();
    const tomorrow = new Date(`${database.localNow().date}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    database.db.prepare(`INSERT INTO appointments
      (id,business_id,client_id,service_id,date,start_time,end_time,status,price_cents)
      VALUES('a1','b1','u1','s1',?,'10:00','11:00','confirmed',10000)`)
      .run(tomorrow.toISOString().slice(0, 10));
  });

  after(() => {
    globalThis.fetch = originalFetch;
    delete process.env.AI_PROVIDER;
    delete process.env.GROQ_API_KEY;
    delete process.env.NAYLA_EXTERNAL_RESEARCH;
    database?.db.close();
    if (directory?.startsWith(join(tmpdir(), 'nayla-groq-privacy-')))
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  it('uses the hosted model for useful business advice without client identifiers', async () => {
    const reply = await assistant.answerAssistant('b1', 'Como posso me destacar no ramo de unhas?');
    assert.equal(reply.mode, 'ai');
    assert.match(reply.answer, /mostre os resultados de manicure/i);
    assert.equal(requests.length, 1);
    assert.match(requests[0], /recomendacaoLocal/);
    assert.match(requests[0], /NAYLA_LINK_AGENDAMENTO/);
    assert.doesNotMatch(requests[0], /estudio-ana|Estúdio Ana/i);
    assert.doesNotMatch(requests[0], /José Almeida|11988887777|12345678909/);
  });

  it('anonymizes named clients in prompt and history, then restores names in answer', async () => {
    const reply = await assistant.answerAssistant('b1',
      'Qual é minha próxima cliente e por que esse horário é importante? José Almeida, telefone 11988887777.',
      [{ role: 'user', text: 'A José Almeida tem CPF 123.456.789-09?' }]);
    assert.equal(reply.mode, 'ai');
    assert.match(reply.answer, /José Almeida/);
    assert.equal(requests.length, 2);
    assert.match(requests[1], /NAYLA_CLIENTE_1/);
    assert.doesNotMatch(requests[1],
      /José Almeida|11988887777|123\.456\.789-09|12345678909/);
  });

  it('reserves a daily slot atomically and releases it after provider failure', async () => {
    database.db.prepare('DELETE FROM assistant_ai_daily_usage WHERE business_id=?').run('b1');
    database.db.prepare('DELETE FROM assistant_ai_global_usage').run();
    process.env.NAYLA_GROQ_DAILY_LIMIT = '1';
    process.env.NAYLA_GROQ_GLOBAL_DAILY_LIMIT = '1';
    try {
      const question = 'Como posso me destacar no ramo de unhas?';
      const first = await assistant.answerAssistant('b1', question);
      assert.equal(first.mode, 'ai');
      const sent = requests.length;
      const limited = await assistant.answerAssistant('b1', question);
      assert.equal(limited.mode, 'local');
      assert.match(limited.answer, /limite diário/i);
      assert.equal(requests.length, sent);
      assert.equal(quota.reserveHostedAssistantCall('b2'), null);
      const otherBusiness = database.db.prepare(`SELECT COUNT(*) AS total FROM assistant_ai_daily_usage
        WHERE business_id='b2'`).get() as { total: number };
      assert.equal(otherBusiness.total, 0);
      database.db.prepare('DELETE FROM assistant_ai_daily_usage WHERE business_id=?').run('b1');
      database.db.prepare('DELETE FROM assistant_ai_global_usage').run();
      failNextCompletion = true;
      const failed = await assistant.answerAssistant('b1', question);
      assert.equal(failed.mode, 'local');
      const usageAfterFailure = database.db.prepare(`SELECT calls FROM assistant_ai_daily_usage
        WHERE business_id='b1'`).get() as { calls: number };
      assert.equal(usageAfterFailure.calls, 0);
      const globalAfterFailure = database.db.prepare(`SELECT calls FROM assistant_ai_global_usage`)
        .get() as { calls: number };
      assert.equal(globalAfterFailure.calls, 0);
      const retried = await assistant.answerAssistant('b1', question);
      assert.equal(retried.mode, 'ai');
    } finally {
      delete process.env.NAYLA_GROQ_DAILY_LIMIT;
      delete process.env.NAYLA_GROQ_GLOBAL_DAILY_LIMIT;
    }
  });
});
