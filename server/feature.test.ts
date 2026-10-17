import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { catalog as serviceTemplates } from './catalog.js';

let child: ChildProcessWithoutNullStreams;
let directory: string;
let baseUrl: string;
let output = '';

async function freePort() {
  const server = createServer();
  await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Port unavailable');
  await new Promise<void>(closed => server.close(() => closed()));
  return address.port;
}

async function request(path: string, options: RequestInit = {}, cookie?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
  });
  return {
    status: response.status,
    body: response.status === 204 ? null : await response.json() as any,
    cookie: response.headers.get('set-cookie')?.split(';')[0],
    setCookie: response.headers.get('set-cookie') || '',
  };
}

const owner = (name: string, slug: string, email: string, specialty: string) => ({
  ownerName: name, businessName: `${name} Studio`, slug, email,
  password: 'SenhaForte#2026', specialties: [specialty],
  selectedServices: serviceTemplates.filter(item => item.category === specialty).map(item => item.id),
});

function futureWorkday() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 10);
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function sessionLifetime(token: string) {
  const db = new Database(join(directory, 'nayla.sqlite'));
  try {
    const hash = createHash('sha256').update(token).digest('hex');
    const session = db.prepare('SELECT expires_at FROM sessions WHERE token_hash=?')
      .get(hash) as { expires_at: number } | undefined;
    assert.ok(session, 'a sessão deve existir no banco');
    return session.expires_at - Date.now();
  } finally { db.close(); }
}

describe('recursos Nayla', () => {
  before(async () => {
    directory = mkdtempSync(join(tmpdir(), 'nayla-features-'));
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: resolve('.'),
      env: { ...process.env, PORT: String(port), DATABASE_PATH: join(directory, 'nayla.sqlite'),
        NODE_ENV: 'test', OPENAI_API_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '',
        WHATSAPP_MODE: 'simulate', WHATSAPP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
        APP_ORIGIN: baseUrl },
    });
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', chunk => { output += String(chunk); });
    for (let attempt = 0; attempt < 150; attempt++) {
      try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; }
      catch { /* starting */ }
      if (child.exitCode !== null) break;
      await new Promise(wait => setTimeout(wait, 100));
    }
    throw new Error(`API did not start: ${output}`);
  }, { timeout: 25_000 });

  after(async () => {
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([
        new Promise<void>(done => child.once('exit', () => done())),
        new Promise<void>(done => setTimeout(done, 3000)),
      ]);
    }
    if (directory?.startsWith(join(tmpdir(), 'nayla-features-')))
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  it('enforces specialty at write, public catalog, availability and booking boundaries', async () => {
    const registered = await request('/api/auth/register', { method: 'POST', body: JSON.stringify(
      owner('Ana Silva', 'ana-features', 'ana-features@example.test', 'unhas')) });
    assert.equal(registered.status, 201);
    const cookie = registered.cookie!;
    const catalog = await request('/api/public/ana-features');
    assert.equal(catalog.status, 200);
    assert.ok(catalog.body.services.length > 0);
    assert.ok(catalog.body.services.every((item: any) => item.category === 'unhas'));
    const nailService = catalog.body.services[0];
    const foreignCategory = await request('/api/services', { method: 'POST', body: JSON.stringify({
      name: 'Extensão de cílios', description: '', category: 'cilios',
      durationMinutes: 60, price: 100, active: true,
    }) }, cookie);
    assert.ok(foreignCategory.status >= 400 && foreignCategory.status < 500);
    const changedCategory = await request(`/api/services/${nailService.id}`, {
      method: 'PATCH', body: JSON.stringify({ category: 'cilios' }),
    }, cookie);
    assert.ok(changedCategory.status >= 400 && changedCategory.status < 500);

    const changedArea = await request('/api/business', { method: 'PATCH',
      body: JSON.stringify({ specialties: ['cilios'] }) }, cookie);
    assert.equal(changedArea.status, 200);
    const afterChange = await request('/api/public/ana-features');
    assert.ok(afterChange.body.services.every((item: any) => item.category === 'cilios'));
    assert.ok(!afterChange.body.services.some((item: any) => item.id === nailService.id));
    const day = futureWorkday();
    const slots = await request(`/api/public/ana-features/availability?serviceId=${nailService.id}&date=${day}`);
    assert.ok(slots.status >= 400 && slots.status < 500);
    const booking = await request('/api/public/ana-features/bookings', { method: 'POST',
      body: JSON.stringify({ serviceId: nailService.id, date: day, time: '09:00', client: {
        name: 'Clara Mendes', cpf: '52998224725', phone: '11999998888',
        password: 'SenhaCliente#2026', whatsappOptIn: false,
      } }),
    });
    assert.ok(booking.status >= 400 && booking.status < 500);
  });

  it('shows only the individual services selected by each beauty professional', async () => {
    const availableTemplates = await request('/api/catalog');
    assert.equal(availableTemplates.status, 200);
    assert.ok(availableTemplates.body.services.some((item: any) => item.category === 'estetica_facial'));
    const chosen = [
      serviceTemplates.find(item => item.category === 'cabelos')!,
      serviceTemplates.find(item => item.category === 'maquiagem')!,
    ];
    const register = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
      ownerName: 'Dora Vieira', businessName: 'Studio Dora', slug: 'studio-dora-beleza',
      email: 'dora-beleza@example.test', password: 'SenhaForte#2026',
      specialties: ['cabelos', 'maquiagem'], selectedServices: chosen.map(item => item.id),
      customServices: [{ category: 'cabelos', name: 'Tranças', price: 160, durationMinutes: 120 }],
    }) });
    assert.equal(register.status, 201);
    const visible = await request('/api/public/studio-dora-beleza');
    assert.deepEqual(new Set(visible.body.services.map((item: any) => item.name)),
      new Set([...chosen.map(item => item.name), 'Tranças']));
    const all = await request('/api/services', {}, register.cookie);
    assert.equal(all.status, 200);
    assert.ok(all.body.length > chosen.length);
    assert.equal(all.body.filter((item: any) => item.active).length, chosen.length + 1);

    const foreign = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
      ownerName: 'Lena Silva', businessName: 'Studio Lena', slug: 'studio-lena-invalido',
      email: 'lena-invalido@example.test', password: 'SenhaForte#2026',
      specialties: ['unhas'], selectedServices: [chosen[0].id],
    }) });
    assert.equal(foreign.status, 400);

    const addArea = await request('/api/business', { method: 'PATCH',
      body: JSON.stringify({ specialties: ['cabelos', 'maquiagem', 'bronzeamento'] }) }, register.cookie);
    assert.equal(addArea.status, 200);
    const withNewArea = await request('/api/services', {}, register.cookie);
    const bronze = withNewArea.body.find((item: any) => item.category === 'bronzeamento');
    assert.ok(bronze);
    assert.equal(bronze.active, false);
    const stillVisible = await request('/api/public/studio-dora-beleza');
    assert.equal(stillVisible.body.services.length, chosen.length + 1);
    const activated = await request(`/api/services/${bronze.id}`, { method: 'PATCH',
      body: JSON.stringify({ active: true }) }, register.cookie);
    assert.equal(activated.status, 200);
    const nowVisible = await request('/api/public/studio-dora-beleza');
    assert.ok(nowVisible.body.services.some((item: any) => item.id === bronze.id));

    const custom = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
      ownerName: 'Tina Rocha', businessName: 'Studio Tina', slug: 'studio-tina-outros',
      email: 'tina-outros@example.test', password: 'SenhaForte#2026',
      specialties: ['outros'], selectedServices: [],
      customServices: [{ category: 'outros', name: 'Atendimento personalizado', price: 100, durationMinutes: 60 }],
    }) });
    assert.equal(custom.status, 201);
    const customPublic = await request('/api/public/studio-tina-outros');
    assert.equal(customPublic.body.services.length, 1);
    assert.equal(customPublic.body.services[0].name, 'Atendimento personalizado');
    const missing = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
      ownerName: 'Vera Lima', businessName: 'Studio Vera', slug: 'studio-vera-sem-servicos',
      email: 'vera-sem-servicos@example.test', password: 'SenhaForte#2026',
      specialties: ['outros'], selectedServices: [],
    }) });
    assert.equal(missing.status, 400);
    const wrongCategory = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({
      ownerName: 'Mara Costa', businessName: 'Studio Mara', slug: 'studio-mara-sem-outros',
      email: 'mara-sem-outros@example.test', password: 'SenhaForte#2026',
      specialties: ['unhas'], selectedServices: [serviceTemplates.find(item => item.category === 'unhas')!.id],
      customServices: [{ category: 'cabelos', name: 'Especial', price: 50, durationMinutes: 30 }],
    }) });
    assert.equal(wrongCategory.status, 400);
  });

  it('keeps each uploaded logo with its own business and serves it publicly', async () => {
    const first = await request('/api/auth/register', { method: 'POST', body: JSON.stringify(
      owner('Bia Santos', 'bia-logo', 'bia-logo@example.test', 'sobrancelhas')) });
    const second = await request('/api/auth/register', { method: 'POST', body: JSON.stringify(
      owner('Cris Oliveira', 'cris-logo', 'cris-logo@example.test', 'cilios')) });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const png = await sharp({ create: { width: 2, height: 2, channels: 3,
      background: '#b57c91' } }).png().toBuffer();
    const uploaded = await fetch(`${baseUrl}/api/business/logo`, { method: 'POST',
      headers: { Cookie: first.cookie!, 'Content-Type': 'image/png' }, body: png });
    assert.equal(uploaded.status, 200);
    const url = (await uploaded.json() as { logoUrl: string }).logoUrl;
    assert.ok(url.startsWith('/api/public/bia-logo/logo?v='));
    const ownerA = await request('/api/business', {}, first.cookie);
    const ownerB = await request('/api/business', {}, second.cookie);
    assert.equal(ownerA.body.logoUrl, url);
    assert.equal(ownerB.body.logoUrl, null);
    const publicA = await fetch(`${baseUrl}${url}`);
    assert.equal(publicA.status, 200);
    assert.equal(publicA.headers.get('content-type'), 'image/webp');
    assert.notDeepEqual(Buffer.from(await publicA.arrayBuffer()), png);
    assert.equal(publicA.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await fetch(`${baseUrl}/api/public/cris-logo/logo`)).status, 404);
    const deletedByB = await request('/api/business/logo', { method: 'DELETE' }, second.cookie);
    assert.equal(deletedByB.status, 200);
    assert.equal((await fetch(`${baseUrl}${url}`)).status, 200);
  });

  it('requires new login within a week, with optional persistent cookie, and explains unavailable Google login', async () => {
    const configured = await request('/api/auth/google/config');
    assert.equal(configured.status, 200);
    assert.equal(configured.body.enabled, false);
    const googleStart = await request('/api/auth/google/start', { method: 'POST',
      body: JSON.stringify({ role: 'owner', remember: true }) });
    assert.equal(googleStart.status, 503);
    assert.ok(typeof googleStart.body.error === 'string' && googleStart.body.error.length > 0);
    const clientGoogleStart = await request('/api/auth/google/start', { method: 'POST',
      body: JSON.stringify({ role: 'client', slug: 'ana-features', remember: true }) });
    assert.equal(clientGoogleStart.status, 503);

    const saved = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({
      email: 'ana-features@example.test', password: 'SenhaForte#2026', remember: true,
    }) });
    assert.equal(saved.status, 200);
    assert.match(saved.setCookie, /Max-Age=604800/i);
    const persistentToken = saved.cookie!.split('=')[1];
    const week = 7 * 24 * 60 * 60_000;
    assert.ok(Math.abs(sessionLifetime(persistentToken) - week) < 5000);

    const temporary = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({
      email: 'ana-features@example.test', password: 'SenhaForte#2026', remember: false,
    }) });
    assert.equal(temporary.status, 200);
    assert.doesNotMatch(temporary.setCookie, /Max-Age=/i);
    const day = 24 * 60 * 60_000;
    assert.ok(Math.abs(sessionLifetime(temporary.cookie!.split('=')[1]) - day) < 5000);

    const native = await request('/api/auth/login', { method: 'POST',
      headers: { Origin: 'capacitor://localhost', 'X-Nayla-App': 'mobile' },
      body: JSON.stringify({ email: 'ana-features@example.test', password: 'SenhaForte#2026', remember: true }),
    });
    assert.equal(native.status, 200);
    assert.match(native.body.sessionToken, /^[a-f0-9]{64}$/);
    assert.ok(Math.abs(sessionLifetime(native.body.sessionToken) - week) < 5000);
    const db = new Database(join(directory, 'nayla.sqlite'));
    try {
      const tokenHash = createHash('sha256').update(native.body.sessionToken).digest('hex');
      const expiredAt = Date.now() - 1000;
      const changed = db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?')
        .run(expiredAt, tokenHash);
      assert.equal(changed.changes, 1);
      assert.equal((db.prepare('SELECT expires_at FROM sessions WHERE token_hash=?')
        .get(tokenHash) as { expires_at: number }).expires_at, expiredAt);
    } finally { db.close(); }
    const expired = await request('/api/auth/me', { headers: {
      Origin: 'capacitor://localhost', Authorization: `Bearer ${native.body.sessionToken}`,
    } });
    assert.equal(expired.status, 401);

    const clientOwner = await request('/api/auth/register', { method: 'POST', body: JSON.stringify(
      owner('Dani Ramos', 'dani-client-session', 'dani-client@example.test', 'unhas')) });
    assert.equal(clientOwner.status, 201);
    const publicBusiness = await request('/api/public/dani-client-session');
    const serviceId = publicBusiness.body.services[0].id as string;
    const bookingDate = futureWorkday();
    const available = await request(`/api/public/dani-client-session/availability?serviceId=${serviceId}&date=${bookingDate}`);
    assert.equal(available.status, 200);
    assert.ok(available.body.slots.length > 0);
    const clientBooking = await request('/api/public/dani-client-session/bookings', {
      method: 'POST', body: JSON.stringify({ serviceId, date: bookingDate,
        time: available.body.slots[0], remember: true, client: {
          name: 'Elisa Martins', cpf: '52998224725', phone: '11988887777',
          password: 'SenhaCliente#2026', whatsappOptIn: false,
        } }),
    });
    assert.equal(clientBooking.status, 201);
    assert.match(clientBooking.setCookie, /Max-Age=604800/i);
    assert.ok(Math.abs(sessionLifetime(clientBooking.cookie!.split('=')[1]) - week) < 5000);
    const clientTemporary = await request('/api/client/login', { method: 'POST',
      body: JSON.stringify({ slug: 'dani-client-session', identifier: '52998224725',
        password: 'SenhaCliente#2026', remember: false }),
    });
    assert.equal(clientTemporary.status, 200);
    assert.doesNotMatch(clientTemporary.setCookie, /Max-Age=/i);
    assert.ok(Math.abs(sessionLifetime(clientTemporary.cookie!.split('=')[1]) - day) < 5000);
  });
});
