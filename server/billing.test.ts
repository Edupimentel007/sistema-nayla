import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { catalog as serviceTemplates } from './catalog.js';

type ProviderCall = { path: string; method: string; body: any; token?: string; key?: string };
let mock: Server;
let app: ChildProcessWithoutNullStreams;
let directory: string;
let baseUrl: string;
let output = '';
const webhookSecret = 'nayla-mercado-pago-test-webhook-secret-long-enough';
const calls: ProviderCall[] = [];
const plans = new Map<string, any>();
const subscriptions = new Map<string, any>();
const invoices = new Map<string, any>();
const payments = new Map<string, any>();
let sequence = 1000000;
let planSequence = 0;
let subscriptionSequence = 0;
let failNextPlanFetch = false;
let failNextPreapprovalAfterCreate = false;
let failNextPreapprovalStatus: number | null = null;

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
async function webhook(type: 'payment' | 'subscription_preapproval' | 'subscription_authorized_payment',
  objectId: string, valid = true, requestId = randomUUID()) {
  const ts = String(Date.now());
  const manifest = `id:${objectId};request-id:${requestId};ts:${ts};`;
  const hmac = createHmac('sha256', webhookSecret).update(manifest).digest('hex');
  return request(`/api/billing/webhooks/mercado-pago?data.id=${objectId}&type=${type}`,
    'POST', { type, action: `${type}.updated`, data: { id: objectId } }, undefined,
    { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${valid ? hmac : '0'.repeat(64)}` });
}
async function register(slug: string, email: string) {
  const result = await request('/api/auth/register', 'POST', {
    ownerName: 'Maria Lima', businessName: 'Studio Maria', slug, email,
    password: 'SenhaMuitoForte4', specialties: ['unhas'],
    selectedServices: serviceTemplates.filter(item => item.category === 'unhas').map(item => item.id),
  });
  assert.equal(result.status, 201);
  return result.cookie!;
}
function expireTrial(email: string) {
  const database = new Database(join(directory, 'nayla.sqlite'));
  try {
    const owner = database.prepare('SELECT business_id FROM users WHERE email=?')
      .get(email) as { business_id: string };
    database.prepare('UPDATE business_billing SET trial_started_at=? WHERE business_id=?')
      .run(Date.now() - 31 * 24 * 60 * 60_000, owner.business_id);
  } finally { database.close(); }
}
function newInvoice(preapprovalId: string, status = 'approved', amount?: number,
  debitDate = new Date()) {
  const subscription = subscriptions.get(preapprovalId)!;
  const plan = plans.get(subscription.preapproval_plan_id)!;
  const price = amount ?? plan.auto_recurring.transaction_amount;
  const paymentId = String(++sequence);
  const invoiceId = String(++sequence);
  const payment = { id: paymentId, external_reference: subscription.external_reference,
    status, currency_id: 'BRL', transaction_amount: price,
    payment_method_id: 'visa', live_mode: false };
  const invoice = { id: invoiceId, preapproval_id: preapprovalId,
    external_reference: subscription.external_reference, currency_id: 'BRL',
    transaction_amount: price, debit_date: debitDate.toISOString(),
    payment: { id: paymentId, status } };
  payments.set(paymentId, payment);
  invoices.set(invoiceId, invoice);
  return { invoice, payment };
}

describe('cobrança recorrente Nayla via Mercado Pago', () => {
  before(async () => {
    directory = mkdtempSync(join(tmpdir(), 'nayla-billing-'));
    mock = createServer(async (req, res) => {
      let raw = '';
      for await (const part of req) raw += String(part);
      const body = raw ? JSON.parse(raw) : undefined;
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      calls.push({ path: url.pathname, method: req.method || '', body,
        token: req.headers.authorization as string, key: req.headers['x-idempotency-key'] as string });
      res.setHeader('Content-Type', 'application/json');
      const reply = (value: unknown) => res.end(JSON.stringify(value));
      if (url.pathname === '/preapproval_plan' && req.method === 'POST') {
        const id = `plan_${++planSequence}`;
        const plan = { id, status: 'active', ...body };
        plans.set(id, plan);
        reply(plan);
      } else if (/^\/preapproval_plan\/plan_\d+$/.test(url.pathname) && req.method === 'GET') {
        if (failNextPlanFetch) { failNextPlanFetch = false; res.statusCode = 503; reply({}); return; }
        const plan = plans.get(url.pathname.split('/').at(-1)!);
        if (!plan) { res.statusCode = 404; reply({}); } else reply(plan);
      } else if (url.pathname === '/preapproval' && req.method === 'POST') {
        if (failNextPreapprovalStatus) {
          res.statusCode = failNextPreapprovalStatus;
          failNextPreapprovalStatus = null;
          reply({ error: 'definitive provider rejection' }); return;
        }
        const id = `sub_${++subscriptionSequence}`;
        const plan = plans.get(body.preapproval_plan_id);
        if (!plan) { res.statusCode = 400; reply({}); return; }
        const subscription = { ...body, id, status: 'pending',
          auto_recurring: plan.auto_recurring,
          init_point: `https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=${id}` };
        subscriptions.set(id, subscription);
        if (failNextPreapprovalAfterCreate) {
          failNextPreapprovalAfterCreate = false; res.statusCode = 503; reply({}); return;
        }
        reply(subscription);
      } else if (url.pathname === '/preapproval/search' && req.method === 'GET') {
        reply({ results: [...subscriptions.values()].filter(subscription =>
          subscription.payer_email === url.searchParams.get('payer_email') &&
          subscription.preapproval_plan_id === url.searchParams.get('preapproval_plan_id')) });
      } else if (/^\/preapproval\/sub_\d+$/.test(url.pathname)) {
        const id = url.pathname.split('/').at(-1)!;
        const subscription = subscriptions.get(id);
        if (!subscription) { res.statusCode = 404; reply({}); return; }
        if (req.method === 'PUT') subscription.status = body.status;
        reply(subscription);
      } else if (url.pathname === '/authorized_payments/search' && req.method === 'GET') {
        const selected = [...invoices.values()].filter(invoice =>
          url.searchParams.has('preapproval_id') ? invoice.preapproval_id === url.searchParams.get('preapproval_id') :
            invoice.payment.id === url.searchParams.get('payment_id'));
        reply({ paging: { total: selected.length }, results: selected });
      } else if (/^\/authorized_payments\/\d+$/.test(url.pathname) && req.method === 'GET') {
        const invoice = invoices.get(url.pathname.split('/').at(-1)!);
        if (!invoice) { res.statusCode = 404; reply({}); } else reply(invoice);
      } else if (url.pathname === '/v1/payments' && req.method === 'POST') {
        const id = String(++sequence);
        const payment = { ...body, id, status: 'pending', live_mode: false, currency_id: 'BRL',
          point_of_interaction: { transaction_data: {
            qr_code: '00020126580014BR.GOV.BCB.PIX0123nayla-test-pix-payload',
            qr_code_base64: 'a'.repeat(120) } } };
        payments.set(id, payment);
        reply(payment);
      } else if (/^\/v1\/payments\/\d+$/.test(url.pathname) && req.method === 'GET') {
        const payment = payments.get(url.pathname.split('/').at(-1)!);
        if (!payment) { res.statusCode = 404; reply({}); } else reply(payment);
      } else { res.statusCode = 404; reply({}); }
    });
    await new Promise<void>(done => mock.listen(0, '127.0.0.1', done));
    const address = mock.address();
    if (!address || typeof address === 'string') throw new Error('Mock port unavailable');
    baseUrl = `http://127.0.0.1:${await freePort()}`;
    app = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: resolve('.'), env: { ...process.env, PORT: new URL(baseUrl).port, NODE_ENV: 'test',
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

  it('never charges during the free month; card authorization alone does not grant access',
    { timeout: 20_000 }, async () => {
      const email = 'monthly.billing@example.test';
      const owner = await register('studio-monthly-billing', email);
      const other = await register('studio-other-billing', 'other.billing@example.test');
      assert.equal((await request('/api/billing/subscription', 'GET', undefined, owner)).body.accessGranted, false);
      assert.equal((await request('/api/billing/checkout', 'POST',
        { plan: 'monthly', method: 'card' }, owner)).status, 409);
      assert.equal((await request('/api/billing/trial', 'POST', {}, owner)).body.accessGranted, true);
      const providerCount = calls.length;
      assert.equal((await request('/api/billing/checkout', 'POST',
        { plan: 'monthly', method: 'card' }, owner)).status, 409);
      assert.equal(calls.length, providerCount, 'trial cannot call the provider');
      expireTrial(email);
      const checkout = await request('/api/billing/checkout', 'POST',
        { plan: 'monthly', method: 'card' }, owner);
      assert.equal(checkout.status, 200);
      assert.match(checkout.body.checkoutUrl, /^https:\/\/www\.mercadopago\.com\.br\/subscriptions\/checkout\?preapproval_id=sub_/);
      const planCall = calls.find(call => call.path === '/preapproval_plan' && call.method === 'POST')!;
      assert.equal(planCall.body.auto_recurring.transaction_amount, 49.9);
      assert.equal(planCall.body.auto_recurring.frequency, 1);
      assert.equal(planCall.body.auto_recurring.frequency_type, 'months');
      assert.equal(planCall.body.auto_recurring.repetitions, undefined);
      assert.equal(planCall.body.auto_recurring.free_trial, undefined);
      assert.deepEqual(planCall.body.payment_methods_allowed.payment_types, [{ id: 'credit_card' }]);
      const create = calls.find(call => call.path === '/preapproval' && call.method === 'POST')!;
      assert.equal(create.token, 'Bearer test-token-only');
      assert.equal(create.body.status, 'pending');
      assert.equal(create.body.payer_email, email);
      assert.equal(JSON.stringify(create.body).includes('card_number'), false);
      const subscription = [...subscriptions.values()].at(-1)!;
      assert.equal((await request('/api/billing/checkout', 'POST',
        { plan: 'monthly', method: 'card' }, owner)).body.checkoutUrl, checkout.body.checkoutUrl);
      assert.equal((await fetch(`${baseUrl}/app/boas-vindas?pagamento=retorno`)).status, 200);
      subscription.status = 'authorized';
      assert.equal((await webhook('subscription_preapproval', subscription.id, false)).status, 401);
      assert.equal((await webhook('subscription_preapproval', subscription.id)).status, 200);
      assert.equal((await request('/api/billing/subscription', 'GET', undefined, owner)).body.accessGranted, false);
      const { invoice, payment } = newInvoice(subscription.id, 'pending');
      assert.equal((await webhook('subscription_authorized_payment', invoice.id)).status, 200);
      assert.equal((await request('/api/billing/subscription', 'GET', undefined, owner)).body.accessGranted, false);
      invoice.payment.status = 'approved'; payment.status = 'approved';
      invoice.transaction_amount = 1;
      assert.equal((await webhook('subscription_authorized_payment', invoice.id)).status, 200);
      assert.equal((await request('/api/billing/subscription', 'GET', undefined, owner)).body.accessGranted, false);
      invoice.transaction_amount = 49.9;
      const replayId = randomUUID();
      assert.equal((await webhook('subscription_authorized_payment', invoice.id, true, replayId)).status, 200);
      const paid = (await request('/api/billing/subscription', 'GET', undefined, owner)).body;
      assert.equal(paid.status, 'active');
      assert.equal(paid.accessGranted, true);
      assert.equal(paid.autoRenews, true);
      assert.equal(paid.plan, 'monthly');
      assert.ok(Date.parse(paid.currentPeriodEnd) - Date.now() < 33 * 24 * 60 * 60_000);
      assert.equal((await webhook('subscription_authorized_payment', invoice.id, true, replayId)).status, 200);
      assert.equal((await request('/api/billing/subscription', 'GET', undefined, owner)).body.currentPeriodEnd,
        paid.currentPeriodEnd, 'replay cannot extend the period');
      assert.equal((await request('/api/billing/subscription', 'GET', undefined, other)).body.accessGranted, false);
      assert.equal((await request('/api/billing/subscription/cancel', 'POST', {}, other)).status, 409);
      assert.equal((await request('/api/billing/subscription/cancel', 'POST', {}, owner)).status, 200);
      const canceled = (await request('/api/billing/subscription', 'GET', undefined, owner)).body;
      assert.equal(canceled.autoRenews, false);
      assert.equal(canceled.accessGranted, true, 'paid month remains accessible');
      payment.status = 'refunded';
      invoice.payment.status = 'refunded';
      assert.equal((await webhook('payment', payment.id)).status, 200);
      const refunded = (await request('/api/billing/subscription', 'GET', undefined, owner)).body;
      assert.equal(refunded.status, 'past_due');
      assert.equal(refunded.accessGranted, false, 'refunded invoice revokes the paid period');
      assert.equal((await webhook('subscription_authorized_payment', invoice.id)).status, 200);
      assert.equal((await request('/api/billing/subscription', 'GET', undefined, owner)).body.accessGranted,
        false, 'replayed invoice cannot reinstate refunded access');
    });

  it('reconciles an approved invoice through the authenticated provider API without a webhook',
    { timeout: 15_000 }, async () => {
      const email = 'reconcile.billing@example.test';
      const cookie = await register('studio-reconcile-billing', email);
      await request('/api/billing/trial', 'POST', {}, cookie);
      expireTrial(email);
      const checkout = await request('/api/billing/checkout', 'POST',
        { plan: 'monthly', method: 'card' }, cookie);
      assert.equal(checkout.status, 200);
      const subscription = [...subscriptions.values()].at(-1)!;
      subscription.status = 'authorized';
      newInvoice(subscription.id);
      const state = (await request('/api/billing/subscription', 'GET', undefined, cookie)).body;
      assert.equal(state.status, 'active');
      assert.equal(state.accessGranted, true);
    });

  it('retries checkout after plan lookup failure, recovers an ambiguous subscription, and blocks overlapping Pix',
    { timeout: 20_000 }, async () => {
      const firstEmail = 'retry.billing@example.test';
      const first = await register('studio-retry-billing', firstEmail);
      await request('/api/billing/trial', 'POST', {}, first);
      expireTrial(firstEmail);
      failNextPlanFetch = true;
      assert.equal((await request('/api/billing/checkout', 'POST',
        { plan: 'monthly', method: 'card' }, first)).status, 502);
      const database = new Database(join(directory, 'nayla.sqlite'), { readonly: true });
      try {
        const owner = database.prepare('SELECT business_id FROM users WHERE email=?')
          .get(firstEmail) as { business_id: string };
        const count = database.prepare('SELECT COUNT(*) AS count FROM billing_recurring WHERE business_id=?')
          .get(owner.business_id) as { count: number };
        assert.equal(count.count, 0, 'failure before /preapproval does not lock the owner');
      } finally { database.close(); }
      assert.equal((await request('/api/billing/checkout', 'POST',
        { plan: 'monthly', method: 'card' }, first)).status, 200);
      assert.equal((await request('/api/billing/checkout', 'POST',
        { plan: 'monthly', method: 'pix', cpfCnpj: '529.982.247-25' }, first)).status, 409);

      const secondEmail = 'ambiguous.billing@example.test';
      const second = await register('studio-ambiguous-billing', secondEmail);
      await request('/api/billing/trial', 'POST', {}, second);
      expireTrial(secondEmail);
      failNextPreapprovalAfterCreate = true;
      const before = subscriptions.size;
      assert.equal((await request('/api/billing/checkout', 'POST',
        { plan: 'monthly', method: 'card' }, second)).status, 502);
      assert.equal(subscriptions.size, before + 1);
      const recovered = await request('/api/billing/checkout', 'POST',
        { plan: 'monthly', method: 'card' }, second);
      assert.equal(recovered.status, 200);
      assert.equal(subscriptions.size, before + 1, 'recovery never creates a second remote subscription');
      assert.match(recovered.body.checkoutUrl, /preapproval_id=sub_/);
      assert.equal((await request('/api/billing/checkout', 'POST',
        { plan: 'monthly', method: 'pix', cpfCnpj: '529.982.247-25' }, second)).status, 409);

      const rejectedEmail = 'definitive.billing@example.test';
      const rejected = await register('studio-definitive-billing', rejectedEmail);
      await request('/api/billing/trial', 'POST', {}, rejected);
      expireTrial(rejectedEmail);
      for (const code of [400, 403]) {
        failNextPreapprovalStatus = code;
        const remoteCount = subscriptions.size;
        assert.equal((await request('/api/billing/checkout', 'POST',
          { plan: 'monthly', method: 'card' }, rejected)).status, 502);
        assert.equal(subscriptions.size, remoteCount, 'a definitive error created no subscription');
        const check = new Database(join(directory, 'nayla.sqlite'), { readonly: true });
        try {
          const owner = check.prepare('SELECT business_id FROM users WHERE email=?')
            .get(rejectedEmail) as { business_id: string };
          const count = check.prepare(`SELECT COUNT(*) AS count FROM billing_recurring
            WHERE business_id=?`).get(owner.business_id) as { count: number };
          assert.equal(count.count, 0, `HTTP ${code} must not leave an initiating lock`);
        } finally { check.close(); }
      }
      assert.equal((await request('/api/billing/checkout', 'POST',
        { plan: 'monthly', method: 'card' }, rejected)).status, 200);
    });

  it('uses invoice billing cycles, keeps current access after an old refund, and expires refunded current access',
    { timeout: 20_000 }, async () => {
      const email = 'invoice-cycles.billing@example.test';
      const cookie = await register('studio-invoice-cycles', email);
      await request('/api/billing/trial', 'POST', {}, cookie);
      expireTrial(email);
      assert.equal((await request('/api/billing/checkout', 'POST',
        { plan: 'monthly', method: 'card' }, cookie)).status, 200);
      const subscription = [...subscriptions.values()].at(-1)!;
      subscription.status = 'authorized';
      const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60_000);
      const first = newInvoice(subscription.id, 'approved', undefined, daysAgo(90));
      const second = newInvoice(subscription.id, 'approved', undefined, daysAgo(60));
      assert.equal((await webhook('subscription_authorized_payment', first.invoice.id)).status, 200);
      assert.equal((await webhook('subscription_authorized_payment', second.invoice.id)).status, 200);
      const stale = (await request('/api/billing/subscription', 'GET', undefined, cookie)).body;
      assert.equal(stale.accessGranted, false, 'old invoices cannot add months from reconciliation time');
      assert.ok(Date.parse(stale.currentPeriodEnd) < Date.now());
      const current = newInvoice(subscription.id, 'approved', undefined, daysAgo(10));
      assert.equal((await webhook('subscription_authorized_payment', current.invoice.id)).status, 200);
      assert.equal((await request('/api/billing/subscription', 'GET', undefined, cookie)).body.accessGranted, true);
      first.payment.status = 'refunded';
      first.invoice.payment.status = 'refunded';
      assert.equal((await webhook('subscription_authorized_payment', first.invoice.id)).status, 200);
      assert.equal((await request('/api/billing/subscription', 'GET', undefined, cookie)).body.accessGranted,
        true, 'refunding an old invoice does not revoke a newer paid cycle');
      current.payment.status = 'charged_back';
      current.invoice.payment.status = 'charged_back';
      assert.equal((await webhook('subscription_authorized_payment', current.invoice.id)).status, 200);
      assert.equal((await request('/api/billing/subscription', 'GET', undefined, cookie)).body.accessGranted,
        false, 'chargeback of current paid cycle revokes access');
    });

  it('activates a new subscription when the old paid period has expired',
    { timeout: 20_000 }, async () => {
      const email = 'renew.billing@example.test';
      const cookie = await register('studio-renew-billing', email);
      await request('/api/billing/trial', 'POST', {}, cookie);
      expireTrial(email);
      assert.equal((await request('/api/billing/checkout', 'POST',
        { plan: 'monthly', method: 'card' }, cookie)).status, 200);
      const oldSubscription = [...subscriptions.values()].at(-1)!;
      oldSubscription.status = 'authorized';
      const old = newInvoice(oldSubscription.id);
      assert.equal((await webhook('subscription_authorized_payment', old.invoice.id)).status, 200);
      assert.equal((await request('/api/billing/subscription/cancel', 'POST', {}, cookie)).status, 200);
      const database = new Database(join(directory, 'nayla.sqlite'));
      try {
        const owner = database.prepare('SELECT business_id FROM users WHERE email=?')
          .get(email) as { business_id: string };
        database.prepare(`UPDATE business_billing SET status='past_due',current_period_end=?
          WHERE business_id=?`).run(new Date(Date.now() - 24 * 60 * 60_000).toISOString(), owner.business_id);
      } finally { database.close(); }
      assert.equal((await request('/api/billing/checkout', 'POST',
        { plan: 'monthly', method: 'card' }, cookie)).status, 200);
      const replacement = [...subscriptions.values()].at(-1)!;
      replacement.status = 'authorized';
      const invoice = newInvoice(replacement.id);
      const overlap = new Database(join(directory, 'nayla.sqlite'));
      try {
        const owner = overlap.prepare('SELECT business_id FROM users WHERE email=?')
          .get(email) as { business_id: string };
        overlap.prepare(`UPDATE business_billing SET status='active',current_period_end=?
          WHERE business_id=?`).run(new Date(Date.now() + 24 * 60 * 60_000).toISOString(), owner.business_id);
      } finally { overlap.close(); }
      assert.equal((await webhook('subscription_authorized_payment', invoice.invoice.id)).status, 200);
      const beforeTransition = new Database(join(directory, 'nayla.sqlite'), { readonly: true });
      try {
        const found = beforeTransition.prepare('SELECT 1 FROM billing_recurring_invoices WHERE invoice_id=?')
          .get(invoice.invoice.id);
        assert.equal(found, undefined, 'an overlapping invoice is not consumed before transition');
      } finally { beforeTransition.close(); }
      const expire = new Database(join(directory, 'nayla.sqlite'));
      try {
        const owner = expire.prepare('SELECT business_id FROM users WHERE email=?')
          .get(email) as { business_id: string };
        expire.prepare(`UPDATE business_billing SET status='past_due',current_period_end=?
          WHERE business_id=?`).run(new Date(Date.now() - 24 * 60 * 60_000).toISOString(), owner.business_id);
      } finally { expire.close(); }
      assert.equal((await webhook('subscription_authorized_payment', invoice.invoice.id)).status, 200);
      const paid = (await request('/api/billing/subscription', 'GET', undefined, cookie)).body;
      assert.equal(paid.accessGranted, true);
      assert.equal(paid.billingMethod, 'card');
      const verify = new Database(join(directory, 'nayla.sqlite'), { readonly: true });
      try {
        const row = verify.prepare(`SELECT b.active_recurring_id,r.id AS replacement_id,i.invoice_id
          FROM billing_recurring r JOIN business_billing b ON b.business_id=r.business_id
          JOIN billing_recurring_invoices i ON i.recurring_id=r.id
          WHERE r.provider_preapproval_id=?`).get(replacement.id) as
          { active_recurring_id: string; replacement_id: string; invoice_id: string };
        assert.equal(row.active_recurring_id, row.replacement_id);
        assert.equal(row.invoice_id, invoice.invoice.id);
      } finally { verify.close(); }
    });

  it('annual card plan charges 12 monthly amounts of R$ 35 and each paid invoice grants one month',
    { timeout: 25_000 }, async () => {
      const email = 'annual.billing@example.test';
      const cookie = await register('studio-annual-billing', email);
      await request('/api/billing/trial', 'POST', {}, cookie);
      expireTrial(email);
      const checkout = await request('/api/billing/checkout', 'POST',
        { plan: 'annual', method: 'card' }, cookie);
      assert.equal(checkout.status, 200);
      const planCall = calls.filter(call => call.path === '/preapproval_plan' && call.method === 'POST').at(-1)!;
      assert.equal(planCall.body.auto_recurring.transaction_amount, 35);
      assert.equal(planCall.body.auto_recurring.repetitions, 12);
      assert.equal(planCall.body.auto_recurring.free_trial, undefined);
      const subscription = [...subscriptions.values()].at(-1)!;
      subscription.status = 'authorized';
      let lastEnd = Date.now();
      for (let cycle = 1; cycle <= 12; cycle++) {
        if (cycle === 12) subscription.status = 'finished';
        const debitDate = new Date();
        debitDate.setUTCDate(1);
        debitDate.setUTCMonth(debitDate.getUTCMonth() + cycle - 1);
        const { invoice } = newInvoice(subscription.id, 'approved', undefined, debitDate);
        assert.equal((await webhook('subscription_authorized_payment', invoice.id)).status, 200);
        const database = new Database(join(directory, 'nayla.sqlite'), { readonly: true });
        try {
          const row = database.prepare(`SELECT b.current_period_end,r.paid_cycles
            FROM billing_recurring r JOIN business_billing b ON b.active_recurring_id=r.id
            WHERE r.provider_preapproval_id=?`).get(subscription.id) as
            { current_period_end: string; paid_cycles: number };
          assert.equal(row.paid_cycles, cycle);
          const nextEnd = Date.parse(row.current_period_end);
          assert.ok(nextEnd > lastEnd);
          assert.ok(nextEnd - lastEnd < 35 * 24 * 60 * 60_000);
          lastEnd = nextEnd;
        } finally { database.close(); }
      }
      const extra = newInvoice(subscription.id);
      assert.equal((await webhook('subscription_authorized_payment', extra.invoice.id)).status, 200);
      const final = (await request('/api/billing/subscription', 'GET', undefined, cookie)).body;
      assert.equal(final.annualInstallmentsPaid, 12);
      assert.equal(final.currentPeriodEnd, new Date(lastEnd).toISOString());
      assert.equal(final.autoRenews, false);
    });

  it('Pix stays one-time, validates payer identity and requires an approved provider payment',
    { timeout: 15_000 }, async () => {
      const email = 'pix.billing@example.test';
      const cookie = await register('studio-pix-billing', email);
      await request('/api/billing/trial', 'POST', {}, cookie);
      expireTrial(email);
      assert.equal((await request('/api/billing/checkout', 'POST',
        { plan: 'annual', method: 'pix', cpfCnpj: '11111111111' }, cookie)).status, 400);
      const checkout = await request('/api/billing/checkout', 'POST',
        { plan: 'annual', method: 'pix', cpfCnpj: '529.982.247-25' }, cookie);
      assert.equal(checkout.status, 200);
      assert.match(checkout.body.pix.payload, /^000201/);
      assert.equal((await request('/api/billing/checkout', 'POST',
        { plan: 'annual', method: 'card' }, cookie)).status, 409,
      'a pending Pix also blocks starting an overlapping card subscription');
      const create = calls.filter(call => call.path === '/v1/payments' && call.method === 'POST').at(-1)!;
      assert.equal(create.body.transaction_amount, 420);
      assert.equal(create.body.payer.identification.number, '52998224725');
      assert.equal(create.key, create.body.external_reference);
      const payment = [...payments.values()].at(-1)!;
      assert.equal((await webhook('payment', payment.id)).status, 200);
      assert.equal((await request('/api/billing/subscription', 'GET', undefined, cookie)).body.accessGranted, false);
      payment.status = 'approved';
      assert.equal((await webhook('payment', payment.id)).status, 200);
      const state = (await request('/api/billing/subscription', 'GET', undefined, cookie)).body;
      assert.equal(state.status, 'active');
      assert.equal(state.billingMethod, 'pix');
      assert.equal(state.autoRenews, false);
      assert.ok(Date.parse(state.currentPeriodEnd) - Date.now() > 360 * 24 * 60 * 60_000);
      const database = new Database(join(directory, 'nayla.sqlite'), { readonly: true });
      try {
        assert.equal(JSON.stringify(database.prepare('SELECT * FROM billing_checkouts').all())
          .includes('52998224725'), false);
      } finally { database.close(); }
      payment.status = 'refunded';
      assert.equal((await webhook('payment', payment.id)).status, 200);
      assert.equal((await request('/api/billing/subscription', 'GET', undefined, cookie)).body.accessGranted, false);
    });
});
