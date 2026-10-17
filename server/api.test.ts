import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { catalog as serviceTemplates } from './catalog.js';

const selectedServices = (category: string) => serviceTemplates
  .filter(item => item.category === category).map(item => item.id);

let processHandle: ChildProcessWithoutNullStreams;
let tempDirectory: string;
let baseUrl: string;
let serverOutput = '';
const expect = (value: any) => ({
  toBe: (expected: any) => assert.equal(value, expected),
  toEqual: (expected: any) => assert.deepEqual(value, expected),
  toBeGreaterThan: (expected: number) => assert.ok(value > expected),
  toHaveLength: (expected: number) => assert.equal(value.length, expected),
  toContain: (expected: any) => assert.ok(value.includes(expected)),
});

async function freePort() {
  const server = createServer();
  await new Promise<void>(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Port unavailable');
  const port = address.port;
  await new Promise<void>(resolveClosed => server.close(() => resolveClosed()));
  return port;
}

function bookingDay() {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 4);
  while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

async function request(path: string, options: RequestInit = {}, cookie?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
  });
  const body = response.status === 204 ? null : await response.json();
  return { status: response.status, body: body as any,
    cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function signedWebhook(url: string, secret: string, payload: string) {
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return fetch(url, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` },
    body: payload });
}

describe('Nayla API', () => {
  before(async () => {
    tempDirectory = mkdtempSync(join(tmpdir(), 'nayla-test-'));
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    processHandle = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: resolve('.'),
      env: { ...process.env, PORT: String(port), DATABASE_PATH: join(tempDirectory, 'nayla.sqlite'),
        NODE_ENV: 'test', OPENAI_API_KEY: '', WHATSAPP_MODE: 'simulate',
        WHATSAPP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), APP_ORIGIN: baseUrl },
    });
    processHandle.stdout.on('data', chunk => { serverOutput += String(chunk); });
    processHandle.stderr.on('data', chunk => { serverOutput += String(chunk); });
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if ((await fetch(`${baseUrl}/api/health`)).ok) return;
      } catch { /* server is starting */ }
      if (processHandle.exitCode !== null) break;
      await new Promise(resolveWait => setTimeout(resolveWait, 100));
    }
    throw new Error(`API did not start: ${serverOutput}`);
  }, { timeout: 20_000 });

  after(async () => {
    if (processHandle && processHandle.exitCode === null) {
      processHandle.kill();
      await Promise.race([
        new Promise<void>(resolveExit => processHandle.once('exit', () => resolveExit())),
        new Promise<void>(resolveWait => setTimeout(resolveWait, 3000)),
      ]);
    }
    if (tempDirectory?.startsWith(join(tmpdir(), 'nayla-test-')))
      rmSync(tempDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  it('rejects malformed and oversized JSON without exposing credentials in responses or logs', async () => {
    const secret = 'NAYLA_TEST_SECRET_DO_NOT_LOG_2026';
    const malformed = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: `{"password":"${secret}"` });
    assert.equal(malformed.status, 400);
    assert.equal(JSON.stringify(await malformed.json()).includes(secret), false);
    const oversized = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: secret.repeat(1300) }) });
    assert.equal(oversized.status, 413);
    assert.equal(JSON.stringify(await oversized.json()).includes(secret), false);
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
    assert.equal(serverOutput.includes(secret), false);
  });

  it('isolates tenants and prevents booking conflicts while keeping CRM, finance and client portal connected', { timeout: 30_000 }, async () => {
    const first = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
      ownerName: 'Ana Silva', businessName: 'Ateliê Ana', slug: 'atelie-ana-test',
      email: 'ana@example.test', password: 'SenhaMuitoForte1', specialties: ['unhas'],
      selectedServices: selectedServices('unhas'),
    }) });
    expect(first.status).toBe(201);
    assert.equal(first.body.sessionToken, undefined);
    const ownerCookie = first.cookie!;
    const second = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
      ownerName: 'Bia Souza', businessName: 'Studio Bia', slug: 'studio-bia-test',
      email: 'bia@example.test', password: 'SenhaMuitoForte2', specialties: ['cilios'],
      selectedServices: selectedServices('cilios'),
    }) });
    expect(second.status).toBe(201);
    const otherCookie = second.cookie!;
    const iosPreflight = await fetch(`${baseUrl}/api/auth/login`, { method: 'OPTIONS',
      headers: { Origin: 'capacitor://localhost', 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,x-nayla-app' } });
    expect(iosPreflight.status).toBe(204);
    expect(iosPreflight.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
    expect(iosPreflight.headers.get('access-control-allow-credentials')).toBe('true');
    for (const header of ['Authorization', 'Content-Type', 'X-Nayla-App'])
      assert.ok(iosPreflight.headers.get('access-control-allow-headers')?.includes(header));
    const androidPreflight = await fetch(`${baseUrl}/api/auth/login`, { method: 'OPTIONS',
      headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'POST' } });
    expect(androidPreflight.status).toBe(204);
    expect(androidPreflight.headers.get('access-control-allow-origin')).toBe('https://localhost');
    const webPreflight = await fetch(`${baseUrl}/api/auth/login`, { method: 'OPTIONS',
      headers: { Origin: baseUrl, 'Access-Control-Request-Method': 'POST' } });
    expect(webPreflight.status).toBe(204);
    expect(webPreflight.headers.get('access-control-allow-origin')).toBe(baseUrl);
    const evilPreflight = await fetch(`${baseUrl}/api/auth/login`, { method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
    expect(evilPreflight.status).toBe(403);
    assert.equal(evilPreflight.headers.get('access-control-allow-origin'), null);
    const evilLogin = await request('/api/auth/login', { method: 'POST',
      headers: { Origin: 'https://evil.example', 'X-Nayla-App': 'mobile' },
      body: JSON.stringify({ email: 'ana@example.test', password: 'SenhaMuitoForte1' }) });
    expect(evilLogin.status).toBe(403);
    const nativeOwner = await request('/api/auth/login', { method: 'POST',
      headers: { Origin: 'capacitor://localhost', 'X-Nayla-App': 'mobile' },
      body: JSON.stringify({ email: 'ana@example.test', password: 'SenhaMuitoForte1' }) });
    expect(nativeOwner.status).toBe(200);
    assert.match(nativeOwner.body.sessionToken, /^[a-f0-9]{64}$/);
    assert.equal(nativeOwner.cookie, undefined);
    const ownerBearer = { Origin: 'capacitor://localhost',
      Authorization: `Bearer ${nativeOwner.body.sessionToken}` };
    expect((await request('/api/auth/me', { headers: ownerBearer })).status).toBe(200);
    expect((await request('/api/client/me', { headers: ownerBearer })).status).toBe(401);
    const webLogin = await request('/api/auth/login', { method: 'POST',
      headers: { Origin: baseUrl, 'X-Nayla-App': 'mobile' },
      body: JSON.stringify({ email: 'ana@example.test', password: 'SenhaMuitoForte1' }) });
    expect(webLogin.status).toBe(200);
    assert.equal(webLogin.body.sessionToken, undefined);
    assert.ok(webLogin.cookie);
    const ownerConfig = await request('/api/notifications/config', {}, ownerCookie);
    const otherConfig = await request('/api/notifications/config', {}, otherCookie);
    expect(ownerConfig.body.mode).toBe('simulate');
    expect(ownerConfig.body.configured).toBe(false);
    assert.notEqual(ownerConfig.body.webhookUrl, otherConfig.body.webhookUrl);

    const catalog = await request('/api/public/atelie-ana-test');
    expect(catalog.body.services.length).toBeGreaterThan(5);
    expect(catalog.body.services.every((service: any) => service.category === 'unhas')).toBe(true);
    const serviceId = catalog.body.services[0].id as string;
    const day = bookingDay();
    const slots = await request(`/api/public/atelie-ana-test/availability?serviceId=${serviceId}&date=${day}`);
    expect(slots.status).toBe(200);
    expect(slots.body.slots.length).toBeGreaterThan(0);
    const time = slots.body.slots[0] as string;
    const bookingBody = { serviceId, date: day, time, client: {
      name: 'Maria Costa', cpf: '529.982.247-25', phone: '(11) 99999-8888',
      email: 'maria@example.test', password: 'SenhaCliente123',
    } };
    const booked = await request('/api/public/atelie-ana-test/bookings', {
      method: 'POST', body: JSON.stringify(bookingBody),
    });
    expect(booked.status).toBe(201);
    expect(booked.body.notificationStatus).toBe('opted_out');
    const clientCookie = booked.cookie!;
    const ownerInbox = await request('/api/inbox', {}, ownerCookie);
    expect(ownerInbox.status).toBe(200);
    expect(ownerInbox.body.items.some((item: any) => item.appointmentId === booked.body.appointment.id
      && item.kind === 'new_booking')).toBe(true);
    expect((await request('/api/inbox', {}, otherCookie)).body.items).toHaveLength(0);
    const ownerNoticeId = ownerInbox.body.items[0].id as string;
    expect((await request(`/api/client/inbox/${ownerNoticeId}/read`,
      { method: 'PATCH' }, clientCookie)).status).toBe(404);
    expect((await request(`/api/inbox/${ownerNoticeId}/read`,
      { method: 'PATCH' }, ownerCookie)).status).toBe(204);
    const duplicate = await request('/api/public/atelie-ana-test/bookings', {
      method: 'POST', body: JSON.stringify(bookingBody),
    }, clientCookie);
    expect(duplicate.status).toBe(409);

    expect((await request('/api/appointments', {}, otherCookie)).body).toEqual([]);
    expect((await request('/api/appointments', { headers: ownerBearer })).body).toHaveLength(1);
    expect((await request('/api/clients', {}, otherCookie)).body).toEqual([]);
    const forbiddenService = await request('/api/appointments', { method: 'POST', body: JSON.stringify({
      clientId: first.body.user.id, serviceId, date: day, time,
    }) }, otherCookie);
    expect(forbiddenService.status).toBe(404);

    const clientSession = await request('/api/client/login', { method: 'POST', body: JSON.stringify({
      slug: 'atelie-ana-test', identifier: '52998224725', password: 'SenhaCliente123',
    }) });
    expect(clientSession.status).toBe(200);
    expect(clientSession.body.client.name).toBe('Maria Costa');
    expect(clientSession.body.client.whatsappOptIn).toBe(false);
    const nativeClient = await request('/api/client/login', { method: 'POST',
      headers: { Origin: 'https://localhost', 'X-Nayla-App': 'mobile' },
      body: JSON.stringify({ slug: 'atelie-ana-test', identifier: '52998224725',
        password: 'SenhaCliente123' }) });
    expect(nativeClient.status).toBe(200);
    assert.match(nativeClient.body.sessionToken, /^[a-f0-9]{64}$/);
    assert.equal(nativeClient.cookie, undefined);
    const clientBearer = { Origin: 'https://localhost',
      Authorization: `Bearer ${nativeClient.body.sessionToken}` };
    expect((await request('/api/client/me', { headers: clientBearer })).status).toBe(200);
    expect((await request('/api/dashboard?period=7', { headers: clientBearer })).status).toBe(401);
    const optIn = await request('/api/public/atelie-ana-test/preferences', {
      method: 'PATCH', body: JSON.stringify({ whatsappOptIn: true }),
    }, clientSession.cookie);
    expect(optIn.status).toBe(200);
    expect(optIn.body.client.whatsappOptIn).toBe(true);
    expect((await request('/api/public/atelie-ana-test/appointments', {}, clientSession.cookie)).body).toHaveLength(1);
    const cancelled = await request(`/api/client/appointments/${booked.body.appointment.id}/cancel`, {
      method: 'PATCH',
    }, clientCookie);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');
    const reopened = await request(`/api/public/atelie-ana-test/availability?serviceId=${serviceId}&date=${day}`);
    expect(reopened.body.slots).toContain(time);
    const rebooked = await request('/api/public/atelie-ana-test/bookings', {
      method: 'POST', body: JSON.stringify({ ...bookingBody, client: { ...bookingBody.client,
        phone: '11988886666', email: 'maria.nova@example.test', whatsappOptIn: true } }),
    }, clientCookie);
    expect(rebooked.status).toBe(201);
    expect(rebooked.body.notificationStatus).toBe('simulated');
    const updatedContact = await request('/api/public/atelie-ana-test/me', {}, clientCookie);
    expect(updatedContact.body.client.phone).toBe('11988886666');
    expect(updatedContact.body.client.email).toBe('maria.nova@example.test');
    const cannotRestoreCancelled = await request(`/api/appointments/${booked.body.appointment.id}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'confirmed' }),
    }, ownerCookie);
    expect(cannotRestoreCancelled.status).toBe(409);
    const completed = await request(`/api/appointments/${rebooked.body.appointment.id}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'completed' }),
    }, ownerCookie);
    expect(completed.status).toBe(200);
    const earned = await request(`/api/finance/entries?from=${day}&to=${day}`, {}, ownerCookie);
    expect(earned.body.some((entry: any) => entry.appointmentId === rebooked.body.appointment.id)).toBe(true);
    const wrongPortal = await request('/api/public/studio-bia-test/me', {}, clientCookie);
    expect(wrongPortal.status).toBe(403);
    const laterSlots = await request(`/api/public/atelie-ana-test/availability?serviceId=${serviceId}&date=${day}`);
    const withoutEmail = await request('/api/public/atelie-ana-test/bookings', {
      method: 'POST', headers: { Origin: 'https://localhost', 'X-Nayla-App': 'mobile' },
      body: JSON.stringify({ serviceId, date: day, time: laterSlots.body.slots[0],
        client: { name: 'Joana Dias', cpf: '11144477735', phone: '11999997777',
          email: '', password: 'OutraSenhaSegura1' } }),
    });
    expect(withoutEmail.status).toBe(201);
    assert.match(withoutEmail.body.sessionToken, /^[a-f0-9]{64}$/);
    assert.equal(withoutEmail.cookie, undefined);
    expect((await request('/api/public/atelie-ana-test/me', { headers: {
      Origin: 'https://localhost', Authorization: `Bearer ${withoutEmail.body.sessionToken}`,
    } })).body.client.email).toBe('');
    const adminDate = new Date(`${day}T12:00:00Z`);
    adminDate.setUTCDate(adminDate.getUTCDate() + 7);
    const adminDay = adminDate.toISOString().slice(0, 10);
    const adminSlots = await request(`/api/public/atelie-ana-test/availability?serviceId=${serviceId}&date=${adminDay}`);
    const manual = await request('/api/appointments', { method: 'POST', body: JSON.stringify({
      clientId: clientSession.body.client.id, serviceId, date: adminDay, time: adminSlots.body.slots[0],
      notes: 'Preferência de esmalte registrada', whatsappOptIn: true,
    }) }, ownerCookie);
    expect(manual.status).toBe(201);
    expect(manual.body.notes).toBe('Preferência de esmalte registrada');
    expect(manual.body.whatsappOptIn).toBe(true);
    expect(manual.body.notificationStatus).toBe('simulated');
    const notifications = await request('/api/notifications?limit=50', {}, ownerCookie);
    expect(notifications.body.some((item: any) => item.appointmentId === manual.body.id && item.status === 'simulated')).toBe(true);
    expect((await request('/api/notifications?limit=50', {}, otherCookie)).body).toHaveLength(0);

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const income = await request('/api/finance', { method: 'POST', body: JSON.stringify({
      type: 'income', description: 'Venda adicional', amount: 123.45, date: today,
    }) }, ownerCookie);
    expect(income.status).toBe(201);
    const expense = await request('/api/finance', { method: 'POST', body: JSON.stringify({
      type: 'expense', description: 'Material usado', amount: 12.34, date: today,
    }) }, ownerCookie);
    expect(expense.status).toBe(201);
    const financeNow = await request('/api/finance?period=1', {}, ownerCookie);
    expect(financeNow.body.income).toBe(123.45);
    expect(financeNow.body.expenses).toBe(12.34);
    expect(financeNow.body.balance).toBe(111.11);
    expect(financeNow.body.entries.map((entry: any) => entry.id)).toContain(income.body.id);
    expect(financeNow.body.entries.map((entry: any) => entry.id)).toContain(expense.body.id);
    const analysisNow = await request('/api/analytics?period=7', {}, ownerCookie);
    expect(analysisNow.body.overview.income.current).toBe(123.45);
    expect(analysisNow.body.overview.expenses.current).toBe(12.34);
    expect((await request(`/api/finance/${expense.body.id}`, { method: 'DELETE' }, ownerCookie)).status).toBe(204);
    expect((await request('/api/finance?period=1', {}, ownerCookie)).body.balance).toBe(123.45);
    const todayDashboard = await request('/api/dashboard?period=1', {}, ownerCookie);
    expect(todayDashboard.status).toBe(200);
    expect(todayDashboard.body.revenue).toBe(123.45);
    expect(todayDashboard.body.appointments).toBe(0);
    expect(todayDashboard.body.clients).toBe(0);
    expect(todayDashboard.body.recentAppointments).toEqual([]);
    expect((await request('/api/dashboard?period=1', {}, otherCookie)).body.revenue).toBe(0);
    expect((await request('/api/dashboard?period=2', {}, ownerCookie)).status).toBe(400);
    expect((await request('/api/dashboard?period=7', {}, ownerCookie)).body.revenue).toBe(123.45);
    expect((await request('/api/dashboard?period=7', {}, otherCookie)).body.revenue).toBe(0);
    const assistant = await request('/api/assistant', { method: 'POST',
      body: JSON.stringify({ message: 'Qual meu faturamento de hoje?' }) }, ownerCookie);
    expect(assistant.status).toBe(200);
    expect(assistant.body.answer).toContain('123,45');
    expect(assistant.body.mode).toBe('local');
    expect((await request('/api/assistant/status', {}, ownerCookie)).body.aiAvailable).toBe(false);
    const serviceAdvice = await request('/api/assistant', { method: 'POST',
      body: JSON.stringify({ message: 'Quais meus serviços disponíveis?' }) }, ownerCookie);
    expect(serviceAdvice.body.answer).toContain('Manicure');
    assert.equal(serviceAdvice.body.answer.includes('Extensão de cílios'), false);
    const beautyAdvice = await request('/api/assistant', { method: 'POST',
      body: JSON.stringify({ message: 'Como posso melhorar meu atendimento de unhas?' }) }, ownerCookie);
    expect(beautyAdvice.body.answer).toContain('Para unhas');
    const areaAdvice = await request('/api/assistant', { method: 'POST',
      body: JSON.stringify({ message: 'Dicas para atender melhor na minha área' }) }, ownerCookie);
    expect(areaAdvice.body.answer).toContain('Para unhas');
    const otherArea = await request('/api/assistant', { method: 'POST',
      body: JSON.stringify({ message: 'Dicas para melhorar meu atendimento de cílios?' }) }, ownerCookie);
    expect(otherArea.body.answer).toContain('não está selecionada');
    const systemHelp = await request('/api/assistant', { method: 'POST',
      body: JSON.stringify({ message: 'Como compartilho meu link de agendamento?' }) }, ownerCookie);
    expect(systemHelp.body.answer).toContain('/agendar/atelie-ana-test');
    const openQuestion = await request('/api/assistant', { method: 'POST',
      body: JSON.stringify({ message: 'Qual é a capital da França?', history: [
        { role: 'user', text: 'Quais serviços ofereço?' },
        { role: 'assistant', text: 'Seus serviços estão no app.' },
      ] }) }, ownerCookie);
    expect(openQuestion.body.answer).toContain('IA conversacional ainda não está ativa');
    expect(openQuestion.body.mode).toBe('local');
    expect((await request('/api/assistant', { method: 'POST', body: JSON.stringify({
      message: 'Olá?', history: Array(9).fill({ role: 'user', text: 'oi' }),
    }) }, ownerCookie)).status).toBe(400);
    const inactive = await request('/api/assistant', { method: 'POST',
      body: JSON.stringify({ message: 'Qual cliente não voltou depois de um mês?' }) }, ownerCookie);
    expect(inactive.status).toBe(200);
    expect(inactive.body.answer).toContain('Não há clientes');

    const metaConfig = await request('/api/notifications/config', { method: 'PATCH', body: JSON.stringify({
      mode: 'meta', templateName: 'confirmacao_agendamento', urgentTemplateName: 'aviso_urgente',
      sender: '5511999998888',
      phoneNumberId: '123456789', accessToken: 'token-only-ana', appSecret: 'secret-only-ana',
    }) }, ownerCookie);
    expect(metaConfig.status).toBe(200);
    expect(metaConfig.body.configured).toBe(true);
    expect(metaConfig.body.urgentConfigured).toBe(true);
    expect(metaConfig.body.urgentTemplateName).toBe('aviso_urgente');
    expect(metaConfig.body.senderVerified).toBe(false);
    expect(metaConfig.body.hasAccessToken).toBe(true);
    expect(metaConfig.body.hasAppSecret).toBe(true);
    assert.equal(JSON.stringify(metaConfig.body).includes('token-only-ana'), false);
    expect((await request('/api/notifications/config', {}, otherCookie)).body.mode).toBe('simulate');
    const otherMetaConfig = await request('/api/notifications/config', { method: 'PATCH', body: JSON.stringify({
      mode: 'meta', templateName: 'confirmacao_agendamento', sender: '5511977776666',
      phoneNumberId: '987654321', accessToken: 'token-only-bia', appSecret: 'secret-only-bia',
    }) }, otherCookie);
    expect(otherMetaConfig.body.configured).toBe(true);

    const extraDb = new Database(join(tempDirectory, 'nayla.sqlite'));
    const providerMessageId = 'wamid.test.ana';
    const syntheticId = randomUUID();
    try {
      extraDb.transaction(() => {
        const stored = extraDb.prepare(`SELECT access_token_encrypted,app_secret_encrypted
          FROM business_whatsapp_settings WHERE business_id=?`).get(first.body.business.id) as {
          access_token_encrypted: string; app_secret_encrypted: string;
        };
        assert.ok(stored.access_token_encrypted.startsWith('v1:'));
        assert.ok(stored.app_secret_encrypted.startsWith('v1:'));
        assert.equal(stored.access_token_encrypted.includes('token-only-ana'), false);
        assert.equal(stored.app_secret_encrypted.includes('secret-only-ana'), false);
        extraDb.prepare(`INSERT INTO notification_outbox
          (id,business_id,appointment_id,recipient,message,status,phone_number_id,provider_message_id)
          VALUES(?,?,?,?,?,'accepted',?,?)`).run(syntheticId, first.body.business.id,
            rebooked.body.appointment.id, '5511988886666', 'Confirmação de teste',
            '123456789', providerMessageId);
        const addIncome = extraDb.prepare(`INSERT INTO financial_entries
          (id,business_id,type,description,amount_cents,date) VALUES(?,?,'income','Pequena venda',1,?)`);
        for (let index = 0; index < 1001; index++)
          addIncome.run(randomUUID(), first.body.business.id, today);
        const addClient = extraDb.prepare(`INSERT INTO users
          (id,business_id,role,name,phone,password_hash) VALUES(?,?,'client',?,?,'test-hash')`);
        for (let index = 0; index < 301; index++)
          addClient.run(randomUUID(), first.body.business.id, `Cliente ${index}`, `11900${String(index).padStart(6, '0')}`);
      }).immediate();
    } finally { extraDb.close(); }
    const fullFinance = await request('/api/finance?period=7', {}, ownerCookie);
    expect(fullFinance.body.entries).toHaveLength(1000);
    expect(fullFinance.body.income).toBe(133.46);
    expect((await request('/api/dashboard?period=7', {}, ownerCookie)).body.revenue).toBe(133.46);
    expect((await request('/api/clients', {}, ownerCookie)).body).toHaveLength(303);

    const verification = await fetch(`${metaConfig.body.webhookUrl}?hub.mode=subscribe&hub.verify_token=${metaConfig.body.webhookVerifyToken}&hub.challenge=challenge-123`);
    expect(verification.status).toBe(200);
    expect(await verification.text()).toBe('challenge-123');
    const invalidChallenge = await fetch(`${metaConfig.body.webhookUrl}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123`);
    expect(invalidChallenge.status).toBe(403);
    const payload = JSON.stringify({ entry: [{ changes: [{ value: {
      metadata: { phone_number_id: '123456789' },
      statuses: [{ id: providerMessageId, status: 'delivered' }],
    } }] }] });
    const rejected = await fetch(metaConfig.body.webhookUrl, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) },
      body: payload });
    expect(rejected.status).toBe(403);
    const wrongTenantSignature = await signedWebhook(metaConfig.body.webhookUrl, 'secret-only-bia', payload);
    expect(wrongTenantSignature.status).toBe(403);
    const otherTenantCallback = await signedWebhook(otherMetaConfig.body.webhookUrl, 'secret-only-bia', payload);
    expect(otherTenantCallback.status).toBe(200);
    const beforeOwnCallback = await request('/api/notifications?limit=50', {}, ownerCookie);
    expect(beforeOwnCallback.body.find((item: any) => item.id === syntheticId).status).toBe('accepted');
    const accepted = await signedWebhook(metaConfig.body.webhookUrl, 'secret-only-ana', payload);
    expect(accepted.status).toBe(200);
    const delivered = await request('/api/notifications?limit=50', {}, ownerCookie);
    expect(delivered.body.find((item: any) => item.id === syntheticId).status).toBe('delivered');
    expect(delivered.body.find((item: any) => item.id === syntheticId).canContact).toBe(true);
    const statusPayload = (status: string) => JSON.stringify({ entry: [{ changes: [{ value: {
      metadata: { phone_number_id: '123456789' }, statuses: [{ id: providerMessageId, status }],
    } }] }] });
    expect((await signedWebhook(metaConfig.body.webhookUrl, 'secret-only-ana', statusPayload('sent'))).status).toBe(200);
    expect((await request('/api/notifications?limit=50', {}, ownerCookie)).body
      .find((item: any) => item.id === syntheticId).status).toBe('delivered');
    expect((await signedWebhook(metaConfig.body.webhookUrl, 'secret-only-ana', statusPayload('read'))).status).toBe(200);
    expect((await signedWebhook(metaConfig.body.webhookUrl, 'secret-only-ana', statusPayload('failed'))).status).toBe(200);
    expect((await request('/api/notifications?limit=50', {}, ownerCookie)).body
      .find((item: any) => item.id === syntheticId).status).toBe('read');
    const optOut = await request('/api/public/atelie-ana-test/preferences', {
      method: 'PATCH', body: JSON.stringify({ whatsappOptIn: false }),
    }, clientCookie);
    expect(optOut.body.client.whatsappOptIn).toBe(false);
    const afterOptOut = await request('/api/notifications?limit=50', {}, ownerCookie);
    expect(afterOptOut.body.find((item: any) => item.id === syntheticId).canContact).toBe(false);
    expect((await request('/api/auth/logout', { method: 'POST', headers: ownerBearer })).status).toBe(204);
    expect((await request('/api/auth/me', { headers: ownerBearer })).status).toBe(401);
    expect((await request('/api/client/logout', { method: 'POST', headers: clientBearer })).status).toBe(204);
    expect((await request('/api/client/me', { headers: clientBearer })).status).toBe(401);
    expect((await request('/api/auth/me', {}, ownerCookie)).status).toBe(200);

    const joanaAppointmentId = withoutEmail.body.appointment.id as string;
    const joanaId = (await request('/api/public/atelie-ana-test/me', { headers: {
      Origin: 'https://localhost', Authorization: `Bearer ${withoutEmail.body.sessionToken}`,
    } })).body.client.id as string;
    expect((await request(`/api/appointments/${joanaAppointmentId}`, { method: 'PATCH',
      body: JSON.stringify({ status: 'completed' }) }, ownerCookie)).status).toBe(200);
    const joanaBearer = { Origin: 'https://localhost',
      Authorization: `Bearer ${withoutEmail.body.sessionToken}` };
    const wrongClientPassword = await request('/api/client/account', { method: 'DELETE',
      headers: joanaBearer, body: JSON.stringify({ password: 'senha-errada' }) });
    expect(wrongClientPassword.status).toBe(401);
    expect((await request('/api/client/me', { headers: joanaBearer })).status).toBe(200);
    const deletedClient = await request('/api/client/account', { method: 'DELETE',
      headers: joanaBearer, body: JSON.stringify({ password: 'OutraSenhaSegura1' }) });
    expect(deletedClient.status).toBe(204);
    expect((await request('/api/client/me', { headers: joanaBearer })).status).toBe(401);
    expect((await request('/api/public/atelie-ana-test/me', {}, clientCookie)).status).toBe(200);
    const verifyDb = new Database(join(tempDirectory, 'nayla.sqlite'), { readonly: true });
    const count = (table: string, field: string, value: string) =>
      (verifyDb.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${field}=?`).get(value) as { total: number }).total;
    try {
      for (const table of ['users', 'sessions'])
        expect(count(table, table === 'users' ? 'id' : 'user_id', joanaId)).toBe(0);
      expect(count('appointments', 'id', joanaAppointmentId)).toBe(0);
      expect(count('financial_entries', 'appointment_id', joanaAppointmentId)).toBe(0);
      expect(count('notification_outbox', 'appointment_id', joanaAppointmentId)).toBe(0);
      expect(count('businesses', 'id', first.body.business.id)).toBe(1);
    } finally { verifyDb.close(); }
    const wrongOwnerPassword = await request('/api/auth/account', { method: 'DELETE',
      body: JSON.stringify({ password: 'senha-errada' }) }, ownerCookie);
    expect(wrongOwnerPassword.status).toBe(401);
    expect((await request('/api/auth/me', {}, ownerCookie)).status).toBe(200);
    const deletedOwner = await request('/api/auth/account', { method: 'DELETE',
      body: JSON.stringify({ password: 'SenhaMuitoForte1' }) }, ownerCookie);
    expect(deletedOwner.status).toBe(204);
    expect((await request('/api/auth/me', {}, ownerCookie)).status).toBe(401);
    expect((await request('/api/public/atelie-ana-test')).status).toBe(404);
    expect((await request('/api/auth/me', {}, otherCookie)).status).toBe(200);
    const finalDb = new Database(join(tempDirectory, 'nayla.sqlite'), { readonly: true });
    try {
      for (const table of ['businesses', 'users', 'services', 'appointments', 'financial_entries',
        'notification_outbox', 'business_whatsapp_settings'])
        expect((finalDb.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${table === 'businesses'
          ? 'id' : 'business_id'}=?`).get(first.body.business.id) as { total: number }).total).toBe(0);
      expect((finalDb.pragma('foreign_key_check') as unknown[]).length).toBe(0);
      expect((finalDb.prepare('SELECT COUNT(*) AS total FROM businesses WHERE id=?')
        .get(second.body.business.id) as { total: number }).total).toBe(1);
    } finally { finalDb.close(); }
    const nativeRegister = await request('/api/auth/register', { method: 'POST',
      headers: { Origin: 'capacitor://localhost', 'X-Nayla-App': 'mobile' },
      body: JSON.stringify({ ownerName: 'Ana Silva', businessName: 'Novo Ateliê Ana',
        slug: 'atelie-ana-test', email: 'ana@example.test', password: 'SenhaMuitoForte1',
        specialties: ['sobrancelhas'], selectedServices: selectedServices('sobrancelhas') }) });
    expect(nativeRegister.status).toBe(201);
    assert.match(nativeRegister.body.sessionToken, /^[a-f0-9]{64}$/);
    assert.equal(nativeRegister.cookie, undefined);
    assert.notEqual(nativeRegister.body.business.id, first.body.business.id);
    const newOwnerBearer = { Origin: 'capacitor://localhost',
      Authorization: `Bearer ${nativeRegister.body.sessionToken}` };
    expect((await request('/api/auth/me', { headers: newOwnerBearer })).status).toBe(200);
    const expireDb = new Database(join(tempDirectory, 'nayla.sqlite'));
    try {
      const updated = expireDb.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(Date.now() - 60_000,
        createHash('sha256').update(nativeRegister.body.sessionToken).digest('hex'));
      assert.equal(updated.changes, 1, 'the native session must exist in the test database');
    } finally { expireDb.close(); }
    expect((await request('/api/auth/me', { headers: newOwnerBearer })).status).toBe(401);
  });

  it('lets clients change their own booking and keeps the owner schedule, audit and notices in sync',
    { timeout: 40_000 }, async () => {
      const ownerRegistration = await request('/api/auth/register', { method: 'POST',
        body: JSON.stringify({ ownerName: 'Lia Moura', businessName: 'Espaço Lia',
          slug: 'espaco-lia-remarcacao', email: 'lia@example.test',
          password: 'SenhaMuitoForte3', specialties: ['unhas'], selectedServices: selectedServices('unhas') }) });
      expect(ownerRegistration.status).toBe(201);
      const ownerCookie = ownerRegistration.cookie!;
      const ownerId = ownerRegistration.body.business.id as string;
      const catalog = await request('/api/public/espaco-lia-remarcacao');
      const [firstService, secondService] = catalog.body.services as Array<{ id: string }>;
      const day = bookingDay();
      const firstSlots = (await request(`/api/public/espaco-lia-remarcacao/availability?serviceId=${firstService.id}&date=${day}`)).body.slots as string[];
      assert.ok(firstSlots.length > 8);
      const firstTime = firstSlots[0];
      const secondTime = firstSlots[8];
      const book = (cpf: string, phone: string, name: string, time: string) =>
        request('/api/public/espaco-lia-remarcacao/bookings', { method: 'POST',
          body: JSON.stringify({ serviceId: firstService.id, date: day, time, client: {
            name, cpf, phone, password: 'SenhaCliente123', whatsappOptIn: true,
          } }) });
      const first = await book('52998224725', '11988881111', 'Nina Costa', firstTime);
      const second = await book('11144477735', '11988882222', 'Bia Gomes', secondTime);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const firstId = first.body.appointment.id as string;
      const secondId = second.body.appointment.id as string;
      const firstCookie = first.cookie!;
      const secondCookie = second.cookie!;
      const foreignChange = await request(`/api/client/appointments/${secondId}`, {
        method: 'PATCH', body: JSON.stringify({ time: firstTime }),
      }, firstCookie);
      expect(foreignChange.status).toBe(404);
      const otherExcluded = await request(`/api/public/espaco-lia-remarcacao/availability?serviceId=${firstService.id}&date=${day}&excludeAppointmentId=${secondId}`,
        {}, firstCookie);
      expect(otherExcluded.status).toBe(403);
      const ownExcluded = await request(`/api/public/espaco-lia-remarcacao/availability?serviceId=${firstService.id}&date=${day}&excludeAppointmentId=${firstId}`,
        {}, firstCookie);
      expect(ownExcluded.body.slots).toContain(firstTime);
      const sameBooking = await request(`/api/client/appointments/${firstId}`, {
        method: 'PATCH', body: JSON.stringify({ date: day, time: firstTime, serviceId: firstService.id }),
      }, firstCookie);
      expect(sameBooking.status).toBe(400);
      const conflict = await request(`/api/client/appointments/${firstId}`, {
        method: 'PATCH', body: JSON.stringify({ time: secondTime }),
      }, firstCookie);
      expect(conflict.status).toBe(409);

      const nextMonthStart = new Date(`${day.slice(0, 7)}-01T12:00:00Z`);
      nextMonthStart.setUTCMonth(nextMonthStart.getUTCMonth() + 1);
      let newDay = '';
      let newTime = '';
      for (let offset = 0; offset < 7 && !newDay; offset++) {
        const nextDate = new Date(nextMonthStart);
        nextDate.setUTCDate(nextDate.getUTCDate() + offset);
        const candidate = nextDate.toISOString().slice(0, 10);
        const slots = (await request(`/api/public/espaco-lia-remarcacao/availability?serviceId=${secondService.id}&date=${candidate}`)).body.slots as string[];
        if (slots.length) { newDay = candidate; newTime = slots[0]; }
      }
      assert.ok(newDay && newTime);
      const changed = await request(`/api/public/espaco-lia-remarcacao/appointments/${firstId}`, {
        method: 'PATCH', body: JSON.stringify({ serviceId: secondService.id, date: newDay,
          time: newTime, reason: 'Prefiro outro dia' }),
      }, firstCookie);
      expect(changed.status).toBe(200);
      expect(changed.body.date).toBe(newDay);
      expect(changed.body.serviceId).toBe(secondService.id);
      expect(changed.body.notificationStatus).toBe('simulated');
      const inboxAfterChange = await request('/api/inbox', {}, ownerCookie);
      expect(inboxAfterChange.body.items.some((item: any) => item.appointmentId === firstId
        && item.kind === 'booking_changed')).toBe(true);
      const oldAvailability = await request(`/api/public/espaco-lia-remarcacao/availability?serviceId=${firstService.id}&date=${day}`);
      expect(oldAvailability.body.slots).toContain(firstTime);
      const newAvailability = await request(`/api/public/espaco-lia-remarcacao/availability?serviceId=${secondService.id}&date=${newDay}`);
      assert.equal(newAvailability.body.slots.includes(newTime), false);
      const ownerSchedule = await request(`/api/appointments?from=${day}&to=${newDay}`, {}, ownerCookie);
      expect(ownerSchedule.body.find((item: any) => item.id === firstId).date).toBe(newDay);
      const clientSchedule = await request('/api/client/appointments', {}, firstCookie);
      expect(clientSchedule.body.find((item: any) => item.id === firstId).time).toBe(newTime);

      const staleOwnerRequest = await request(`/api/appointments/${firstId}/reschedule-request`, {
        method: 'PATCH', body: JSON.stringify({ expectedDate: day, expectedTime: firstTime,
          expectedServiceId: firstService.id }),
      }, ownerCookie);
      expect(staleOwnerRequest.status).toBe(409);
      const ownerRequest = await request(`/api/appointments/${firstId}/reschedule-request`, {
        method: 'PATCH', body: JSON.stringify({ expectedDate: newDay, expectedTime: newTime,
          expectedServiceId: secondService.id, reason: 'Compromisso inesperado' }),
      }, ownerCookie);
      expect(ownerRequest.status).toBe(200);
      expect(ownerRequest.body.status).toBe('cancelled');
      expect(ownerRequest.body.notificationStatus).toBe('simulated');
      const reopened = await request(`/api/public/espaco-lia-remarcacao/availability?serviceId=${secondService.id}&date=${newDay}`);
      expect(reopened.body.slots).toContain(newTime);
      expect((await request(`/api/client/appointments/${firstId}/cancel`, { method: 'PATCH' }, firstCookie)).status).toBe(409);
      const ownerCancel = await request(`/api/appointments/${secondId}/cancel-by-owner`, {
        method: 'PATCH', body: JSON.stringify({ expectedDate: day, expectedTime: secondTime,
          expectedServiceId: firstService.id }),
      }, ownerCookie);
      expect(ownerCancel.status).toBe(200);
      expect(ownerCancel.body.status).toBe('cancelled');
      expect(ownerCancel.body.notificationStatus).toBe('simulated');
      expect((await request(`/api/client/appointments/${secondId}`, { method: 'PATCH',
        body: JSON.stringify({ time: firstTime }) }, secondCookie)).status).toBe(409);
      const extraBooking = await book('52998224725', '11988881111', 'Nina Costa', firstTime);
      expect(extraBooking.status).toBe(201);
      const genericCancel = await request(`/api/appointments/${extraBooking.body.appointment.id}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'cancelled', reason: 'Imprevisto na agenda' }),
      }, ownerCookie);
      expect(genericCancel.status).toBe(200);
      expect(genericCancel.body.status).toBe('cancelled');
      expect(genericCancel.body.notificationStatus).toBe('simulated');
      const clientCancelBooking = await book('52998224725', '11988881111', 'Nina Costa', firstTime);
      expect(clientCancelBooking.status).toBe(201);
      const clientCancelled = await request(`/api/client/appointments/${clientCancelBooking.body.appointment.id}/cancel`, {
        method: 'PATCH', body: JSON.stringify({ reason: 'Não poderei comparecer' }),
      }, clientCancelBooking.cookie);
      expect(clientCancelled.status).toBe(200);
      expect(clientCancelled.body.status).toBe('cancelled');
      expect(clientCancelled.body.notificationStatus).toBe('simulated');

      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const fixtureId = randomUUID();
      const auditDb = new Database(join(tempDirectory, 'nayla.sqlite'));
      try {
        auditDb.prepare(`INSERT INTO appointments
          (id,business_id,client_id,service_id,date,start_time,end_time,price_cents)
          VALUES(?,?,?,?,?,'09:00','10:00',5000)`).run(fixtureId, ownerId,
            first.body.appointment.clientId, firstService.id, today);
        const events = auditDb.prepare(`SELECT actor,kind,reason,previous_date,new_date
          FROM appointment_events WHERE business_id=? ORDER BY created_at,id`).all(ownerId) as Array<{
            actor: string; kind: string; reason: string | null; previous_date: string; new_date: string | null;
          }>;
        expect(events).toHaveLength(5);
        expect(events.some(event => event.actor === 'client' && event.kind === 'rescheduled' &&
          event.reason === 'Prefiro outro dia' && event.new_date === newDay)).toBe(true);
        expect(events.some(event => event.actor === 'owner' && event.kind === 'reschedule_requested' &&
          event.reason === 'Compromisso inesperado')).toBe(true);
        expect(events.some(event => event.actor === 'owner' && event.kind === 'cancelled')).toBe(true);
        expect(events.some(event => event.actor === 'client' && event.kind === 'cancelled' &&
          event.reason === 'Não poderei comparecer')).toBe(true);
      } finally { auditDb.close(); }
      const todayResponse = await request('/api/appointments/today', {}, ownerCookie);
      expect(todayResponse.status).toBe(200);
      expect(todayResponse.body.date).toBe(today);
      expect(todayResponse.body.appointments.find((item: any) => item.id === fixtureId).clientName).toBe('Nina Costa');
      const todayAssistant = await request('/api/assistant', { method: 'POST',
        body: JSON.stringify({ message: 'Quais atendimentos tenho hoje?' }) }, ownerCookie);
      expect(todayAssistant.status).toBe(200);
      expect(todayAssistant.body.answer).toContain('Nina Costa');
      expect(todayAssistant.body.answer).toContain('09:00');
      expect(todayAssistant.body.answer).toContain(todayResponse.body.appointments[0].serviceName);
      const historyAssistant = await request('/api/assistant', { method: 'POST',
        body: JSON.stringify({ message: 'Quais clientes remarcaram?' }) }, ownerCookie);
      expect(historyAssistant.status).toBe(200);
      expect(historyAssistant.body.answer).toContain('Nina Costa');
      expect(historyAssistant.body.answer).toContain('Remarcações feitas por clientes');
      const notices = await request('/api/notifications', {}, ownerCookie);
      expect(notices.body.filter((item: any) => item.kind !== 'booking_confirmation')).toHaveLength(5);
      expect(notices.body.some((item: any) => item.kind === 'owner_reschedule_request')).toBe(true);
      expect(notices.body.some((item: any) => item.kind === 'owner_cancelled')).toBe(true);
      expect(notices.body.some((item: any) => item.kind === 'client_cancelled' && item.status === 'simulated')).toBe(true);
      const urgentNotice = notices.body.find((item: any) => item.kind === 'owner_reschedule_request');
      expect(urgentNotice.status).toBe('simulated');
      assert.ok(urgentNotice.message.startsWith('RESPONDER URGENTE'));
      expect(urgentNotice.message).toContain('Disponibilidade: Algumas opções em');
      assert.equal(urgentNotice.message.includes('Sem horários livres neste mês'), false);
      assert.match(urgentNotice.message, /\d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/);
      const otherRegistration = await request('/api/auth/register', { method: 'POST',
        body: JSON.stringify({ ownerName: 'Sol Souza', businessName: 'Estúdio Sol',
          slug: 'studio-sol-isolado', email: 'sol@example.test',
          password: 'SenhaMuitoForte4', specialties: ['cilios'], selectedServices: selectedServices('cilios') }) });
      expect(otherRegistration.status).toBe(201);
      expect((await request('/api/appointments/today', {}, otherRegistration.cookie)).body.appointments).toHaveLength(0);
      expect((await request('/api/appointments', {}, otherRegistration.cookie)).body).toHaveLength(0);
      expect((await request('/api/notifications', {}, otherRegistration.cookie)).body).toHaveLength(0);
      expect((await request(`/api/appointments/${firstId}/cancel-by-owner`, { method: 'PATCH' },
        otherRegistration.cookie)).status).toBe(404);
      const deletedOwner = await request('/api/auth/account', { method: 'DELETE',
        body: JSON.stringify({ password: 'SenhaMuitoForte3' }) }, ownerCookie);
      expect(deletedOwner.status).toBe(204);
      const cleanupDb = new Database(join(tempDirectory, 'nayla.sqlite'), { readonly: true });
      try {
        expect((cleanupDb.prepare('SELECT COUNT(*) AS total FROM appointment_events WHERE business_id=?')
          .get(ownerId) as { total: number }).total).toBe(0);
        expect((cleanupDb.pragma('foreign_key_check') as unknown[]).length).toBe(0);
      } finally { cleanupDb.close(); }
    });

  it('analyzes each business with explicit denominators and answers follow-up questions', { timeout: 30_000 }, async () => {
    const ownerRegistration = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
      ownerName: 'Laura Martins', businessName: 'Ateliê Laura', slug: 'atelie-laura-analises',
      email: 'laura.analises@example.test', password: 'SenhaAnaliseForte1!', specialties: ['unhas'],
      selectedServices: selectedServices('unhas'),
    }) });
    expect(ownerRegistration.status).toBe(201);
    const ownerCookie = ownerRegistration.cookie!;
    const businessId = ownerRegistration.body.business.id as string;
    const catalog = await request('/api/public/atelie-laura-analises');
    const [firstService, secondService] = catalog.body.services as Array<{ id: string }>;
    assert.ok(firstService && secondService);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const dayOffset = (days: number) => {
      const date = new Date(`${today}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    const fixtureDb = new Database(join(tempDirectory, 'nayla.sqlite'));
    try {
      const clientA = randomUUID();
      const clientB = randomUUID();
      const clientC = randomUUID();
      const clientD = randomUUID();
      const createClient = fixtureDb.prepare(`INSERT INTO users
        (id,business_id,role,name,password_hash) VALUES(?,?,'client',?,'test-only')`);
      createClient.run(clientA, businessId, 'Ana Costa');
      createClient.run(clientB, businessId, 'Bia Lima');
      createClient.run(clientC, businessId, 'Cris Melo');
      createClient.run(clientD, businessId, 'Dani Reis');
      const createAppointment = fixtureDb.prepare(`INSERT INTO appointments
        (id,business_id,client_id,service_id,date,start_time,end_time,status,price_cents)
        VALUES(?,?,?,?,?,'10:00','11:00',?,?)`);
      const createEntry = fixtureDb.prepare(`INSERT INTO financial_entries
        (id,business_id,appointment_id,type,description,amount_cents,date)
        VALUES(?,?,?,'income','Atendimento concluído',?,?)`);
      const visit = (clientId: string, serviceId: string, date: string,
        status: string, cents: number) => {
        const appointmentId = randomUUID();
        createAppointment.run(appointmentId, businessId, clientId, serviceId, date, status, cents);
        if (status === 'completed') createEntry.run(randomUUID(), businessId, appointmentId, cents, date);
      };
      visit(clientA, firstService.id, dayOffset(-8), 'completed', 10000);
      visit(clientA, firstService.id, dayOffset(-3), 'completed', 12000);
      visit(clientA, firstService.id, today, 'completed', 8000);
      visit(clientB, secondService.id, dayOffset(-1), 'completed', 20000);
      visit(clientC, secondService.id, today, 'cancelled', 15000);
      visit(clientD, secondService.id, today, 'no_show', 20000);
      fixtureDb.prepare(`INSERT INTO financial_entries
        (id,business_id,type,description,amount_cents,date)
        VALUES(?,?,'income','Venda avulsa',3000,?)`).run(randomUUID(), businessId, today);
      fixtureDb.prepare(`INSERT INTO financial_entries
        (id,business_id,type,description,amount_cents,date)
        VALUES(?,?,'expense','Materiais',2000,?)`).run(randomUUID(), businessId, today);
    } finally { fixtureDb.close(); }

    expect((await request('/api/analytics?period=7')).status).toBe(401);
    expect((await request('/api/analytics?period=8', {}, ownerCookie)).status).toBe(400);
    const result = await request('/api/analytics?period=7', {}, ownerCookie);
    expect(result.status).toBe(200);
    const analysis = result.body;
    expect(analysis.period.from).toBe(dayOffset(-6));
    expect(analysis.period.previousFrom).toBe(dayOffset(-13));
    expect(analysis.series).toHaveLength(7);
    expect(analysis.overview.income.current).toBe(430);
    expect(analysis.overview.income.previous).toBe(100);
    expect(analysis.overview.expenses.current).toBe(20);
    expect(analysis.overview.balance.current).toBe(410);
    expect(analysis.overview.completed.current).toBe(3);
    expect(analysis.overview.ticketAverage.current).toBe(133.33);
    expect(analysis.overview.ticketAverage.previous).toBe(100);
    expect(analysis.overview.clientsServed).toBe(2);
    expect(analysis.clients.new).toBe(1);
    expect(analysis.clients.returning).toBe(1);
    expect(analysis.clients.retention).toEqual({ eligible: 1, returned: 1, rate: 100 });
    expect(analysis.clients.frequency).toEqual({ one: 1, two: 1, threePlus: 0 });
    expect(analysis.clients.top[0].name).toBe('Ana Costa');
    expect(analysis.appointments.denominator).toBe(5);
    expect(analysis.appointments.cancellationRate).toBe(20);
    expect(analysis.appointments.noShowRate).toBe(20);
    expect(analysis.services.find((item: any) => item.id === firstService.id).ticketAverage).toBe(100);
    expect(analysis.series.find((item: any) => item.date === today).ticketAverage).toBe(80);
    expect(analysis.insights.find((item: any) => item.category === 'finance').explanation).toContain('R$');

    const ticketAnswer = await request('/api/assistant', { method: 'POST',
      body: JSON.stringify({ message: 'Qual meu ticket médio nos últimos 7 dias?' }) }, ownerCookie);
    expect(ticketAnswer.status).toBe(200);
    expect(ticketAnswer.body.answer).toContain('133,33');
    const clientsAnswer = await request('/api/assistant', { method: 'POST',
      body: JSON.stringify({ message: 'Quais clientes mais vieram nos últimos 7 dias?' }) }, ownerCookie);
    expect(clientsAnswer.body.answer).toContain('Ana Costa');
    const rateAnswer = await request('/api/assistant', { method: 'POST',
      body: JSON.stringify({ message: 'Qual a taxa de cancelamento de clientes nos últimos 7 dias?' }) }, ownerCookie);
    expect(rateAnswer.body.answer).toContain('20%');
    const profitAnswer = await request('/api/assistant', { method: 'POST',
      body: JSON.stringify({ message: 'Qual serviço é mais lucrativo nos últimos 7 dias?' }) }, ownerCookie);
    expect(profitAnswer.body.answer).toContain('não representam lucro');
    const otherRegistration = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
      ownerName: 'Nina Ribeiro', businessName: 'Studio Nina', slug: 'studio-nina-analises',
      email: 'nina.analises@example.test', password: 'SenhaAnaliseForte2!', specialties: ['cilios'],
      selectedServices: selectedServices('cilios'),
    }) });
    expect(otherRegistration.status).toBe(201);
    const isolated = await request('/api/analytics?period=7', {}, otherRegistration.cookie);
    expect(isolated.status).toBe(200);
    expect(isolated.body.overview.income.current).toBe(0);
    expect(isolated.body.overview.clientsServed).toBe(0);
    expect(isolated.body.clients.top).toHaveLength(0);
  });
});
