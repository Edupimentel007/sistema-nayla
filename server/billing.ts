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
  trial_card_verified_at: number | null; last_paid_checkout_id: string | null };
type CheckoutRow = { id: string; business_id: string; plan: Plan; method: Method;
  amount_cents: number; status: CheckoutStatus; provider_checkout_id: string | null;
  provider_checkout_url: string | null; provider_payment_id: string | null; created_at_ms: number };

export const planPrices = { monthly: 4990, annual: 42000 } as const;
const trialMs = 30 * 24 * 60 * 60_000;
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

db.exec(`CREATE TABLE IF NOT EXISTS business_billing (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  onboarding_completed INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_completed IN (0,1)),
  plan TEXT CHECK (plan IN ('monthly','annual')),
  status TEXT NOT NULL DEFAULT 'none' CHECK (status IN ('none','pending','active','past_due','canceled')),
  current_period_end TEXT,
  trial_started_at INTEGER,
  trial_card_verified_at INTEGER,
  last_paid_checkout_id TEXT,
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
);`);
for (const [table, column, definition] of [
  ['business_billing', 'trial_started_at', 'INTEGER'],
  ['business_billing', 'trial_card_verified_at', 'INTEGER'],
  ['business_billing', 'last_paid_checkout_id', 'TEXT'],
  ['billing_checkouts', 'provider_checkout_url', 'TEXT'],
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
  return { plan: state.plan, status: state.status,
    onboardingCompleted: Boolean(state.onboarding_completed),
    currentPeriodEnd: state.current_period_end, trialEndsAt,
    trialDaysRemaining: trialEndsAt ? Math.max(0, Math.ceil((Date.parse(trialEndsAt) - now) / (24 * 60 * 60_000))) : 0,
    trialRequiresCard: false,
    trialAvailable: !state.trial_started_at && !state.last_paid_checkout_id &&
      ['none', 'pending'].includes(state.status),
    accessGranted: (process.env.NODE_ENV !== 'production' && !configured) ||
      trialActive || paidActive, providerConfigured: configured,
    checkoutUrl: latest?.provider_checkout_url || undefined };
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
async function providerRequest(path: string, method: 'GET' | 'POST', body?: unknown, key?: string) {
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!token) throw new Error('Mercado Pago indisponível.');
  const response = await fetch(`${providerBase()}${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'X-Idempotency-Key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Mercado Pago HTTP ${response.status}`);
  return await response.json() as unknown;
}
function trustedCheckoutUrl(value: string, id: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Checkout inválido.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      !['www.mercadopago.com.br', 'mercadopago.com.br', 'sandbox.mercadopago.com.br',
        'www.mercadopago.com', 'mercadopago.com', 'sandbox.mercadopago.com']
        .includes(url.hostname) ||
      !(/^\/checkout\//.test(url.pathname) || /^\/mla\/checkout\//.test(url.pathname)) ||
      url.searchParams.get('pref_id') !== id)
    throw new Error('Checkout inválido.');
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
      last_paid_checkout_id=?,updated_at=CURRENT_TIMESTAMP WHERE business_id=?`)
      .run(nextPlan, periodEnd(row.plan, base), row.id, row.business_id);
  })();
}
function signedPaymentId(req: Request) {
  const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  const requestId = req.get('x-request-id');
  const signature = req.get('x-signature');
  const queryId = req.query['data.id'];
  if (!secret || secret.length < 32 || !requestId || requestId.length > 128 ||
      !/^[\w-]+$/.test(requestId) || typeof queryId !== 'string' ||
      !/^\d{1,30}$/.test(queryId) || !signature) return null;
  const parts = Object.fromEntries(signature.split(',').map(part => part.trim().split('=', 2)));
  if (!/^\d{10,16}$/.test(parts.ts || '') || !/^[a-f0-9]{64}$/i.test(parts.v1 || '')) return null;
  const manifest = `id:${queryId};request-id:${requestId};ts:${parts.ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest();
  const supplied = Buffer.from(parts.v1, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) return null;
  return { paymentId: queryId, requestId };
}

export const billingRouter = Router();
export const billingWebhookRouter = Router();
billingRouter.get('/subscription', (_req, res) => res.json(billingState(businessId(res))));
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
    if (existing.method === 'card' && existing.provider_checkout_url)
      return res.json({ status: 'pending', checkoutUrl: existing.provider_checkout_url });
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
    if (method === 'card') {
      const created = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{3,150}$/),
        init_point: z.string().url() }).parse(await providerRequest('/checkout/preferences', 'POST', {
        items: [{ id: `nayla-${plan}`, title: `Nayla ${plan === 'monthly' ? 'Mensal' : 'Anual'}`,
          currency_id: 'BRL', quantity: 1, unit_price: planPrices[plan] / 100 }],
        payer: { email: owner.email }, external_reference: localId,
        payment_methods: { excluded_payment_types: [
          { id: 'ticket' }, { id: 'bank_transfer' }, { id: 'debit_card' },
        ], installments: plan === 'annual' ? 12 : 1 },
        back_urls: { success: `${appOrigin}/app/boas-vindas?pagamento=retorno`,
          failure: `${appOrigin}/app/boas-vindas?pagamento=falha`,
          pending: `${appOrigin}/app/boas-vindas?pagamento=pendente` },
        auto_return: 'approved', expires: true,
        expiration_date_to: new Date(Date.now() + 60 * 60_000).toISOString(),
        notification_url: `${appOrigin}/api/billing/webhooks/mercado-pago`,
      }, localId));
      const safeUrl = trustedCheckoutUrl(created.init_point, created.id);
      db.prepare(`UPDATE billing_checkouts SET provider_checkout_id=?,provider_checkout_url=?,
        status='pending',updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(created.id, safeUrl, localId);
      db.prepare(`UPDATE business_billing SET status=CASE WHEN status='active' THEN status ELSE 'pending' END,
        updated_at=CURRENT_TIMESTAMP WHERE business_id=?`).run(ownerBusinessId);
      return res.json({ status: 'pending', checkoutUrl: safeUrl });
    }
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
  const signed = signedPaymentId(req);
  if (!signed) return res.status(401).json({ error: 'Não autorizado.' });
  const event = z.object({ type: z.literal('payment'), data: z.object({ id: paymentId }),
    action: z.string().max(80).optional() }).passthrough().safeParse(req.body);
  if (!event.success || event.data.data.id !== signed.paymentId)
    return res.status(400).json({ error: 'Evento inválido.' });
  let payment: z.infer<typeof paymentSchema>;
  try { payment = paymentSchema.parse(await providerRequest(`/v1/payments/${signed.paymentId}`, 'GET')); }
  catch { return res.status(503).json({ error: 'Não foi possível verificar o pagamento.' }); }
  if (payment.id !== signed.paymentId) return res.status(502).json({ error: 'Pagamento inconsistente.' });
  if (process.env.NODE_ENV === 'production' && payment.live_mode !== true)
    return res.status(200).json({ received: true });
  if (!payment.external_reference || !z.string().uuid().safeParse(payment.external_reference).success)
    return res.status(200).json({ received: true });
  const row = db.prepare('SELECT * FROM billing_checkouts WHERE id=?').get(payment.external_reference) as CheckoutRow | undefined;
  if (!row || payment.currency_id !== 'BRL' ||
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
