import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
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

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const setCookies = response.headers.getSetCookie().map(value => value.split(';')[0]);
  return { status: response.status, body: await response.json() as any,
    cookie: setCookies.find(value => value.startsWith('nayla_owner_session=')) || setCookies[0] || '' };
}

describe('Google OAuth entry', () => {
  before(async () => {
    directory = mkdtempSync(join(tmpdir(), 'nayla-google-'));
    baseUrl = `http://localhost:${await freePort()}`;
    child = spawn(process.execPath, ['--import', 'tsx', '--import', './server/googleAuth.mock.ts', 'server/index.ts'], {
      cwd: resolve('.'), env: { ...process.env, PORT: new URL(baseUrl).port,
        DATABASE_PATH: join(directory, 'nayla.sqlite'), NODE_ENV: 'test',
        APP_ORIGIN: baseUrl, GOOGLE_CLIENT_ID: 'testing-client.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'testing-secret', OPENAI_API_KEY: '', WHATSAPP_MODE: 'simulate' },
    });
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', chunk => { output += String(chunk); });
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; }
      catch { /* starting */ }
      if (child.exitCode !== null) break;
      await new Promise(wait => setTimeout(wait, 100));
    }
    throw new Error(`API did not start: ${output}`);
  }, { timeout: 20_000 });

  after(async () => {
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise<void>(done => child.once('exit', () => done())),
        new Promise<void>(done => setTimeout(done, 3000))]);
    }
    if (directory?.startsWith(join(tmpdir(), 'nayla-google-')))
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  it('binds authorization to browser state and a registered callback', async () => {
    const config = await fetch(`${baseUrl}/api/auth/google/config`).then(response => response.json()) as { enabled: boolean };
    assert.equal(config.enabled, true);
    const started = await post('/api/auth/google/start', { role: 'owner', remember: true });
    assert.equal(started.status, 200);
    assert.ok(started.cookie.startsWith('nayla_google_flow='));
    const authorize = new URL(started.body.authorizationUrl);
    assert.equal(authorize.origin, 'https://accounts.google.com');
    assert.equal(authorize.searchParams.get('redirect_uri'), `${baseUrl}/api/auth/google/callback`);
    assert.equal(authorize.searchParams.get('client_id'), 'testing-client.apps.googleusercontent.com');
    assert.equal(authorize.searchParams.get('response_type'), 'code');
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    assert.match(authorize.searchParams.get('code_challenge') || '', /^[A-Za-z0-9_-]{43}$/);
    assert.ok(authorize.searchParams.get('state'));
    assert.ok(authorize.searchParams.get('nonce'));

    const state = encodeURIComponent(authorize.searchParams.get('state')!);
    const noCookie = await fetch(`${baseUrl}/api/auth/google/callback?state=${state}&error=access_denied`,
      { redirect: 'manual' });
    assert.equal(noCookie.status, 401);
    const cancelled = await fetch(`${baseUrl}/api/auth/google/callback?state=${state}&error=access_denied`,
      { headers: { Cookie: started.cookie }, redirect: 'manual' });
    assert.equal(cancelled.status, 303);
    assert.equal(cancelled.headers.get('location'), `${baseUrl}/entrar?google_error=cancelled`);
    const reused = await fetch(`${baseUrl}/api/auth/google/callback?state=${state}&error=access_denied`,
      { headers: { Cookie: started.cookie }, redirect: 'manual' });
    assert.equal(reused.status, 401);
  });

  it('scopes client login to an existing business and binds native return to app nonce', async () => {
    const owner = await post('/api/auth/register', { ownerName: 'Maria Silva', businessName: 'Studio Maria',
      slug: 'studio-maria-google', email: 'maria-google@example.test',
      password: 'SenhaForte#2026', specialties: ['unhas'],
      selectedServices: serviceTemplates.filter(item => item.category === 'unhas').map(item => item.id) });
    assert.equal(owner.status, 201);
    const unknown = await post('/api/auth/google/start', { role: 'client', slug: 'nao-existe', remember: true });
    assert.equal(unknown.status, 404);
    const appNonce = 'a'.repeat(64);
    const native = await post('/api/auth/google/start', { role: 'client',
      slug: 'studio-maria-google', remember: true, appNonce },
    { Origin: 'capacitor://localhost', 'X-Nayla-App': 'mobile' });
    assert.equal(native.status, 200);
    assert.equal(native.cookie, '');
    const state = new URL(native.body.authorizationUrl).searchParams.get('state');
    const cancelled = await fetch(`${baseUrl}/api/auth/google/callback?state=${state}&error=access_denied`,
      { redirect: 'manual' });
    assert.equal(cancelled.status, 303);
    assert.equal(cancelled.headers.get('location'), 'com.edupimentel.nayla://auth?error=cancelled');
  });

  it('verifies a signed Google token, creates owner and client accounts, and consumes one-time tickets', async () => {
    const callback = async (started: { body: any; cookie: string },
      account: { sub: string; email: string; name: string }, native = false) => {
      const authorization = new URL(started.body.authorizationUrl);
      const code = Buffer.from(JSON.stringify({ ...account,
        nonce: authorization.searchParams.get('nonce') })).toString('base64url');
      return fetch(`${baseUrl}/api/auth/google/callback?state=${authorization.searchParams.get('state')}&code=${code}`,
        { headers: native ? {} : { Cookie: started.cookie }, redirect: 'manual' });
    };
    const ownerStart = await post('/api/auth/google/start', { role: 'owner', remember: true });
    const ownerCallback = await callback(ownerStart,
      { sub: 'google-owner-test', email: 'new-owner-google@example.test', name: 'Nina Costa' });
    assert.equal(ownerCallback.status, 303);
    const ownerTicket = new URL(ownerCallback.headers.get('location')!).searchParams.get('google_ticket')!;
    const ownerPending = await post('/api/auth/google/complete',
      { role: 'owner', ticket: ownerTicket }, { Cookie: ownerStart.cookie });
    assert.equal(ownerPending.status, 200);
    assert.equal(ownerPending.body.registrationRequired, true);
    const invalidArea = await post('/api/auth/google/register', { role: 'owner', ticket: ownerTicket,
      ownerName: 'Nina Costa', businessName: 'Espaço Nina', slug: 'espaco-nina-google',
      specialties: ['cilios'], selectedServices: [],
      customServices: [{ category: 'unhas', name: 'Manicure especial', price: 40, durationMinutes: 60 }],
      password: 'SenhaForte#2026' }, { Cookie: ownerStart.cookie });
    assert.equal(invalidArea.status, 400);
    const ownerRegister = await post('/api/auth/google/register', { role: 'owner', ticket: ownerTicket,
      ownerName: 'Nina Costa', businessName: 'Espaço Nina', slug: 'espaco-nina-google',
      specialties: ['cilios'],
      selectedServices: serviceTemplates.filter(item => item.category === 'cilios').slice(0, 1).map(item => item.id),
      customServices: [{ category: 'cilios', name: 'Efeito delineado', price: 180, durationMinutes: 120 }],
      password: 'SenhaForte#2026' }, { Cookie: ownerStart.cookie });
    assert.equal(ownerRegister.status, 201);
    assert.equal(ownerRegister.body.business.slug, 'espaco-nina-google');
    const ownerServices = await fetch(`${baseUrl}/api/services`, { headers: { Cookie: ownerRegister.cookie } });
    assert.equal(ownerServices.status, 200);
    const registeredServices = await ownerServices.json() as Array<{ name: string; category: string; active: boolean }>;
    assert.equal(registeredServices.filter(item => item.category === 'cilios' && item.active).length, 2);
    assert.ok(registeredServices.some(item => item.name === 'Efeito delineado' && item.active));
    assert.ok(registeredServices.some(item => item.category === 'cilios' && !item.active));
    const ownerMe = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: ownerRegister.cookie } });
    assert.equal(ownerMe.status, 200);
    const consumed = await post('/api/auth/google/complete',
      { role: 'owner', ticket: ownerTicket }, { Cookie: ownerStart.cookie });
    assert.equal(consumed.status, 401);

    const appNonce = 'b'.repeat(64);
    const nativeHeaders = { Origin: 'capacitor://localhost', 'X-Nayla-App': 'mobile' };
    const clientStart = await post('/api/auth/google/start', { role: 'client',
      slug: 'studio-maria-google', remember: true, appNonce }, nativeHeaders);
    const clientCallback = await callback(clientStart,
      { sub: 'google-client-test', email: 'client-google@example.test', name: 'Lara Souza' }, true);
    assert.equal(clientCallback.status, 303);
    const clientTicket = new URL(clientCallback.headers.get('location')!).searchParams.get('ticket')!;
    const wrongApp = await post('/api/auth/google/complete', { role: 'client',
      ticket: clientTicket, appNonce: 'c'.repeat(64) }, nativeHeaders);
    assert.equal(wrongApp.status, 401);
    const clientPending = await post('/api/auth/google/complete', { role: 'client',
      ticket: clientTicket, appNonce }, nativeHeaders);
    assert.equal(clientPending.status, 200);
    assert.equal(clientPending.body.registrationRequired, true);
    const clientRegister = await post('/api/auth/google/register', { role: 'client',
      ticket: clientTicket, appNonce, name: 'Lara Souza', cpf: '52998224725',
      phone: '11912345678', password: 'SenhaForte#2026' }, nativeHeaders);
    assert.equal(clientRegister.status, 201);
    assert.match(clientRegister.body.sessionToken, /^[a-f0-9]{64}$/);
    const tokenHeaders = { Origin: 'capacitor://localhost',
      Authorization: `Bearer ${clientRegister.body.sessionToken}` };
    const ownPortal = await fetch(`${baseUrl}/api/public/studio-maria-google/me`, { headers: tokenHeaders });
    assert.equal(ownPortal.status, 200);
    const otherPortal = await fetch(`${baseUrl}/api/public/espaco-nina-google/me`, { headers: tokenHeaders });
    assert.equal(otherPortal.status, 403);
  });
});
