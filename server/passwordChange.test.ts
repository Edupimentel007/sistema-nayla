import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { catalog } from './catalog.js';

let child: ChildProcessWithoutNullStreams;
let directory: string;
let origin: string;
let output = '';

async function freePort() {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Port unavailable');
  await new Promise<void>(done => server.close(() => done()));
  return address.port;
}

async function request(path: string, method = 'GET', body?: unknown,
  headers: Record<string, string> = {}) {
  const response = await fetch(`${origin}${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status,
    body: response.status === 204 ? null : await response.json() as { error?: string; sessionToken?: string },
    cookies: response.headers.getSetCookie(),
  };
}

describe('owner password change', () => {
  before(async () => {
    directory = mkdtempSync(join(tmpdir(), 'nayla-password-change-'));
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: resolve('.'), env: { ...process.env, PORT: String(port),
        DATABASE_PATH: join(directory, 'nayla.sqlite'), NODE_ENV: 'test', APP_ORIGIN: origin,
        ACCESS_IDENTITY_SECRET: Buffer.alloc(32, 23).toString('base64'),
        OLLAMA_BASE_URL: 'http://127.0.0.1:1/v1', WHATSAPP_MODE: 'simulate' },
    });
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', chunk => { output += String(chunk); });
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`${origin}/api/health`)).ok) return; }
      catch { /* server is starting */ }
      if (child.exitCode !== null) break;
      await new Promise(done => setTimeout(done, 100));
    }
    throw new Error(`API did not start: ${output}`);
  }, { timeout: 20_000 });

  after(async () => {
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise<void>(done => child.once('exit', () => done())),
        new Promise(done => setTimeout(done, 3000))]);
    }
    if (directory?.startsWith(join(tmpdir(), 'nayla-password-change-')))
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  it('requires the current strong password and revokes browser and native sessions',
    { timeout: 30_000 }, async () => {
      const oldPassword = 'SenhaForteAnterior123';
      const newPassword = 'SenhaForteNova456';
      const email = 'password-change@example.test';
      const register = await request('/api/auth/register', 'POST', {
        ownerName: 'Profissional Teste', businessName: 'Studio Teste',
        slug: 'studio-password-change', email, password: oldPassword,
        phone: '11988887777', specialties: ['unhas'],
        selectedServices: catalog.filter(item => item.category === 'unhas').map(item => item.id),
      });
      assert.equal(register.status, 201);
      const firstCookie = register.cookies.find(value => value.startsWith('nayla_owner_session='))?.split(';')[0];
      assert.ok(firstCookie);
      const secondLogin = await request('/api/auth/login', 'POST', { email, password: oldPassword });
      assert.equal(secondLogin.status, 200);
      const secondCookie = secondLogin.cookies.find(value => value.startsWith('nayla_owner_session='))?.split(';')[0];
      assert.ok(secondCookie);
      const nativeLogin = await request('/api/auth/login', 'POST', { email, password: oldPassword },
        { Origin: 'capacitor://localhost', 'X-Nayla-App': 'mobile' });
      assert.equal(nativeLogin.status, 200);
      assert.match(nativeLogin.body?.sessionToken || '', /^[a-f0-9]{64}$/);
      const nativeHeaders = { Origin: 'capacitor://localhost',
        Authorization: `Bearer ${nativeLogin.body!.sessionToken}` };

      const unauthenticated = await request('/api/auth/change-password', 'POST',
        { currentPassword: oldPassword, newPassword });
      assert.equal(unauthenticated.status, 401);
      const forged = await request('/api/auth/change-password', 'POST',
        { currentPassword: oldPassword, newPassword },
        { Cookie: firstCookie, Origin: 'https://evil.example' });
      assert.equal(forged.status, 403);
      const wrong = await request('/api/auth/change-password', 'POST',
        { currentPassword: 'SenhaIncorreta123', newPassword }, { Cookie: firstCookie });
      assert.equal(wrong.status, 401);
      assert.match(wrong.body?.error || '', /Senha atual/);
      const weak = await request('/api/auth/change-password', 'POST',
        { currentPassword: oldPassword, newPassword: 'curta' }, { Cookie: firstCookie });
      assert.equal(weak.status, 400);
      const same = await request('/api/auth/change-password', 'POST',
        { currentPassword: oldPassword, newPassword: oldPassword }, { Cookie: firstCookie });
      assert.equal(same.status, 400);
      assert.equal((await request('/api/auth/me', 'GET', undefined, { Cookie: firstCookie })).status, 200);

      const changed = await request('/api/auth/change-password', 'POST',
        { currentPassword: oldPassword, newPassword }, { Cookie: firstCookie });
      assert.equal(changed.status, 204);
      assert.ok(changed.cookies.some(value => value.startsWith('nayla_owner_session=;')));
      assert.equal((await request('/api/auth/me', 'GET', undefined, { Cookie: firstCookie })).status, 401);
      assert.equal((await request('/api/auth/me', 'GET', undefined, { Cookie: secondCookie })).status, 401);
      assert.equal((await request('/api/auth/me', 'GET', undefined, nativeHeaders)).status, 401);
      assert.equal((await request('/api/auth/login', 'POST',
        { email, password: oldPassword })).status, 401);
      assert.equal((await request('/api/auth/login', 'POST',
        { email, password: newPassword })).status, 200);
    });
});
