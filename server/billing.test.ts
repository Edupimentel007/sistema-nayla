import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { catalog as serviceTemplates } from './catalog.js';

let mock: Server;
let app: ChildProcessWithoutNullStreams;
let directory: string;
let baseUrl: string;
let output = '';
const webhookSecret = 'nayla-mercado-pago-test-webhook-secret-long-enough';
const providerCalls: Array<{ path: string; body: any; token?: string; key?: string }> = [];
const payments = new Map<string, any>();
let paymentSequence = 1000000;
let preferenceSequence = 0;
let failNextPreference = false;

async function freePort() {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Port unavailable');
  await new Promise<void>(done => server.close(() => done()));
  return address.port;
}
async function request(path: string, method = 'GET', body?: unknown, cookie?: string,
  extraHeaders: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),
      ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any,
    cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
function makePayment(externalReference: string, amount: number, method = 'master', status = 'pending') {
  const id = String(++paymentSequence);
  const payment: any = { id, external_reference: externalReference, status, currency_id: 'BRL',
    transaction_amount: amount, payment_method_id: method, live_mode: false };
  payments.set(id, payment);
  return payment;
}
async function webhook(payment: { id: string }, valid = true, requestId = randomUUID()) {
  const ts = String(Date.now());
  const manifest = `id:${payment.id};request-id:${requestId};ts:${ts};`;
  const hmac = createHmac('sha256', webhookSecret).update(manifest).digest('hex');
  return request(`/api/billing/webhooks/mercado-pago?data.id=${payment.id}&type=payment`,
    'POST', { type: 'payment', action: 'payment.updated', data: { id: payment.id } },
    undefined, { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${valid ? hmac : '0'.repeat(64)}` });
}
async function register(slug: string, email: string, password = 'SenhaMuitoForte4') {
  const result = await request('/api/auth/register', 'POST', {
    ownerName: 'Maria Lima', businessName: 'Studio Maria', slug,
    email, password, specialties: ['unhas'],
    selectedServices: serviceTemplates.filter(item => item.category === 'unhas').map(item => item.id),
  });
  assert.equal(result.status, 201);
  return result.cookie!;
}

describe('cobrança Nayla via Mercado Pago', () => {
  before(async () => {
    directory = mkdtempSync(join(tmpdir(), 'nayla-billing-'));
    mock = createServer(async (req, res) => {
      let raw = '';
      for await (const part of req) raw += String(part);
      const body = raw ? JSON.parse(raw) : undefined;
      providerCalls.push({ path: req.url || '', body,
        token: req.headers.authorization as string, key: req.headers['x-idempotency-key'] as string });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/checkout/preferences' && req.method === 'POST') {
        const id = `pref_${++preferenceSequence}`;
        if (failNextPreference) {
          failNextPreference = false;
          res.statusCode = 502;
          res.end('{}');
          return;
        }
        res.end(JSON.stringify({ id,
          init_point: `https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=${id}` }));
      } else if (req.url === '/v1/payments' && req.method === 'POST') {
        const payment = makePayment(body.external_reference, body.transaction_amount, 'pix');
        payment.point_of_interaction = { transaction_data: {
          qr_code: '00020126580014BR.GOV.BCB.PIX0123nayla-test-pix-payload',
          qr_code_base64: 'a'.repeat(120),
        } };
        payment.date_of_expiration = body.date_of_expiration;
        res.end(JSON.stringify(payment));
      } else if (/^\/v1\/payments\/\d+$/.test(req.url || '')) {
        const payment = payments.get(req.url!.split('/').at(-1)!);
        if (!payment) { res.statusCode = 404; res.end('{}'); }
        else res.end(JSON.stringify(payment));
      } else { res.statusCode = 404; res.end('{}'); }
    });
    await new Promise<void>(done => mock.listen(0, '127.0.0.1', done));
    const address = mock.address();
    if (!address || typeof address === 'string') throw new Error('Mock port unavailable');
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    app = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: resolve('.'), env: { ...process.env, PORT: String(port), NODE_ENV: 'test',
        DATABASE_PATH: join(directory, 'nayla.sqlite'), APP_ORIGIN: baseUrl,
        MERCADO_PAGO_ACCESS_TOKEN: 'test-token-only', MERCADO_PAGO_WEBHOOK_SECRET: webhookSecret,
        MERCADO_PAGO_TEST_API_BASE_URL: `http://127.0.0.1:${address.port}`,
        OPENAI_API_KEY: '', WHATSAPP_MODE: 'simulate' },
    });
    app.stdout.on('data', chunk => { output += String(chunk); });
    app.stderr.on('data', chunk => { output += String(chunk); });
    for (let attempt = 0; attempt < 150; attempt++) {
      try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; }
      catch { /* startup */ }
      if (app.exitCode !== null) break;
      await new Promise(done => setTimeout(done, 100));
    }
    throw new Error(`Nayla did not start: ${output}`);
  }, { timeout: 25_000 });
  after(async () => {
    if (app && app.exitCode === null) {
      app.kill();
      await Promise.race([new Promise<void>(done => app.once('exit', () => done())),
        new Promise<void>(done => setTimeout(done, 3000))]);
    }
    if (mock?.listening) await new Promise<void>(done => mock.close(() => done()));
    if (directory?.startsWith(join(tmpdir(), 'nayla-billing-')))
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  });

  it('never starts a trial from registration or return URL; activates only a verified paid card payment',
    { timeout: 30_000 }, async () => {
      assert.equal((await request('/api/billing/subscription')).status, 401);
      const cookie = await register('studio-maria-billing', 'maria.billing@example.test');
      const initial = (await request('/api/billing/subscription', 'GET', undefined, cookie)).body;
      assert.equal(initial.status, 'none');
      assert.equal(initial.trialRequiresCard, false);
      assert.equal(initial.trialAvailable, true);
      assert.equal(initial.trialEndsAt, null);
      assert.equal(initial.accessGranted, false);
      assert.equal((await request('/api/dashboard', 'GET', undefined, cookie)).status, 402);
      assert.equal((await request('/api/public/studio-maria-billing/bookings', 'POST', {})).status, 503);
      assert.equal((await request('/api/billing/onboarding', 'PATCH', { completed: true }, cookie)).status, 200);
      assert.equal((await request('/api/billing/checkout', 'POST',
        { plan: 'monthly', method: 'card', amount: 0.01 }, cookie)).status, 400);
      const checkout = await request('/api/billing/checkout', 'POST',
        { plan: 'monthly', method: 'card' }, cookie);
      assert.equal(checkout.status, 200);
      assert.match(checkout.body.checkoutUrl, /^https:\/\/www\.mercadopago\.com\.br\/checkout\/v1\/redirect\?pref_id=/);
      const call = providerCalls.find(item => item.path === '/checkout/preferences')!;
      assert.equal(call.token, 'Bearer test-token-only');
      assert.equal(call.body.items[0].unit_price, 49.9);
      assert.equal(call.body.external_reference.length, 36);
      assert.equal(call.body.payment_methods.installments, 1);
      assert.equal(JSON.stringify(call.body).includes('card_number'), false);
      assert.equal(call.body.notification_url, `${baseUrl}/api/billing/webhooks/mercado-pago`);
      assert.equal((await fetch(`${baseUrl}/app/boas-vindas?pagamento=retorno`)).status, 200);
      assert.equal((await request('/api/billing/subscription', 'GET', undefined, cookie)).body.accessGranted, false);
      const unrelated = makePayment('another-merchant-order', 49.9);
      unrelated.status = 'approved';
      assert.equal((await webhook(unrelated)).status, 200, 'unrelated Mercado Pago payments are ignored');
      const payment = makePayment(call.body.external_reference, 49.9);
      payment.status = 'approved';
      assert.equal((await webhook(payment, false)).status, 401);
      assert.equal((await request('/api/billing/subscription', 'GET', undefined, cookie)).body.status, 'pending');
      payment.transaction_amount = 0.01;
      assert.equal((await webhook(payment)).status, 200);
      assert.equal((await request('/api/billing/subscription', 'GET', undefined, cookie)).body.status, 'pending');
      payment.transaction_amount = 49.9;
      const requestId = randomUUID();
      assert.equal((await webhook(payment, true, requestId)).status, 200);
      const paid = (await request('/api/billing/subscription', 'GET', undefined, cookie)).body;
      assert.equal(paid.status, 'active');
      assert.equal(paid.plan, 'monthly');
      assert.equal(paid.accessGranted, true);
      assert.equal((await request('/api/billing/trial', 'POST', {}, cookie)).status, 409);
      assert.equal((await request('/api/dashboard', 'GET', undefined, cookie)).status, 200);
      assert.equal((await webhook(payment, true, requestId)).status, 200);
      assert.equal((await request('/api/billing/subscription', 'GET', undefined, cookie)).body.currentPeriodEnd,
        paid.currentPeriodEnd, 'a replay must not extend the subscription');
      const annual = await request('/api/billing/checkout', 'POST',
        { plan: 'annual', method: 'card' }, cookie);
      assert.equal(annual.status, 200);
      const annualCall = providerCalls.filter(item => item.path === '/checkout/preferences')[1];
      assert.equal(annualCall.body.items[0].unit_price, 420);
      assert.equal(annualCall.body.payment_methods.installments, 12);
      const annualPayment = makePayment(annualCall.body.external_reference, 420);
      annualPayment.status = 'approved';
      assert.equal((await webhook(annualPayment)).status, 200);
      const annualState = (await request('/api/billing/subscription', 'GET', undefined, cookie)).body;
      assert.equal(annualState.plan, 'annual');
      assert.equal(annualState.status, 'active');
    });

  it('creates one-time dynamic Pix without storing the payer document and rejects wrong amounts',
    { timeout: 20_000 }, async () => {
      const cookie = await register('lara-cilios-billing', 'lara.billing@example.test', 'OutraSenhaMuitoForte5');
      assert.equal((await request('/api/billing/checkout', 'POST',
        { plan: 'monthly', method: 'pix', cpfCnpj: '11111111111' }, cookie)).status, 400);
      const pix = await request('/api/billing/checkout', 'POST',
        { plan: 'monthly', method: 'pix', cpfCnpj: '529.982.247-25' }, cookie);
      assert.equal(pix.status, 200);
      assert.match(pix.body.pix.payload, /^000201/);
      const call = providerCalls.find(item => item.path === '/v1/payments')!;
      assert.equal(call.body.transaction_amount, 49.9);
      assert.equal(call.body.payment_method_id, 'pix');
      assert.equal(call.body.payer.identification.number, '52998224725');
      assert.equal(call.key, call.body.external_reference);
      const database = new Database(join(directory, 'nayla.sqlite'), { readonly: true });
      try {
        assert.equal(JSON.stringify(database.prepare('SELECT * FROM business_billing').all())
          .includes('52998224725'), false);
        assert.equal(JSON.stringify(database.prepare('SELECT * FROM billing_checkouts').all())
          .includes('52998224725'), false);
      } finally { database.close(); }
      const payment = [...payments.values()].find(item => item.external_reference === call.body.external_reference)!;
      payment.status = 'approved';
      payment.transaction_amount = 1;
      assert.equal((await webhook(payment)).status, 200);
      assert.equal((await request('/api/billing/subscription', 'GET', undefined, cookie)).body.status, 'pending');
      payment.transaction_amount = 49.9;
      assert.equal((await webhook(payment)).status, 200);
      assert.equal((await request('/api/billing/subscription', 'GET', undefined, cookie)).body.status, 'active');
      payment.status = 'refunded';
      assert.equal((await webhook(payment)).status, 200);
      const refunded = (await request('/api/billing/subscription', 'GET', undefined, cookie)).body;
      assert.equal(refunded.status, 'past_due');
      assert.equal(refunded.accessGranted, false);
    });

  it('reconciles a delayed payment after an ambiguous preference error', { timeout: 15_000 }, async () => {
    const cookie = await register('bia-billing', 'bia.billing@example.test', 'SenhaMuitoForte6');
    failNextPreference = true;
    const attempt = await request('/api/billing/checkout', 'POST',
      { plan: 'monthly', method: 'card' }, cookie);
    assert.equal(attempt.status, 502);
    const call = providerCalls.filter(item => item.path === '/checkout/preferences').at(-1)!;
    const database = new Database(join(directory, 'nayla.sqlite'), { readonly: true });
    try {
      const row = database.prepare('SELECT status FROM billing_checkouts WHERE id=?')
        .get(call.body.external_reference) as { status: string };
      assert.equal(row.status, 'initiating');
    } finally { database.close(); }
    const payment = makePayment(call.body.external_reference, 49.9);
    payment.status = 'approved';
    assert.equal((await webhook(payment)).status, 200);
    const state = (await request('/api/billing/subscription', 'GET', undefined, cookie)).body;
    assert.equal(state.status, 'active');
    assert.equal(state.accessGranted, true);
  });

  it('starts a 30-day trial without a card once and never extends it', { timeout: 15_000 }, async () => {
    assert.equal((await request('/api/billing/trial', 'POST', {})).status, 401);
    const cookie = await register('trial-owner-billing', 'trial.billing@example.test', 'SenhaMuitoForte7');
    const otherCookie = await register('other-trial-owner-billing', 'other.trial.billing@example.test', 'SenhaMuitoForte8');
    const initial = (await request('/api/billing/subscription', 'GET', undefined, cookie)).body;
    assert.equal(initial.trialEndsAt, null);
    assert.equal(initial.trialAvailable, true);
    const png = await sharp({ create: { width: 2, height: 2, channels: 3,
      background: '#a13d62' } }).png().toBuffer();
    const logoUpload = await fetch(`${baseUrl}/api/business/logo`, { method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'image/png' }, body: png });
    assert.equal(logoUpload.status, 200, 'a logo pode ser enviada durante o cadastro, antes do teste');
    assert.match((await logoUpload.json() as { logoUrl: string }).logoUrl,
      /\/api\/public\/trial-owner-billing\/logo\?v=/);
    assert.equal((await request('/api/billing/trial', 'POST', { extra: true }, cookie)).status, 400);
    const startedTrial = await request('/api/billing/trial', 'POST', {}, cookie);
    assert.equal(startedTrial.status, 200);
    assert.equal(startedTrial.body.accessGranted, true);
    assert.equal(startedTrial.body.trialDaysRemaining, 30);
    assert.equal(startedTrial.body.trialAvailable, false);
    assert.equal((await request('/api/dashboard', 'GET', undefined, cookie)).status, 200);
    const repeated = await request('/api/billing/trial', 'POST', {}, cookie);
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.trialEndsAt, startedTrial.body.trialEndsAt);
    const otherState = (await request('/api/billing/subscription', 'GET', undefined, otherCookie)).body;
    assert.equal(otherState.trialEndsAt, null);
    assert.equal(otherState.accessGranted, false);
    const database = new Database(join(directory, 'nayla.sqlite'));
    try {
      const business = database.prepare("SELECT business_id FROM users WHERE email='trial.billing@example.test'")
        .get() as { business_id: string };
      // Keep clear of the exact 24-hour boundary; request latency can make ceil return 2.
      const started = Date.now() - (29 * 24 + 1) * 60 * 60_000;
      database.prepare('UPDATE business_billing SET trial_started_at=? WHERE business_id=?')
        .run(started, business.business_id);
      const nearEnd = (await request('/api/billing/subscription', 'GET', undefined, cookie)).body;
      assert.equal(nearEnd.accessGranted, true);
      assert.equal(nearEnd.trialDaysRemaining, 1);
      database.prepare('UPDATE business_billing SET trial_started_at=? WHERE business_id=?')
        .run(Date.now() - 31 * 24 * 60 * 60_000, business.business_id);
      const expired = (await request('/api/billing/subscription', 'GET', undefined, cookie)).body;
      assert.equal(expired.accessGranted, false);
      assert.equal(expired.trialDaysRemaining, 0);
      assert.equal((await request('/api/dashboard', 'GET', undefined, cookie)).status, 402);
      const afterExpiry = await request('/api/billing/trial', 'POST', {}, cookie);
      assert.equal(afterExpiry.status, 200);
      assert.equal(afterExpiry.body.accessGranted, false);
      assert.equal(afterExpiry.body.trialEndsAt, expired.trialEndsAt);
    } finally { database.close(); }
  });
});
