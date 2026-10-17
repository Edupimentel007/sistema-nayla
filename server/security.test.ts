import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import sharp from 'sharp';
import { assertProductionSecurityConfiguration, browserRequestGuard, securityHeaders } from './security.js';
import { sanitizeLogo } from './logo.js';

describe('security boundaries', () => {
  const previous = { origin: process.env.APP_ORIGIN, mode: process.env.NODE_ENV };
  let server: ReturnType<ReturnType<typeof express>['listen']>;
  let origin: string;

  before(async () => {
    process.env.NODE_ENV = 'test';
    const app = express();
    app.use(securityHeaders, browserRequestGuard);
    app.post('/api/mutate', (_req, res) => res.json({ ok: true }));
    app.get('/api/health', (_req, res) => res.json({ ok: true }));
    app.get('/', (_req, res) => res.type('html').send('<h1>Nayla</h1>'));
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(ready => server.once('listening', ready));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.APP_ORIGIN = origin;
  });

  after(async () => {
    if (server) await new Promise<void>(done => server.close(() => done()));
    if (previous.origin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previous.origin;
    if (previous.mode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.mode;
  });

  it('blocks foreign Origin, Referer and Fetch Metadata mutations while allowing the native app', async () => {
    const post = (headers: Record<string, string>) => fetch(`${origin}/api/mutate`, { method: 'POST', headers });
    assert.equal((await post({ Origin: origin, 'Sec-Fetch-Site': 'same-origin' })).status, 200);
    assert.equal((await post({ Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post({ 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await post({ Referer: 'https://evil.example/form' })).status, 403);
    assert.equal((await post({ Origin: 'capacitor://localhost', 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await post({ Origin: 'capacitor://localhost', 'Sec-Fetch-Site': 'cross-site',
      'X-Nayla-App': 'mobile' })).status, 200);
  });

  it('sets browser security headers and disables API caching', async () => {
    const page = await fetch(origin);
    assert.match(page.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
    assert.match(page.headers.get('content-security-policy') || '', /img-src 'self' data: blob:/);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    const api = await fetch(`${origin}/api/health`);
    assert.equal(api.headers.get('cache-control'), 'no-store');
    assert.equal(api.headers.get('x-content-type-options'), 'nosniff');
  });

  it('requires a canonical HTTPS origin in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ORIGIN = 'http://example.com';
    assert.throws(assertProductionSecurityConfiguration, /HTTPS/);
    process.env.APP_ORIGIN = 'https://example.com/path';
    assert.throws(assertProductionSecurityConfiguration, /HTTPS/);
    process.env.APP_ORIGIN = 'https://example.com';
    assert.doesNotThrow(assertProductionSecurityConfiguration);
    process.env.NODE_ENV = 'test';
    process.env.APP_ORIGIN = origin;
  });

  it('does not trust a forged Host header as the browser origin in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ORIGIN = 'https://nayla.example';
    try {
      const response = await fetch(`${origin}/api/mutate`, { method: 'POST',
        headers: { Host: 'evil.example', Origin: 'https://evil.example' } });
      assert.equal(response.status, 403);
    } finally {
      process.env.NODE_ENV = 'test';
      process.env.APP_ORIGIN = origin;
    }
  });

  it('decodes logos, removes metadata and rejects content-type spoofing', async () => {
    const privateLabel = 'PRIVATE-GPS-LOCATION';
    const uploaded = await sharp({ create: { width: 32, height: 24, channels: 3,
      background: '#a45a75' } }).jpeg()
      .withMetadata({ exif: { IFD0: { ImageDescription: privateLabel } } }).toBuffer();
    assert.equal((await sharp(uploaded).metadata()).exif?.includes(privateLabel), true);
    const safe = await sanitizeLogo(uploaded, 'image/jpeg');
    const metadata = await sharp(safe).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.exif, undefined);
    assert.equal(safe.includes(privateLabel), false);
    await assert.rejects(sanitizeLogo(uploaded, 'image/png'));
    await assert.rejects(sanitizeLogo(Buffer.from('not an image'), 'image/jpeg'));
  });
});
