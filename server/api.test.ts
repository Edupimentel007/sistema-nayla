import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

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

describe('Nayla API', () => {
  before(async () => {
    tempDirectory = mkdtempSync(join(tmpdir(), 'nayla-test-'));
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    processHandle = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: resolve('.'),
      env: { ...process.env, PORT: String(port), DATABASE_PATH: join(tempDirectory, 'nayla.sqlite'),
        NODE_ENV: 'test', OPENAI_API_KEY: '', WHATSAPP_ACCESS_TOKEN: '' },
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

  it('isolates tenants and prevents booking conflicts while keeping CRM, finance and client portal connected', { timeout: 20_000 }, async () => {
    const first = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
      ownerName: 'Ana Silva', businessName: 'Ateliê Ana', slug: 'atelie-ana-test',
      email: 'ana@example.test', password: 'SenhaMuitoForte1', specialties: ['unhas'],
    }) });
    expect(first.status).toBe(201);
    const ownerCookie = first.cookie!;
    const second = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
      ownerName: 'Bia Souza', businessName: 'Studio Bia', slug: 'studio-bia-test',
      email: 'bia@example.test', password: 'SenhaMuitoForte2', specialties: ['cilios'],
    }) });
    expect(second.status).toBe(201);
    const otherCookie = second.cookie!;

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
    expect(booked.body.notificationStatus).toBe('not_configured');
    const clientCookie = booked.cookie!;
    const duplicate = await request('/api/public/atelie-ana-test/bookings', {
      method: 'POST', body: JSON.stringify(bookingBody),
    }, clientCookie);
    expect(duplicate.status).toBe(409);

    expect((await request('/api/appointments', {}, otherCookie)).body).toEqual([]);
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
        phone: '11988886666', email: 'maria.nova@example.test' } }),
    }, clientCookie);
    expect(rebooked.status).toBe(201);
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
      method: 'POST', body: JSON.stringify({ serviceId, date: day, time: laterSlots.body.slots[0],
        client: { name: 'Joana Dias', cpf: '11144477735', phone: '11999997777',
          email: '', password: 'OutraSenhaSegura1' } }),
    });
    expect(withoutEmail.status).toBe(201);
    expect((await request('/api/public/atelie-ana-test/me', {}, withoutEmail.cookie)).body.client.email).toBe('');
    const adminDate = new Date(`${day}T12:00:00Z`);
    adminDate.setUTCDate(adminDate.getUTCDate() + 7);
    const adminDay = adminDate.toISOString().slice(0, 10);
    const adminSlots = await request(`/api/public/atelie-ana-test/availability?serviceId=${serviceId}&date=${adminDay}`);
    const manual = await request('/api/appointments', { method: 'POST', body: JSON.stringify({
      clientId: clientSession.body.client.id, serviceId, date: adminDay, time: adminSlots.body.slots[0],
      notes: 'Preferência de esmalte registrada',
    }) }, ownerCookie);
    expect(manual.status).toBe(201);
    expect(manual.body.notes).toBe('Preferência de esmalte registrada');

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const income = await request('/api/finance', { method: 'POST', body: JSON.stringify({
      type: 'income', description: 'Venda adicional', amount: 123.45, date: today,
    }) }, ownerCookie);
    expect(income.status).toBe(201);
    expect((await request('/api/dashboard?period=7', {}, ownerCookie)).body.revenue).toBe(123.45);
    expect((await request('/api/dashboard?period=7', {}, otherCookie)).body.revenue).toBe(0);
    const assistant = await request('/api/assistant', { method: 'POST',
      body: JSON.stringify({ message: 'Qual meu faturamento de hoje?' }) }, ownerCookie);
    expect(assistant.status).toBe(200);
    expect(assistant.body.answer).toContain('123,45');
    const inactive = await request('/api/assistant', { method: 'POST',
      body: JSON.stringify({ message: 'Qual cliente não voltou depois de um mês?' }) }, ownerCookie);
    expect(inactive.status).toBe(200);
    expect(inactive.body.answer).toContain('Não há clientes');

    const extraDb = new Database(join(tempDirectory, 'nayla.sqlite'));
    try {
      extraDb.transaction(() => {
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
  });
});
