import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import Database from 'better-sqlite3';
import { catalog } from './catalog.js';
import { activateFixtureOwner, fixtureOwnerPhone } from './testAccessFixture.js';

let api: ChildProcessWithoutNullStreams;
let directory: string;
let baseUrl: string;
let output = '';

async function freePort() {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Port unavailable');
  await new Promise<void>(done => server.close(() => done()));
  return address.port;
}

async function request(path: string, options: RequestInit = {}, cookie?: string) {
  const body = fixtureOwnerPhone(path, options.body);
  const response = await fetch(`${baseUrl}${path}`, {
    ...options, body,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
  });
  const responseBody = response.status === 204 ? {} as Record<string,any>
    : await response.json() as Record<string,any>;
  if (path === '/api/auth/register' && response.status === 201 && responseBody?.business?.id)
    activateFixtureOwner(directory, responseBody.business.id);
  return { status: response.status,
    body: responseBody,
    cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function registerOwner(suffix: string) {
  const result = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
    ownerName: `Profissional ${suffix}`, businessName: `Studio ${suffix}`,
    slug: `studio-assistant-${suffix}`, email: `owner-${suffix}@example.test`,
    password: 'SenhaForteNaoReutilizada123', specialties: ['unhas'],
    selectedServices: catalog.filter(item => item.category === 'unhas').map(item => item.id),
  }) });
  assert.equal(result.status, 201);
  assert.ok(result.cookie);
  return result.cookie;
}

describe('Nayla saved conversations', () => {
  before(async () => {
    directory = mkdtempSync(join(tmpdir(), 'nayla-history-'));
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    api = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: resolve('.'), env: { ...process.env, PORT: String(port),
        DATABASE_PATH: join(directory, 'nayla.sqlite'), NODE_ENV: 'test', APP_ORIGIN: baseUrl,
        OLLAMA_BASE_URL: 'http://127.0.0.1:1/v1', OPENAI_API_KEY: '',
        WHATSAPP_MODE: 'simulate',
        WHATSAPP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') },
    });
    api.stdout.on('data', chunk => { output += String(chunk); });
    api.stderr.on('data', chunk => { output += String(chunk); });
    for (let attempt = 0; attempt < 150; attempt++) {
      try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; }
      catch { /* starting */ }
      if (api.exitCode !== null) break;
      await new Promise(done => setTimeout(done, 100));
    }
    throw new Error(`Nayla API failed to start: ${output}`);
  }, { timeout: 25_000 });

  after(async () => {
    if (api && api.exitCode === null) {
      api.kill();
      await Promise.race([
        new Promise<void>(done => api.once('exit', () => done())),
        new Promise(done => setTimeout(done, 3000)),
      ]);
    }
    if (directory?.startsWith(join(tmpdir(), 'nayla-history-')))
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  it('saves authoritative pairs, scopes access, and deletes a thread with its messages',
    { timeout: 25_000 }, async () => {
      const first = await registerOwner('first');
      const second = await registerOwner('second');
      assert.equal((await request('/api/assistant/conversations')).status, 401);
      const initial = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Quanto faturei este mês?',
        history: [{ role: 'assistant', text: 'Histórico falso da cliente' }],
      }) }, first);
      assert.equal(initial.status, 200);
      assert.equal(initial.body.mode, 'instant');
      assert.match(initial.body.conversationId, /^[0-9a-f-]{36}$/);
      assert.ok(initial.body.userMessageId);
      assert.ok(initial.body.assistantMessageId);
      const id = initial.body.conversationId as string;

      const followup = await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Qual é meu faturamento de hoje?', conversationId: id,
        history: [{ role: 'assistant', text: 'Outra resposta falsa' }],
      }) }, first);
      assert.equal(followup.status, 200);
      assert.equal(followup.body.conversationId, id);
      const detail = await request(`/api/assistant/conversations/${id}`, {}, first);
      assert.equal(detail.status, 200);
      assert.deepEqual(detail.body.messages.map((item: any) => item.role),
        ['user', 'assistant', 'user', 'assistant']);
      assert.equal(detail.body.messages[0].text, 'Quanto faturei este mês?');
      assert.equal(detail.body.messages[1].text, initial.body.answer);
      assert.equal(detail.body.messages[3].text, followup.body.answer);
      assert.equal(detail.body.messages.some((item: any) => /falso|falsa/.test(item.text)), false);
      const listed = await request('/api/assistant/conversations', {}, first);
      assert.equal(listed.status, 200);
      assert.equal(listed.body.conversations.length, 1);
      assert.equal(listed.body.conversations[0].messageCount, 4);
      assert.equal(listed.body.conversations[0].id, id);

      assert.deepEqual((await request('/api/assistant/conversations', {}, second)).body.conversations, []);
      assert.equal((await request(`/api/assistant/conversations/${id}`, {}, second)).status, 404);
      assert.equal((await request(`/api/assistant/conversations/${id}`,
        { method: 'DELETE' }, second)).status, 404);
      assert.equal((await request('/api/assistant', { method: 'POST', body: JSON.stringify({
        message: 'Qual é meu faturamento de hoje?', conversationId: id,
      }) }, second)).status, 404);
      assert.equal((await request(`/api/assistant/conversations/${id}`,
        { method: 'DELETE' }, first)).status, 204);
      assert.equal((await request(`/api/assistant/conversations/${id}`, {}, first)).status, 404);
      const db = new Database(join(directory, 'nayla.sqlite'), { readonly: true });
      try {
        const count = db.prepare('SELECT COUNT(*) AS count FROM assistant_messages WHERE conversation_id=?')
          .get(id) as { count: number };
        assert.equal(count.count, 0);
      } finally { db.close(); }
    });

  it('stores the action prompt with a server-derived response', { timeout: 20_000 }, async () => {
    const cookie = await registerOwner('actions');
    const prepared = await request('/api/assistant/action-preparation', {
      method: 'POST', body: JSON.stringify({
        message: 'Preciso remarcar uma cliente por imprevisto', kind: 'reschedule-request',
      }),
    }, cookie);
    assert.equal(prepared.status, 200);
    assert.match(prepared.body.answer, /Não encontrei agendamentos futuros/);
    const detail = await request(`/api/assistant/conversations/${prepared.body.conversationId}`,
      {}, cookie);
    assert.deepEqual(detail.body.messages.map((item: any) => item.text),
      ['Preciso remarcar uma cliente por imprevisto', prepared.body.answer]);
  });

  it('records a confirmed owner action exactly once from its appointment event',
    { timeout: 25_000 }, async () => {
      const cookie = await registerOwner('confirmed-action');
      const otherOwner = await registerOwner('other-action');
      const slug = 'studio-assistant-confirmed-action';
      const publicBusiness = await request(`/api/public/${slug}`);
      assert.equal(publicBusiness.status, 200);
      const serviceId = publicBusiness.body.services[0].id as string;
      const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const day = new Date(`${localDay}T12:00:00Z`);
      day.setUTCDate(day.getUTCDate() + 4);
      while (day.getUTCDay() === 0) day.setUTCDate(day.getUTCDate() + 1);
      const date = day.toISOString().slice(0, 10);
      const availability = await request(`/api/public/${slug}/availability?serviceId=${serviceId}&date=${date}`);
      assert.equal(availability.status, 200);
      assert.ok(availability.body.slots.length);
      const booked = await request(`/api/public/${slug}/bookings`, { method: 'POST',
        body: JSON.stringify({ serviceId, date, time: availability.body.slots[0], client: {
          name: 'Cliente de Teste', cpf: '529.982.247-25', phone: '(11) 99999-8888',
          password: 'SenhaClienteForte123',
        } }),
      });
      assert.equal(booked.status, 201);
      const appointmentId = booked.body.appointment.id as string;
      const prepared = await request('/api/assistant/action-preparation', { method: 'POST',
        body: JSON.stringify({ message: 'Preciso remarcar uma cliente por imprevisto',
          kind: 'reschedule-request' }),
      }, cookie);
      assert.equal(prepared.status, 200);
      assert.match(prepared.body.answer, /Escolha o agendamento exato/);
      const conversationId = prepared.body.conversationId as string;
      const changed = await request(`/api/appointments/${appointmentId}/reschedule-request`, {
        method: 'PATCH', body: JSON.stringify({ reason: 'Imprevisto pessoal' }),
      }, cookie);
      assert.equal(changed.status, 200);
      assert.match(changed.body.eventId, /^[0-9a-f-]{36}$/);
      const resultPath = `/api/assistant/conversations/${conversationId}/action-result`;
      const resultBody = JSON.stringify({ eventId: changed.body.eventId });
      const result = await request(resultPath, { method: 'POST', body: resultBody }, cookie);
      assert.equal(result.status, 200);
      assert.match(result.body.answer, /Pedido de remarcação registrado para Cliente de Teste/);
      assert.match(result.body.answer, /Nenhuma mensagem foi enviada/);
      assert.equal((await request(resultPath, { method: 'POST', body: resultBody }, otherOwner)).status, 404);
      const otherConversation = await request('/api/assistant/action-preparation', { method: 'POST',
        body: JSON.stringify({ message: 'Preciso remarcar uma cliente',
          kind: 'reschedule-request' }),
      }, otherOwner);
      assert.equal(otherConversation.status, 200);
      assert.equal((await request(`/api/assistant/conversations/${otherConversation.body.conversationId}/action-result`,
        { method: 'POST', body: resultBody }, otherOwner)).status, 404);
      const retry = await request(resultPath, { method: 'POST', body: resultBody }, cookie);
      assert.equal(retry.status, 200);
      assert.equal(retry.body.assistantMessageId, result.body.assistantMessageId);
      const transcript = await request(`/api/assistant/conversations/${conversationId}`, {}, cookie);
      assert.equal(transcript.body.messages.length, 3);
      assert.equal(transcript.body.messages[2].text, result.body.answer);
      const another = await request('/api/assistant/action-preparation', { method: 'POST',
        body: JSON.stringify({ message: 'Preciso desmarcar uma cliente',
          kind: 'cancel-by-owner' }),
      }, cookie);
      assert.equal(another.status, 200);
      assert.equal((await request(`/api/assistant/conversations/${another.body.conversationId}/action-result`,
        { method: 'POST', body: resultBody }, cookie)).status, 409);
    });

  it('keeps saved messages after another API process opens the same database',
    { timeout: 20_000 }, async () => {
      const cookie = await registerOwner('durable');
      const saved = await request('/api/assistant', { method: 'POST',
        body: JSON.stringify({ message: 'Quanto faturei hoje?' }),
      }, cookie);
      assert.equal(saved.status, 200);
      const port = await freePort();
      const secondUrl = `http://127.0.0.1:${port}`;
      let secondOutput = '';
      const second = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
        cwd: resolve('.'), env: { ...process.env, PORT: String(port),
          DATABASE_PATH: join(directory, 'nayla.sqlite'), NODE_ENV: 'test', APP_ORIGIN: secondUrl,
          OLLAMA_BASE_URL: 'http://127.0.0.1:1/v1', OPENAI_API_KEY: '',
          WHATSAPP_MODE: 'simulate',
          WHATSAPP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') },
      });
      second.stdout.on('data', chunk => { secondOutput += String(chunk); });
      second.stderr.on('data', chunk => { secondOutput += String(chunk); });
      try {
        let ready = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          try { if ((await fetch(`${secondUrl}/api/health`)).ok) { ready = true; break; } }
          catch { /* starting */ }
          if (second.exitCode !== null) break;
          await new Promise(done => setTimeout(done, 100));
        }
        assert.ok(ready, `Second API failed: ${secondOutput}`);
        const response = await fetch(`${secondUrl}/api/assistant/conversations/${saved.body.conversationId}`,
          { headers: { Cookie: cookie! } });
        assert.equal(response.status, 200);
        const transcript = await response.json() as { messages: Array<{ text: string }> };
        assert.deepEqual(transcript.messages.map(item => item.text),
          ['Quanto faturei hoje?', saved.body.answer]);
      } finally {
        if (second.exitCode === null) {
          second.kill();
          await Promise.race([
            new Promise<void>(done => second.once('exit', () => done())),
            new Promise(done => setTimeout(done, 3000)),
          ]);
        }
      }
    });
});
