import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from './db.js';

type Plan = 'monthly' | 'annual';
type Method = 'card' | 'pix';
type BillingStatus = 'none' | 'pending' | 'active' | 'past_due' | 'canceled';
type CheckoutStatus = 'initiating' | 'pending' | 'paid' | 'failed' | 'canceled' | 'expired';
type BillingRow = { business_id: string; onboarding_completed: number; plan: Plan | null;
  status: BillingStatus; current_period_end: string | null; trial_started_at: number | null;
  trial_card_verified_at: number | null; last_paid_checkout_id: string | null;
  active_recurring_id: string | null };
type CheckoutRow = { id: string; business_id: string; plan: Plan; method: Method;
  amount_cents: number; status: CheckoutStatus; provider_checkout_id: string | null;
  provider_checkout_url: string | null; provider_payment_id: string | null; created_at_ms: number };
type RecurringRow = { id: string; business_id: string; plan: Plan; amount_cents: number;
  provider_plan_id: string | null; provider_preapproval_id: string | null;
  checkout_url: string | null; status: 'initiating' | 'pending' | 'authorized' | 'paused' | 'canceled' | 'completed';
  paid_cycles: number; created_at_ms: number; preapproval_attempted_at: number | null };

export const planPrices = { monthly: 4990, annual: 42000 } as const;
const recurringPrices = { monthly: 4990, annual: 3500 } as const;
const trialMs = 30 * 24 * 60 * 60_000;
const lastReconciliation = new Map<string, number>();
const paymentId = z.union([z.number().int().nonnegative(), z.string().regex(/^\d{1,30}$/)]).transform(String);
const checkoutInput = z.object({ plan: z.enum(['monthly', 'annual']),
  method: z.enum(['card', 'pix']), cpfCnpj: z.string().optional() }).strict();
const paymentSchema = z.object({
  id: paymentId, external_reference: z.string().nullish(), status: z.string().min(1),
  currency_id: z.string(), transaction_amount: z.union([z.number(), z.string()]).transform(Number),
  payment_method_id: z.string().optional(), live_mode: z.boolean().optional(),
  point_of_interaction: z.object({ transaction_data: z.object({
    qr_code: z.string().optional(), qr_code_base64: z.string().optional(),
  }).optional() }).optional(),
  date_of_expiration: z.string().optional(),
}).passthrough();
const providerId = z.string().regex(/^[a-zA-Z0-9_-]{3,150}$/);
const planSchema = z.object({ id: providerId, status: z.string().optional(), back_url: z.string().url(),
  auto_recurring: z.object({ frequency: z.number(), frequency_type: z.string(),
    repetitions: z.number().nullish(), currency_id: z.string(),
    transaction_amount: z.union([z.string(), z.number()]).transform(Number),
    free_trial: z.unknown().optional() }) }).passthrough();
const preapprovalSchema = z.object({ id: providerId, external_reference: z.string().nullish(),
  preapproval_plan_id: providerId.nullish(), status: z.string(), init_point: z.string().url().optional(),
  auto_recurring: z.object({ frequency: z.number(), frequency_type: z.string(),
    transaction_amount: z.union([z.string(), z.number()]).transform(Number),
    currency_id: z.string() }).optional(), live_mode: z.boolean().optional() }).passthrough();
const invoiceSchema = z.object({ id: paymentId, preapproval_id: providerId,
  external_reference: z.string().nullish(), currency_id: z.string(),
  transaction_amount: z.union([z.string(), z.number()]).transform(Number),
  debit_date: z.string().datetime({ offset: true }),
  payment: z.object({ id: paymentId, status: z.string() }).nullish() }).passthrough();

db.exec(`CREATE TABLE IF NOT EXISTS business_billing (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  onboarding_completed INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_completed IN (0,1)),
  plan TEXT CHECK (plan IN ('monthly','annual')),
  status TEXT NOT NULL DEFAULT 'none' CHECK (status IN ('none','pending','active','past_due','canceled')),
  current_period_end TEXT,
  trial_started_at INTEGER,
  trial_card_verified_at INTEGER,
  last_paid_checkout_id TEXT,
  active_recurring_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS billing_checkouts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('monthly','annual')),
  method TEXT NOT NULL CHECK (method IN ('card','pix')),
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('initiating','pending','paid','failed','canceled','expired')),
  provider_checkout_id TEXT UNIQUE,
  provider_checkout_url TEXT,
  provider_payment_id TEXT UNIQUE,
  created_at_ms INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS billing_checkouts_business_recent ON billing_checkouts(business_id,created_at_ms DESC);
CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id TEXT PRIMARY KEY, event_type TEXT NOT NULL, object_id TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS billing_provider_plans (
  environment TEXT NOT NULL CHECK (environment IN ('test','production')),
  plan TEXT NOT NULL CHECK (plan IN ('monthly','annual')),
  origin TEXT NOT NULL,
  provider_plan_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY(environment,plan)
);
CREATE TABLE IF NOT EXISTS billing_recurring (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('monthly','annual')),
  amount_cents INTEGER NOT NULL,
  provider_plan_id TEXT,
  provider_preapproval_id TEXT UNIQUE,
  checkout_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('initiating','pending','authorized','paused','canceled','completed')),
  paid_cycles INTEGER NOT NULL DEFAULT 0,
  preapproval_attempted_at INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS billing_recurring_business_recent ON billing_recurring(business_id,created_at_ms DESC);
CREATE TABLE IF NOT EXISTS billing_recurring_invoices (
  invoice_id TEXT PRIMARY KEY,
  recurring_id TEXT NOT NULL REFERENCES billing_recurring(id) ON DELETE CASCADE,
  payment_id TEXT NOT NULL UNIQUE,
  cycle_start TEXT,
  cycle_end TEXT,
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','refunded')),
  paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);
for (const [table, column, definition] of [
  ['business_billing', 'trial_started_at', 'INTEGER'],
  ['business_billing', 'trial_card_verified_at', 'INTEGER'],
  ['business_billing', 'last_paid_checkout_id', 'TEXT'],
  ['business_billing', 'active_recurring_id', 'TEXT'],
  ['billing_checkouts', 'provider_checkout_url', 'TEXT'],
  ['billing_recurring', 'preapproval_attempted_at', 'INTEGER'],
  ['billing_recurring_invoices', 'cycle_start', 'TEXT'],
  ['billing_recurring_invoices', 'cycle_end', 'TEXT'],
  ['billing_recurring_invoices', 'status', "TEXT NOT NULL DEFAULT 'paid'"],
] as const) {
  const columns = db.pragma(`table_info(${table})`) as { name: string }[];
  if (!columns.some(item => item.name === column))
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function businessId(res: Response) { return (res.locals.user as { business_id: string }).business_id; }
function ensureBillingRow(id: string) {
  db.prepare('INSERT OR IGNORE INTO business_billing(business_id) VALUES(?)').run(id);
  return db.prepare('SELECT * FROM business_billing WHERE business_id=?').get(id) as BillingRow;
}
function origin() {
  const configured = process.env.APP_ORIGIN?.replace(/\/$/, '');
  if (!configured) throw new Error('Configure APP_ORIGIN para ativar pagamentos.');
  let url: URL;
  try { url = new URL(configured); } catch { throw new Error('APP_ORIGIN inválida.'); }
  const localTest = process.env.NODE_ENV === 'test' && url.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (!localTest && (url.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname))))
    throw new Error('APP_ORIGIN deve ser uma origem HTTPS pública para pagamentos.');
  return configured;
}
export function billingWebhookReady() {
  return Boolean(process.env.MERCADO_PAGO_WEBHOOK_SECRET &&
    process.env.MERCADO_PAGO_WEBHOOK_SECRET.length >= 32);
}
function providerConfigured() {
  if (!process.env.MERCADO_PAGO_ACCESS_TOKEN || !billingWebhookReady()) return false;
  try { origin(); return true; } catch { return false; }
}
function currentRecurring(id: string) {
  return db.prepare(`SELECT * FROM billing_recurring WHERE business_id=?
    ORDER BY created_at_ms DESC,rowid DESC LIMIT 1`).get(id) as RecurringRow | undefined;
}
function billingState(id: string) {
  const state = ensureBillingRow(id);
  const now = Date.now();
  if (state.status === 'active' && state.current_period_end &&
      Date.parse(state.current_period_end) <= now) {
    db.prepare("UPDATE business_billing SET status='past_due',updated_at=CURRENT_TIMESTAMP WHERE business_id=?")
      .run(id);
    state.status = 'past_due';
  }
  const latest = db.prepare(`SELECT * FROM billing_checkouts
    WHERE business_id=? AND status IN ('initiating','pending') AND created_at_ms>?
    ORDER BY created_at_ms DESC LIMIT 1`).get(id, now - 60 * 60_000) as CheckoutRow | undefined;
  // The trial begins only when its owner explicitly starts it. The stored timestamp is
  // immutable so neither a repeated request nor a new session can extend the offer.
  const trialEndsAt = state.trial_started_at ?
    new Date(state.trial_started_at + trialMs).toISOString() : null;
  const trialActive = Boolean(trialEndsAt && Date.parse(trialEndsAt) > now);
  const paidActive = state.status === 'active' && Boolean(state.current_period_end &&
    Date.parse(state.current_period_end) > now);
  const configured = providerConfigured();
  const recurring = currentRecurring(id);
  return { plan: state.plan, status: state.status,
    onboardingCompleted: Boolean(state.onboarding_completed),
    currentPeriodEnd: state.current_period_end, trialEndsAt,
    trialDaysRemaining: trialEndsAt ? Math.max(0, Math.ceil((Date.parse(trialEndsAt) - now) / (24 * 60 * 60_000))) : 0,
    trialRequiresCard: false,
    trialAvailable: !state.trial_started_at && !state.last_paid_checkout_id &&
      ['none', 'pending'].includes(state.status),
    accessGranted: (process.env.NODE_ENV !== 'production' && !configured) ||
      trialActive || paidActive, providerConfigured: configured,
    checkoutUrl: recurring?.status === 'pending' ? recurring.checkout_url || undefined :
      latest?.provider_checkout_url || undefined,
    billingMethod: recurring?.paid_cycles && recurring.id === state.active_recurring_id ? 'card' :
      state.last_paid_checkout_id ? 'pix' : null,
    recurringStatus: recurring?.status || null,
    canCancelRecurring: Boolean(recurring?.provider_preapproval_id &&
      ['pending', 'authorized', 'paused'].includes(recurring.status)),
    autoRenews: recurring?.id === state.active_recurring_id &&
      recurring.status === 'authorized' && recurring.plan === 'monthly',
    annualInstallmentsPaid: recurring?.id === state.active_recurring_id &&
      recurring.plan === 'annual' ? recurring.paid_cycles : null };
}
export function billingAccessForBusiness(id: string) { return billingState(id).accessGranted; }
export function requireBillingAccess(_req: Request, res: Response, next: NextFunction) {
  const state = billingState(businessId(res));
  if (state.accessGranted) return next();
  return res.status(402).json({ error: state.trialAvailable
    ? 'Comece seus 30 dias grátis para usar o painel.'
    : 'Seu teste gratuito terminou. Escolha um plano para continuar.' });
}

function validDocument(input: string | undefined) {
  const value = (input || '').replace(/\D/g, '');
  if (![11, 14].includes(value.length) || /^(\d)\1+$/.test(value)) return false;
  if (value.length === 11) {
    for (let digit = 9; digit < 11; digit++) {
      const sum = [...value.slice(0, digit)].reduce((acc, char, index) =>
        acc + Number(char) * (digit + 1 - index), 0);
      if (Number(value[digit]) !== ((sum * 10) % 11) % 10) return false;
    }
    return true;
  }
  for (let digit = 12; digit < 14; digit++) {
    let weight = digit === 12 ? 5 : 6;
    let sum = 0;
    for (const char of value.slice(0, digit)) {
      sum += Number(char) * weight;
      weight = weight === 2 ? 9 : weight - 1;
    }
    if (Number(value[digit]) !== (sum % 11 < 2 ? 0 : 11 - sum % 11)) return false;
  }
  return true;
}
function providerBase() {
  if (process.env.NODE_ENV === 'test' && process.env.MERCADO_PAGO_TEST_API_BASE_URL &&
      /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.MERCADO_PAGO_TEST_API_BASE_URL))
    return process.env.MERCADO_PAGO_TEST_API_BASE_URL;
  return 'https://api.mercadopago.com';
}
class ProviderHttpError extends Error {
  constructor(readonly status: number) { super(`Mercado Pago HTTP ${status}`); }
}
async function providerRequest(path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown, key?: string) {
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!token) throw new Error('Mercado Pago indisponível.');
  const response = await fetch(`${providerBase()}${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'X-Idempotency-Key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new ProviderHttpError(response.status);
  return await response.json() as unknown;
}
function validateProviderPlan(raw: unknown, plan: Plan, appOrigin: string) {
  const parsed = planSchema.parse(raw);
  const terms = parsed.auto_recurring;
  if ((parsed.status && parsed.status !== 'active') ||
      parsed.back_url !== `${appOrigin}/app/boas-vindas?pagamento=retorno`)
    throw new Error('Plano Mercado Pago inativo ou com retorno incorreto.');
  if (terms.frequency !== 1 || terms.frequency_type !== 'months' ||
      terms.currency_id !== 'BRL' ||
      Math.round(terms.transaction_amount * 100) !== recurringPrices[plan] ||
      (plan === 'annual' ? terms.repetitions !== 12 : Boolean(terms.repetitions)) ||
      terms.free_trial) throw new Error('Plano Mercado Pago diverge dos valores da Nayla.');
  return parsed.id;
}
async function recurringPlanId(plan: Plan, appOrigin: string) {
  const environment = process.env.NODE_ENV === 'production' ? 'production' : 'test';
  const saved = db.prepare(`SELECT provider_plan_id,origin FROM billing_provider_plans
    WHERE environment=? AND plan=?`).get(environment, plan) as { provider_plan_id: string; origin: string } | undefined;
  if (saved && saved.origin === appOrigin) {
    const remote = await providerRequest(`/preapproval_plan/${saved.provider_plan_id}`, 'GET');
    if (validateProviderPlan(remote, plan, appOrigin) !== saved.provider_plan_id)
      throw new Error('Plano Mercado Pago inconsistente.');
    return saved.provider_plan_id;
  }
  const created = await providerRequest('/preapproval_plan', 'POST', {
    reason: plan === 'annual' ? 'Nayla anual: 12 cobranças mensais de R$ 35' :
      'Nayla mensal: R$ 49,90 por mês',
    auto_recurring: { frequency: 1, frequency_type: 'months',
      ...(plan === 'annual' ? { repetitions: 12 } : {}),
      transaction_amount: recurringPrices[plan] / 100, currency_id: 'BRL' },
    payment_methods_allowed: { payment_types: [{ id: 'credit_card' }] },
    back_url: `${appOrigin}/app/boas-vindas?pagamento=retorno`,
  });
  const id = validateProviderPlan(created, plan, appOrigin);
  db.prepare(`INSERT INTO billing_provider_plans(environment,plan,origin,provider_plan_id)
    VALUES(?,?,?,?) ON CONFLICT(environment,plan) DO UPDATE SET
    origin=excluded.origin,provider_plan_id=excluded.provider_plan_id`)
    .run(environment, plan, appOrigin, id);
  return (db.prepare(`SELECT provider_plan_id FROM billing_provider_plans WHERE environment=? AND plan=?`)
    .get(environment, plan) as { provider_plan_id: string }).provider_plan_id;
}
async function recoverInitiatingRecurring(row: RecurringRow, payerEmail: string) {
  if (!row.preapproval_attempted_at || !row.provider_plan_id) return null;
  const query = new URLSearchParams({ payer_email: payerEmail,
    preapproval_plan_id: row.provider_plan_id });
  const result = z.object({ results: z.array(z.object({ id: providerId,
    external_reference: z.string().nullish(), preapproval_plan_id: providerId.nullish() })) })
    .parse(await providerRequest(`/preapproval/search?${query}`, 'GET'));
  const match = result.results.find(item => item.external_reference === row.id &&
    item.preapproval_plan_id === row.provider_plan_id);
  if (!match) return null;
  const remote = preapprovalSchema.parse(await providerRequest(`/preapproval/${match.id}`, 'GET'));
  if (remote.id !== match.id || remote.external_reference !== row.id ||
      remote.preapproval_plan_id !== row.provider_plan_id) return null;
  const checkoutUrl = remote.init_point ? trustedSubscriptionUrl(remote.init_point, remote.id) : null;
  const status = ['authorized', 'paused', 'canceled'].includes(remote.status) ? remote.status : 'pending';
  db.prepare(`UPDATE billing_recurring SET provider_preapproval_id=?,checkout_url=?,status=?,
    updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='initiating'`)
    .run(remote.id, checkoutUrl, status, row.id);
  return status === 'pending' ? checkoutUrl : null;
}
function trustedSubscriptionUrl(value: string, id: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Link de assinatura inválido.'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
      !['www.mercadopago.com.br', 'mercadopago.com.br', 'sandbox.mercadopago.com.br',
        'www.mercadopago.com', 'mercadopago.com', 'sandbox.mercadopago.com']
        .includes(url.hostname) || url.pathname !== '/subscriptions/checkout' ||
      url.searchParams.get('preapproval_id') !== id)
    throw new Error('Link de assinatura inválido.');
  return url.href;
}
function pixDetails(raw: unknown) {
  const payment = paymentSchema.parse(raw);
  const data = payment.point_of_interaction?.transaction_data;
  if (!data?.qr_code || !data.qr_code_base64 || data.qr_code.length > 4096 ||
      data.qr_code_base64.length > 1_500_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data.qr_code_base64)) throw new Error('Pix indisponível.');
  return { payload: data.qr_code, encodedImage: data.qr_code_base64,
    expiresAt: payment.date_of_expiration };
}
function periodEnd(plan: Plan, from = new Date()) {
  const target = new Date(from);
  const day = target.getUTCDate();
  target.setUTCDate(1);
  if (plan === 'monthly') target.setUTCMonth(target.getUTCMonth() + 1);
  else target.setUTCFullYear(target.getUTCFullYear() + 1);
  const monthEnd = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, monthEnd));
  return target.toISOString();
}
function recurringPaidEnd(recurringId: string) {
  return (db.prepare(`SELECT MAX(cycle_end) AS value FROM billing_recurring_invoices
    WHERE recurring_id=? AND status='paid'`).get(recurringId) as { value: string | null }).value;
}
function markPaid(row: CheckoutRow, verifiedPaymentId: string) {
  db.transaction(() => {
    const updated = db.prepare(`UPDATE billing_checkouts SET status='paid',provider_payment_id=?,
      updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'paid'
      AND (provider_payment_id IS NULL OR provider_payment_id=?)`)
      .run(verifiedPaymentId, row.id, verifiedPaymentId);
    if (!updated.changes) return;
    const current = ensureBillingRow(row.business_id);
    const now = new Date();
    const currentEnd = current.current_period_end ? new Date(current.current_period_end) : now;
    const base = current.status === 'active' && currentEnd > now ? currentEnd : now;
    const nextPlan = current.status === 'active' && current.plan === 'annual' ? 'annual' : row.plan;
    db.prepare(`UPDATE business_billing SET plan=?,status='active',current_period_end=?,
      last_paid_checkout_id=?,active_recurring_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE business_id=?`)
      .run(nextPlan, periodEnd(row.plan, base), row.id, row.business_id);
  })();
}
async function applyRecurringInvoice(invoiceId: string) {
  const invoice = invoiceSchema.parse(await providerRequest(`/authorized_payments/${invoiceId}`, 'GET'));
  if (invoice.id !== invoiceId || !invoice.payment) return;
  const cycleStart = new Date(invoice.debit_date);
  if (Number.isNaN(cycleStart.getTime())) return;
  const cycleEnd = periodEnd('monthly', cycleStart);
  const row = db.prepare('SELECT * FROM billing_recurring WHERE provider_preapproval_id=?')
    .get(invoice.preapproval_id) as RecurringRow | undefined;
  if (!row || !row.provider_plan_id ||
      (invoice.external_reference && invoice.external_reference !== row.id) ||
      invoice.currency_id !== 'BRL' ||
      Math.round(invoice.transaction_amount * 100) !== row.amount_cents) return;
  const [preapprovalRaw, paymentRaw] = await Promise.all([
    providerRequest(`/preapproval/${row.provider_preapproval_id}`, 'GET'),
    providerRequest(`/v1/payments/${invoice.payment.id}`, 'GET'),
  ]);
  const preapproval = preapprovalSchema.parse(preapprovalRaw);
  const payment = paymentSchema.parse(paymentRaw);
  if (preapproval.id !== row.provider_preapproval_id ||
      preapproval.external_reference !== row.id ||
      preapproval.preapproval_plan_id !== row.provider_plan_id ||
      // A paid invoice is the proof of access. A finite plan may already have a
      // terminal preapproval status when its last invoice arrives.
      preapproval.auto_recurring?.frequency !== 1 ||
      preapproval.auto_recurring.frequency_type !== 'months' ||
      preapproval.auto_recurring.currency_id !== 'BRL' ||
      Math.round(preapproval.auto_recurring.transaction_amount * 100) !== row.amount_cents ||
      payment.id !== invoice.payment.id ||
      payment.currency_id !== 'BRL' ||
      Math.round(payment.transaction_amount * 100) !== row.amount_cents ||
      (process.env.NODE_ENV === 'production' && payment.live_mode !== true)) return;
  if (['refunded', 'charged_back'].includes(payment.status)) {
    db.transaction(() => {
      const updated = db.prepare(`UPDATE billing_recurring_invoices
        SET status='refunded',cycle_start=COALESCE(cycle_start,?),cycle_end=COALESCE(cycle_end,?)
        WHERE invoice_id=? AND recurring_id=? AND payment_id=?`)
        .run(cycleStart.toISOString(), cycleEnd, invoice.id, row.id, payment.id);
      if (!updated.changes) return;
      const end = recurringPaidEnd(row.id);
      db.prepare(`UPDATE business_billing SET status=?,current_period_end=?,
        updated_at=CURRENT_TIMESTAMP WHERE business_id=? AND active_recurring_id=?`)
        .run(end && Date.parse(end) > Date.now() ? 'active' : 'past_due', end,
          row.business_id, row.id);
    })();
    return;
  }
  if (invoice.payment.status !== 'approved' || payment.status !== 'approved') return;
  db.transaction(() => {
    const current = ensureBillingRow(row.business_id);
    if (current.active_recurring_id && current.active_recurring_id !== row.id) {
      const activeRow = db.prepare('SELECT created_at_ms FROM billing_recurring WHERE id=?')
        .get(current.active_recurring_id) as { created_at_ms: number } | undefined;
      if ((activeRow && activeRow.created_at_ms >= row.created_at_ms) ||
          (current.status === 'active' && current.current_period_end &&
            Date.parse(current.current_period_end) > Date.now())) return;
    }
    const recorded = db.prepare(`SELECT status,recurring_id,payment_id FROM billing_recurring_invoices
      WHERE invoice_id=?`).get(invoice.id) as
      { status: string; recurring_id: string; payment_id: string } | undefined;
    if (recorded && (recorded.recurring_id !== row.id || recorded.payment_id !== payment.id)) return;
    if (recorded?.status === 'refunded') return;
    const latest = db.prepare('SELECT paid_cycles FROM billing_recurring WHERE id=?')
      .get(row.id) as { paid_cycles: number };
    if (!recorded && row.plan === 'annual' && latest.paid_cycles >= 12) return;
    const inserted = db.prepare(`INSERT OR IGNORE INTO billing_recurring_invoices
      (invoice_id,recurring_id,payment_id,cycle_start,cycle_end) VALUES(?,?,?,?,?)`)
      .run(invoice.id, row.id, payment.id, cycleStart.toISOString(), cycleEnd);
    if (inserted.changes) {
      const nextStatus = row.plan === 'annual' && latest.paid_cycles + 1 >= 12 ? 'completed' :
        ['canceled', 'paused'].includes(preapproval.status) ? preapproval.status : 'authorized';
      db.prepare(`UPDATE billing_recurring SET paid_cycles=paid_cycles+1,
        status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(nextStatus, row.id);
    } else if (recorded) {
      // Backfill cycle dates for invoices recorded before this migration.
      db.prepare(`UPDATE billing_recurring_invoices SET cycle_start=?,cycle_end=?
        WHERE invoice_id=? AND recurring_id=? AND payment_id=? AND cycle_end IS NULL`)
        .run(cycleStart.toISOString(), cycleEnd, invoice.id, row.id, payment.id);
    } else return;
    const end = recurringPaidEnd(row.id);
    if (!end) return;
    db.prepare(`UPDATE business_billing SET plan=?,status=?,current_period_end=?,
      active_recurring_id=?,updated_at=CURRENT_TIMESTAMP WHERE business_id=?`)
      .run(row.plan, Date.parse(end) > Date.now() ? 'active' : 'past_due', end,
        row.id, row.business_id);
  })();
}
async function applyRecurringStatus(preapprovalId: string) {
  const row = db.prepare('SELECT * FROM billing_recurring WHERE provider_preapproval_id=?')
    .get(preapprovalId) as RecurringRow | undefined;
  if (!row) return;
  const remote = preapprovalSchema.parse(await providerRequest(`/preapproval/${preapprovalId}`, 'GET'));
  if (remote.id !== row.provider_preapproval_id || remote.external_reference !== row.id ||
      remote.preapproval_plan_id !== row.provider_plan_id) return;
  if (['authorized', 'canceled', 'paused'].includes(remote.status)) {
    db.prepare(`UPDATE billing_recurring SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(row.plan === 'annual' && row.paid_cycles >= 12 ? 'completed' : remote.status, row.id);
    // Authorization alone never grants access; a verified paid invoice is required.
    if (!row.paid_cycles && remote.status !== 'authorized')
      db.prepare(`UPDATE business_billing SET status='none',updated_at=CURRENT_TIMESTAMP
        WHERE business_id=? AND status='pending'`).run(row.business_id);
  }
}
async function reconcileRecurringForBusiness(id: string) {
  const row = currentRecurring(id);
  if (!row?.provider_preapproval_id) return;
  const now = Date.now();
  const state = ensureBillingRow(id);
  const farFromRenewal = state.status === 'active' && state.current_period_end &&
    Date.parse(state.current_period_end) > now + 24 * 60 * 60_000 &&
    ['authorized', 'completed'].includes(row.status);
  if (now - (lastReconciliation.get(id) || 0) < (farFromRenewal ? 60 * 60_000 : 10_000)) return;
  await applyRecurringStatus(row.provider_preapproval_id);
  const result = z.object({ results: z.array(z.object({ id: paymentId })) })
    .parse(await providerRequest(`/authorized_payments/search?preapproval_id=${row.provider_preapproval_id}&limit=100`, 'GET'));
  const paid = new Set((db.prepare(`SELECT invoice_id FROM billing_recurring_invoices
    WHERE recurring_id=?`).all(row.id) as { invoice_id: string }[]).map(item => item.invoice_id));
  const needsBackfill = new Set((db.prepare(`SELECT invoice_id FROM billing_recurring_invoices
    WHERE recurring_id=? AND cycle_end IS NULL`).all(row.id) as { invoice_id: string }[])
    .map(item => item.invoice_id));
  const latestPaid = db.prepare(`SELECT invoice_id FROM billing_recurring_invoices
    WHERE recurring_id=? ORDER BY paid_at DESC LIMIT 1`).get(row.id) as { invoice_id: string } | undefined;
  for (const invoice of result.results.slice(0, 100)) {
    if (!paid.has(invoice.id) || needsBackfill.has(invoice.id) || invoice.id === latestPaid?.invoice_id)
      await applyRecurringInvoice(invoice.id);
  }
  lastReconciliation.set(id, now);
}
function signedEventId(req: Request) {
  const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  const requestId = req.get('x-request-id');
  const signature = req.get('x-signature');
  const queryId = req.query['data.id'];
  if (!secret || secret.length < 32 || !requestId || requestId.length > 128 ||
      !/^[\w-]+$/.test(requestId) || typeof queryId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,150}$/.test(queryId) || !signature) return null;
  const parts = Object.fromEntries(signature.split(',').map(part => part.trim().split('=', 2)));
  if (!/^\d{10,16}$/.test(parts.ts || '') || !/^[a-f0-9]{64}$/i.test(parts.v1 || '')) return null;
  const manifest = `id:${queryId};request-id:${requestId};ts:${parts.ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest();
  const supplied = Buffer.from(parts.v1, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) return null;
  return { objectId: queryId, requestId };
}

export const billingRouter = Router();
export const billingWebhookRouter = Router();
billingRouter.get('/subscription', async (_req, res) => {
  const id = businessId(res);
  let verificationDelayed = false;
  if (providerConfigured()) {
    try { await reconcileRecurringForBusiness(id); }
    catch { verificationDelayed = true; }
  }
  return res.json({ ...billingState(id), verificationDelayed });
});
billingRouter.post('/subscription/cancel', async (req, res) => {
  if (!z.object({}).strict().safeParse(req.body).success)
    return res.status(400).json({ error: 'Solicitação inválida.' });
  const row = currentRecurring(businessId(res));
  if (!row?.provider_preapproval_id || !['authorized', 'pending', 'paused'].includes(row.status))
    return res.status(409).json({ error: 'Não há assinatura ativa para cancelar.' });
  try {
    const remote = preapprovalSchema.parse(await providerRequest(
      `/preapproval/${row.provider_preapproval_id}`, 'PUT', { status: 'canceled' }, row.id));
    if (remote.id !== row.provider_preapproval_id || remote.external_reference !== row.id ||
        remote.status !== 'canceled') throw new Error('Cancelamento não confirmado.');
    db.prepare(`UPDATE billing_recurring SET status='canceled',updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).run(row.id);
    if (!row.paid_cycles) db.prepare(`UPDATE business_billing SET status='none',
      updated_at=CURRENT_TIMESTAMP WHERE business_id=? AND status='pending'`).run(row.business_id);
    return res.json(billingState(row.business_id));
  } catch {
    return res.status(502).json({ error: 'Não foi possível confirmar o cancelamento no Mercado Pago. Tente novamente.' });
  }
});
billingRouter.post('/trial', (req, res) => {
  if (!z.object({}).strict().safeParse(req.body).success)
    return res.status(400).json({ error: 'Solicitação inválida.' });
  const id = businessId(res);
  const state = ensureBillingRow(id);
  if (!state.trial_started_at) {
    if (state.last_paid_checkout_id || !['none', 'pending'].includes(state.status))
      return res.status(409).json({ error: 'O teste gratuito está disponível apenas para novas contas.' });
    db.prepare(`UPDATE business_billing SET trial_started_at=?,updated_at=CURRENT_TIMESTAMP
      WHERE business_id=? AND trial_started_at IS NULL AND last_paid_checkout_id IS NULL
      AND status IN ('none','pending')`).run(Date.now(), id);
  }
  return res.json(billingState(id));
});
billingRouter.patch('/onboarding', (req, res) => {
  if (req.body?.completed !== true || Object.keys(req.body).length !== 1)
    return res.status(400).json({ error: 'Confirmação inválida.' });
  const id = businessId(res);
  ensureBillingRow(id);
  db.prepare('UPDATE business_billing SET onboarding_completed=1,updated_at=CURRENT_TIMESTAMP WHERE business_id=?')
    .run(id);
  return res.json(billingState(id));
});
billingRouter.post('/checkout', async (req, res) => {
  const parsed = checkoutInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Escolha um plano e uma forma de pagamento válidos.' });
  const { plan, method } = parsed.data;
  if (method === 'pix' && !validDocument(parsed.data.cpfCnpj))
    return res.status(400).json({ error: 'Informe um CPF ou CNPJ válido para o Pix.' });
  if (method === 'card' && parsed.data.cpfCnpj)
    return res.status(400).json({ error: 'O documento e o cartão são preenchidos no checkout seguro.' });
  if (!providerConfigured())
    return res.status(503).json({ error: 'Pagamentos indisponíveis. Configure Mercado Pago e uma origem HTTPS pública.' });
  const appOrigin = origin();
  const ownerBusinessId = businessId(res);
  const current = ensureBillingRow(ownerBusinessId);
  const trialEndsAt = current.trial_started_at ? current.trial_started_at + trialMs : null;
  if (!trialEndsAt || trialEndsAt > Date.now())
    return res.status(409).json({ error: 'O primeiro mês é grátis. Escolha um plano quando o teste terminar; nenhuma cobrança será feita antes disso.' });
  if (current.status === 'active' && current.current_period_end &&
      Date.parse(current.current_period_end) > Date.now())
    return res.status(409).json({ error: 'Seu acesso pago está ativo. Aguarde o fim do período atual antes de contratar outro plano.' });
  const previousRecurring = currentRecurring(ownerBusinessId);
  if (previousRecurring && ['authorized', 'paused'].includes(previousRecurring.status))
    return res.status(409).json({ error: 'Sua assinatura ainda existe no Mercado Pago. Cancele a renovação antes de contratar outro plano.' });
  if (method === 'pix' && previousRecurring &&
      ['initiating', 'pending'].includes(previousRecurring.status))
    return res.status(409).json({ error: 'Você já tem uma assinatura em andamento. Conclua ou cancele a assinatura antes de gerar um Pix.' });
  if (method === 'card') {
    const pendingPix = db.prepare(`SELECT 1 FROM billing_checkouts WHERE business_id=?
      AND method='pix' AND status IN ('initiating','pending') AND created_at_ms>?
      LIMIT 1`).get(ownerBusinessId, Date.now() - 60 * 60_000);
    if (pendingPix) return res.status(409).json({ error: 'Você já tem um Pix em andamento. Aguarde a confirmação ou o vencimento antes de assinar no cartão.' });
    const existingRecurring = previousRecurring;
    if (existingRecurring && ['initiating', 'pending', 'authorized', 'paused'].includes(existingRecurring.status)) {
      if (existingRecurring.plan !== plan)
        return res.status(409).json({ error: 'Já existe uma assinatura em andamento. Cancele ou conclua essa assinatura antes de trocar de plano.' });
      if (existingRecurring.status === 'pending' && existingRecurring.checkout_url)
        return res.json({ status: 'pending', checkoutUrl: existingRecurring.checkout_url });
      if (existingRecurring.status === 'initiating') {
        const owner = db.prepare("SELECT email FROM users WHERE business_id=? AND role='owner'")
          .get(ownerBusinessId) as { email: string } | undefined;
        try {
          const recovered = owner?.email ? await recoverInitiatingRecurring(existingRecurring, owner.email) : null;
          if (recovered) return res.json({ status: 'pending', checkoutUrl: recovered });
        } catch { /* An ambiguous request remains locked until the provider can verify it. */ }
      }
      return res.status(409).json({ error: 'Sua assinatura já está em andamento. Atualize o estado ou entre em contato com o suporte antes de tentar novamente.' });
    }
    const recent = db.prepare(`SELECT COUNT(*) AS count FROM billing_recurring
      WHERE business_id=? AND created_at_ms>?`).get(ownerBusinessId, Date.now() - 60 * 60_000) as { count: number };
    if (recent.count >= 5)
      return res.status(429).json({ error: 'Muitas tentativas de assinatura. Aguarde antes de tentar novamente.' });
    const owner = db.prepare("SELECT email FROM users WHERE business_id=? AND role='owner'")
      .get(ownerBusinessId) as { email: string } | undefined;
    if (!owner?.email) return res.status(400).json({ error: 'Cadastre um e-mail para assinar.' });
    const localId = randomUUID();
    db.prepare(`INSERT INTO billing_recurring(id,business_id,plan,amount_cents,status,created_at_ms)
      VALUES(?,?,?,?,'initiating',?)`)
      .run(localId, ownerBusinessId, plan, recurringPrices[plan], Date.now());
    let preapprovalAttempted = false;
    try {
      const planId = await recurringPlanId(plan, appOrigin);
      db.prepare(`UPDATE billing_recurring SET provider_plan_id=?,preapproval_attempted_at=?
        WHERE id=? AND status='initiating'`).run(planId, Date.now(), localId);
      preapprovalAttempted = true;
      const remote = preapprovalSchema.parse(await providerRequest('/preapproval', 'POST', {
        preapproval_plan_id: planId,
        external_reference: localId,
        payer_email: owner.email,
        back_url: `${appOrigin}/app/boas-vindas?pagamento=retorno`,
        status: 'pending',
      }, localId));
      if (remote.external_reference !== localId || remote.preapproval_plan_id !== planId ||
          remote.status !== 'pending' || !remote.init_point)
        throw new Error('Assinatura Mercado Pago inconsistente.');
      const checkoutUrl = trustedSubscriptionUrl(remote.init_point, remote.id);
      db.prepare(`UPDATE billing_recurring SET provider_plan_id=?,provider_preapproval_id=?,
        checkout_url=?,status='pending',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(planId, remote.id, checkoutUrl, localId);
      db.prepare(`UPDATE business_billing SET status='pending',updated_at=CURRENT_TIMESTAMP
        WHERE business_id=? AND status<>'active'`).run(ownerBusinessId);
      return res.json({ status: 'pending', checkoutUrl });
    } catch (error) {
      const definitivelyRejected = error instanceof ProviderHttpError &&
        [400, 401, 403, 404, 422].includes(error.status);
      if (!preapprovalAttempted || definitivelyRejected)
        db.prepare(`DELETE FROM billing_recurring WHERE id=? AND status='initiating'
          AND provider_preapproval_id IS NULL`).run(localId);
      return res.status(502).json({ error: 'Não foi possível preparar a assinatura. Aguarde e consulte o suporte antes de tentar novamente.' });
    }
  }
  if (current.status === 'active' && current.plan === 'annual' &&
      current.current_period_end && Date.parse(current.current_period_end) > Date.now() && plan === 'monthly')
    return res.status(409).json({ error: 'Seu plano anual está ativo. Aguarde o término antes de escolher o mensal.' });
  const recentCount = db.prepare(`SELECT COUNT(*) AS count FROM billing_checkouts
    WHERE business_id=? AND created_at_ms>?`).get(ownerBusinessId, Date.now() - 60 * 60_000) as { count: number };
  if (recentCount.count >= 5)
    return res.status(429).json({ error: 'Muitas tentativas de pagamento. Aguarde antes de tentar novamente.' });
  const existing = db.prepare(`SELECT * FROM billing_checkouts WHERE business_id=?
    AND status IN ('initiating','pending') AND created_at_ms>?
    ORDER BY created_at_ms DESC LIMIT 1`).get(ownerBusinessId, Date.now() - 60 * 60_000) as CheckoutRow | undefined;
  if (existing) {
    if (existing.plan !== plan || existing.method !== method)
      return res.status(409).json({ error: 'Você já tem um pagamento em andamento. Aguarde ou conclua o anterior.' });
    if (existing.method === 'pix' && existing.provider_payment_id) {
      try {
        const payment = await providerRequest(`/v1/payments/${existing.provider_payment_id}`, 'GET');
        return res.json({ status: 'pending', pix: pixDetails(payment) });
      } catch { return res.status(502).json({ error: 'Não foi possível recuperar o Pix agora.' }); }
    }
    return res.status(409).json({ error: 'A cobrança está sendo preparada. Tente novamente em alguns minutos.' });
  }
  const owner = db.prepare("SELECT name,email FROM users WHERE business_id=? AND role='owner'")
    .get(ownerBusinessId) as { name: string; email: string } | undefined;
  if (!owner?.email) return res.status(400).json({ error: 'Cadastre um e-mail para iniciar o pagamento.' });
  const localId = randomUUID();
  db.prepare(`INSERT INTO billing_checkouts(id,business_id,plan,method,amount_cents,status,created_at_ms)
    VALUES(?,?,?,?,?,'initiating',?)`).run(localId, ownerBusinessId, plan, method, planPrices[plan], Date.now());
  try {
    const document = parsed.data.cpfCnpj!.replace(/\D/g, '');
    const payment = paymentSchema.parse(await providerRequest('/v1/payments', 'POST', {
      transaction_amount: planPrices[plan] / 100,
      description: `Plano Nayla ${plan === 'monthly' ? 'mensal' : 'anual'}`,
      payment_method_id: 'pix', external_reference: localId,
      date_of_expiration: new Date(Date.now() + 60 * 60_000).toISOString(),
      notification_url: `${appOrigin}/api/billing/webhooks/mercado-pago`,
      payer: { email: owner.email, first_name: owner.name.split(' ')[0],
        identification: { type: document.length === 11 ? 'CPF' : 'CNPJ', number: document } },
    }, localId));
    if (payment.external_reference !== localId || payment.payment_method_id !== 'pix' ||
        Math.round(payment.transaction_amount * 100) !== planPrices[plan]) throw new Error('Pix inválido.');
    db.prepare(`UPDATE billing_checkouts SET provider_payment_id=?,status='pending',
      updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(payment.id, localId);
    db.prepare(`UPDATE business_billing SET status=CASE WHEN status='active' THEN status ELSE 'pending' END,
      updated_at=CURRENT_TIMESTAMP WHERE business_id=?`).run(ownerBusinessId);
    return res.json({ status: 'pending', pix: pixDetails(payment) });
  } catch {
    // An ambiguous upstream failure keeps this reference reserved. A delayed, verified webhook
    // can still activate the purchase without trusting a browser return or creating a duplicate.
    return res.status(502).json({ error: 'Não foi possível confirmar a criação do pagamento. Aguarde e verifique antes de tentar novamente.' });
  }
});

billingWebhookRouter.post('/mercado-pago', async (req, res) => {
  const signed = signedEventId(req);
  if (!signed) return res.status(401).json({ error: 'Não autorizado.' });
  const event = z.object({ type: z.enum(['payment', 'subscription_preapproval',
    'subscription_authorized_payment']), data: z.object({ id: z.union([paymentId, providerId]) }),
    action: z.string().max(80).optional() }).passthrough().safeParse(req.body);
  if (!event.success || event.data.data.id !== signed.objectId ||
      (event.data.type !== 'subscription_preapproval' && !/^\d{1,30}$/.test(signed.objectId)))
    return res.status(400).json({ error: 'Evento inválido.' });
  if (event.data.type === 'subscription_preapproval') {
    try { await applyRecurringStatus(signed.objectId); }
    catch { return res.status(503).json({ error: 'Não foi possível verificar a assinatura.' }); }
    return res.status(200).json({ received: true });
  }
  if (event.data.type === 'subscription_authorized_payment') {
    try { await applyRecurringInvoice(signed.objectId); }
    catch { return res.status(503).json({ error: 'Não foi possível verificar a fatura.' }); }
    return res.status(200).json({ received: true });
  }
  let payment: z.infer<typeof paymentSchema>;
  try { payment = paymentSchema.parse(await providerRequest(`/v1/payments/${signed.objectId}`, 'GET')); }
  catch { return res.status(503).json({ error: 'Não foi possível verificar o pagamento.' }); }
  if (payment.id !== signed.objectId) return res.status(502).json({ error: 'Pagamento inconsistente.' });
  if (process.env.NODE_ENV === 'production' && payment.live_mode !== true)
    return res.status(200).json({ received: true });
  const validReference = payment.external_reference &&
    z.string().uuid().safeParse(payment.external_reference).success ? payment.external_reference : null;
  const row = validReference ? db.prepare('SELECT * FROM billing_checkouts WHERE id=?')
    .get(validReference) as CheckoutRow | undefined : undefined;
  if (!row) {
    const recurring = validReference ? db.prepare('SELECT id FROM billing_recurring WHERE id=?')
      .get(validReference) as { id: string } | undefined : undefined;
    if (!recurring) return res.status(200).json({ received: true });
    // Payment notifications can arrive instead of the subscription invoice topic.
    // Resolve the invoice through the provider, never from request body or tenant input.
    try {
      const result = z.object({ results: z.array(z.object({ id: paymentId })) })
        .parse(await providerRequest(`/authorized_payments/search?payment_id=${payment.id}`, 'GET'));
      for (const invoice of result.results.slice(0, 5)) await applyRecurringInvoice(invoice.id);
    } catch { return res.status(503).json({ error: 'Não foi possível conciliar o pagamento recorrente.' }); }
    return res.status(200).json({ received: true });
  }
  if (payment.currency_id !== 'BRL' ||
      Math.round(payment.transaction_amount * 100) !== row.amount_cents ||
      (row.method === 'pix' && (payment.payment_method_id !== 'pix' ||
        (row.provider_payment_id && row.provider_payment_id !== payment.id))))
    return res.status(200).json({ received: true });
  db.prepare(`INSERT OR IGNORE INTO billing_webhook_events(id,event_type,object_id)
    VALUES(?,?,?)`).run(signed.requestId, event.data.action || 'payment', payment.id);
  if (payment.status === 'approved') {
    try { markPaid(row, payment.id); }
    catch { return res.status(503).json({ error: 'Não foi possível registrar o pagamento.' }); }
  } else if (['refunded', 'charged_back'].includes(payment.status)) {
    if (row.status === 'paid') db.prepare(`UPDATE business_billing SET status='past_due',
      updated_at=CURRENT_TIMESTAMP WHERE business_id=? AND last_paid_checkout_id=?`)
      .run(row.business_id, row.id);
  } else if (['rejected', 'cancelled'].includes(payment.status)) {
    db.prepare(`UPDATE billing_checkouts SET status='failed',updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status IN ('initiating','pending')`).run(row.id);
  }
  return res.status(200).json({ received: true });
});
