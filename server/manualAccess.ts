import { createHash, createHmac, randomBytes } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { db, id } from './db.js';

type State = 'pending' | 'trial' | 'active' | 'blocked';
type AccessRow = { business_id: string; state: State; trial_started_at: number | null;
  trial_ends_at: number | null; access_ends_at: number | null; onboarding_completed: number };
type AdminUser = { id: string; business_id: string; role: string };
export class ManualAccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const monthMs = 30 * 24 * 60 * 60_000;
const deviceCookie = 'nayla_trial_device';
const deviceLifetime = 365 * 24 * 60 * 60_000;

function identityKey() {
  const raw = process.env.ACCESS_IDENTITY_SECRET || '';
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || key.toString('base64') !== raw)
    throw new Error('Configure ACCESS_IDENTITY_SECRET com 32 bytes aleatórios em base64 para liberar testes.');
  return key;
}

export function assertAccessConfiguration() {
  if (process.env.NODE_ENV === 'production') identityKey();
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function claim(kind: 'email' | 'phone' | 'device', value: string) {
  return createHmac('sha256', identityKey()).update(`${kind}:${value}`).digest('hex');
}

// A random first-party cookie is a best-effort device marker, not a hardware ID.
// Native clients may send a securely stored, random per-install value instead.
export function recordOwnerDevice(req: Request, res: Response, businessId: string, native: boolean) {
  let token: string | undefined;
  if (native) token = req.get('x-nayla-device');
  else {
    const existing = req.cookies?.[deviceCookie];
    token = typeof existing === 'string' && /^[a-f0-9]{64}$/.test(existing) ? existing : undefined;
    if (!token) {
      token = randomBytes(32).toString('hex');
      res.cookie(deviceCookie, token, { httpOnly: true, sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production', maxAge: deviceLifetime, path: '/' });
    }
  }
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const deviceHash = digest(token);
    db.prepare(`INSERT OR IGNORE INTO owner_devices
      (business_id,device_hash) VALUES(?,?)`).run(businessId, deviceHash);
    const access = db.prepare('SELECT trial_started_at FROM business_access WHERE business_id=?')
      .get(businessId) as {trial_started_at:number|null}|undefined;
    if (access?.trial_started_at && process.env.ACCESS_IDENTITY_SECRET)
      db.prepare(`INSERT OR IGNORE INTO trial_identity_claims(identity_hash,kind,business_id)
        VALUES(?,'device',?)`).run(claim('device', deviceHash), businessId);
  }
}

function ensureAccess(businessId: string): AccessRow {
  db.prepare('INSERT OR IGNORE INTO business_access(business_id) VALUES(?)').run(businessId);
  return db.prepare('SELECT * FROM business_access WHERE business_id=?').get(businessId) as AccessRow;
}

function effectiveState(row: AccessRow, now = Date.now()) {
  if (row.state === 'blocked') return 'blocked' as const;
  if (row.state === 'pending') return 'pending' as const;
  return row.access_ends_at && row.access_ends_at > now ? row.state : 'expired' as const;
}

export function manualAccessState(businessId: string) {
  const row = ensureAccess(businessId);
  const manualAccessStatus = effectiveState(row);
  return { manualAccessStatus, accessEndsAt: row.access_ends_at ?
      new Date(row.access_ends_at).toISOString() : null,
    trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at).toISOString() : null,
    trialStartedAt: row.trial_started_at ? new Date(row.trial_started_at).toISOString() : null,
    onboardingCompleted: Boolean(row.onboarding_completed),
    accessGranted: manualAccessStatus === 'trial' || manualAccessStatus === 'active' };
}

export function manualAccessForBusiness(businessId: string) {
  return manualAccessState(businessId).accessGranted;
}

export function requireManualAccess(_req: Request, res: Response, next: NextFunction) {
  const state = manualAccessState((res.locals.user as AdminUser).business_id);
  if (state.accessGranted) return next();
  return res.status(402).json({ error: state.manualAccessStatus === 'pending'
    ? 'Seu cadastro aguarda a liberação da equipe Nayla.'
    : state.manualAccessStatus === 'blocked'
      ? 'O acesso da sua conta foi bloqueado. Fale com a equipe Nayla.'
      : 'O período de acesso terminou. Fale com a equipe Nayla para renovar.' });
}

export function isSuperAdmin(userId: string) {
  return Boolean(db.prepare('SELECT 1 FROM super_admin_accounts WHERE user_id=?')
    .get(userId));
}

export const manualAccessRouter = Router();
manualAccessRouter.get('/subscription', (_req, res) => {
  const state = manualAccessState((res.locals.user as AdminUser).business_id);
  res.json({ ...state, plan: null, status: state.manualAccessStatus,
    currentPeriodEnd: state.accessEndsAt, trialDaysRemaining: state.trialEndsAt ?
      Math.max(0, Math.ceil((Date.parse(state.trialEndsAt) - Date.now()) / 86_400_000)) : 0,
    trialRequiresCard: false, trialAvailable: false, providerConfigured: false,
    checkoutUrl: null, billingMethod: null, recurringStatus: null,
    canCancelRecurring: false, autoRenews: false, annualInstallmentsPaid: null });
});
manualAccessRouter.patch('/onboarding', (_req, res) => {
  const businessId = (res.locals.user as AdminUser).business_id;
  db.prepare(`UPDATE business_access SET onboarding_completed=1,updated_at=CURRENT_TIMESTAMP
    WHERE business_id=?`).run(businessId);
  res.json(manualAccessState(businessId));
});

function requireSuperAdmin(_req: Request, res: Response, next: NextFunction) {
  if (!isSuperAdmin((res.locals.user as AdminUser).id))
    return res.status(403).json({ error: 'Acesso reservado à administração Nayla.' });
  next();
}

export const adminRouter = Router();
adminRouter.get('/me', (_req, res) => res.json({
  isSuperAdmin: isSuperAdmin((res.locals.user as AdminUser).id),
}));
adminRouter.use(requireSuperAdmin);

function requireRecentAdminLogin(_req: Request, res: Response, next: NextFunction) {
  const user = res.locals.user as AdminUser & {session_created_at?: string};
  const created = user.session_created_at
    ? Date.parse(`${user.session_created_at.replace(' ', 'T')}Z`) : 0;
  if (!created || Date.now() - created > 15 * 60_000)
    return res.status(403).json({ error: 'Entre novamente para confirmar esta alteração administrativa.' });
  next();
}
const adminMutations = new Map<string,{until:number;count:number}>();
function limitAdminMutation(_req: Request, res: Response, next: NextFunction) {
  const userId = (res.locals.user as AdminUser).id;
  const now = Date.now();
  const current = adminMutations.get(userId);
  const entry = current && current.until > now ? current : {until:now + 15*60_000,count:0};
  entry.count++;
  adminMutations.set(userId,entry);
  if (entry.count > 20) return res.status(429).json({error:'Muitas alterações administrativas. Aguarde alguns minutos.'});
  next();
}

const pagination = z.object({ query: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20) });
function professionalRow(businessId: string) {
  const row = db.prepare(`SELECT b.id AS business_id,b.name AS business_name,b.slug,b.specialties,
    b.created_at,u.id AS owner_id,u.name AS owner_name,u.email,
    COALESCE(NULLIF(b.phone,''),u.phone) AS phone,
    u.google_subject,a.state,a.trial_started_at,a.trial_ends_at,a.access_ends_at
    FROM businesses b JOIN users u ON u.business_id=b.id AND u.role='owner'
    LEFT JOIN business_access a ON a.business_id=b.id WHERE b.id=?`)
    .get(businessId) as Record<string, any> | undefined;
  if (!row) return null;
  const state = manualAccessState(row.business_id);
  return { businessId: row.business_id, businessName: row.business_name, slug: row.slug,
    ownerId: row.owner_id, ownerName: row.owner_name, email: row.email || '',
    phone: row.phone || '', specialties: JSON.parse(row.specialties || '[]') as string[],
    createdAt: row.created_at, manualAccessStatus: state.manualAccessStatus,
    accessEndsAt: state.accessEndsAt, trialStartedAt: state.trialStartedAt,
    trialEndsAt: state.trialEndsAt, googleConnected: Boolean(row.google_subject) };
}
adminRouter.get('/professionals', (req, res) => {
  const input = pagination.parse(req.query);
  const escaped = input.query.replace(/[\\%_]/g, '\\$&');
  const match = `%${escaped}%`;
  const where = `FROM businesses b JOIN users u ON u.business_id=b.id AND u.role='owner'
    WHERE b.name LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\'
      OR u.email LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\'
      OR b.phone LIKE ? ESCAPE '\\'`;
  const args = [match, match, match, match, match];
  const total = (db.prepare(`SELECT COUNT(*) AS total ${where}`).get(...args) as {total:number}).total;
  const ids = db.prepare(`SELECT b.id ${where} ORDER BY b.created_at DESC,b.id DESC
    LIMIT ? OFFSET ?`).all(...args, input.pageSize, (input.page - 1) * input.pageSize) as {id:string}[];
  res.json({ items: ids.map(row => professionalRow(row.id)), total,
    page: input.page, pageSize: input.pageSize });
});

const adjustment = z.object({ days: z.number().int().min(1).max(366).default(30),
  kind: z.enum(['trial','paid']).optional(), reason: z.string().trim().max(250).optional() });
function audit(businessId: string, actorId: string, action: string, before: AccessRow,
  after: AccessRow, reason?: string) {
  db.prepare(`INSERT INTO access_audit(id,business_id,actor_user_id,action,previous_state,
    new_state,previous_ends_at,new_ends_at,reason) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(id(), businessId, actorId, action, before.state, after.state,
      before.access_ends_at, after.access_ends_at, reason || null);
}
function target(req: Request) {
  const businessId = z.uuid().parse(req.params.id);
  if (!db.prepare('SELECT 1 FROM businesses WHERE id=?').get(businessId))
    throw new ManualAccessError(404, 'Profissional não encontrada.');
  return businessId;
}
function trialClaims(businessId: string) {
  const owner = db.prepare(`SELECT email,phone FROM users WHERE business_id=? AND role='owner'`)
    .get(businessId) as {email:string|null;phone:string|null}|undefined;
  if (!owner?.email) throw new ManualAccessError(409, 'A conta precisa de um e-mail para o teste.');
  const identities: {kind:'email'|'phone'|'device';hash:string}[] = [
    { kind: 'email', hash: claim('email', owner.email.trim().toLowerCase()) }];
  if (owner.phone) identities.push({ kind: 'phone', hash: claim('phone', owner.phone.replace(/\D/g,'')) });
  const devices = db.prepare('SELECT device_hash FROM owner_devices WHERE business_id=?')
    .all(businessId) as {device_hash:string}[];
  for (const device of devices) identities.push({kind:'device',hash:claim('device',device.device_hash)});
  const find = db.prepare('SELECT business_id FROM trial_identity_claims WHERE identity_hash=?');
  if (identities.some(item => {
    const prior = find.get(item.hash) as {business_id:string}|undefined;
    return prior && prior.business_id !== businessId;
  })) throw new ManualAccessError(409, 'Esta identidade já utilizou o teste gratuito em outra conta.');
  const add = db.prepare(`INSERT OR IGNORE INTO trial_identity_claims(identity_hash,kind,business_id)
    VALUES(?,?,?)`);
  for (const item of identities) add.run(item.hash,item.kind,businessId);
}

adminRouter.post('/professionals/:id/grant', requireRecentAdminLogin, limitAdminMutation, (req, res) => {
  const input = adjustment.parse(req.body || {});
  const businessId = target(req);
  const actorId = (res.locals.user as AdminUser).id;
  db.transaction(() => {
    const before = ensureAccess(businessId);
    const now = Date.now();
    if (input.kind === 'trial' && (before.trial_started_at || before.access_ends_at))
      throw new ManualAccessError(409, 'Esta conta já recebeu acesso ou teste. Use a liberação paga.');
    if (effectiveState(before, now) === 'trial' || effectiveState(before, now) === 'active')
      throw new ManualAccessError(409, 'O acesso já está ativo. Use a opção de estender o prazo.');
    const initialTrial = !before.trial_started_at && !before.access_ends_at && input.kind !== 'paid';
    if (initialTrial && input.days !== 30)
      throw new ManualAccessError(400, 'O teste inicial tem exatamente 30 dias.');
    if (initialTrial) trialClaims(businessId);
    const state = initialTrial ? 'trial' : 'active';
    const end = initialTrial ? now + monthMs
      : Math.max(before.access_ends_at || 0, now + input.days * 86_400_000);
    db.prepare(`UPDATE business_access SET state=?,trial_started_at=COALESCE(trial_started_at,?),
      trial_ends_at=COALESCE(trial_ends_at,?),access_ends_at=?,updated_at=CURRENT_TIMESTAMP
      WHERE business_id=?`).run(state, initialTrial ? now : null,
        initialTrial ? end : null, end, businessId);
    audit(businessId, actorId, initialTrial ? 'trial_granted' : 'access_granted', before,
      ensureAccess(businessId), input.reason);
  }).immediate();
  res.json(professionalRow(businessId));
});
adminRouter.post('/professionals/:id/revoke', requireRecentAdminLogin, limitAdminMutation, (req, res) => {
  const input = z.object({reason:z.string().trim().max(250).optional()}).parse(req.body || {});
  const businessId = target(req);
  const actorId = (res.locals.user as AdminUser).id;
  db.transaction(() => {
    const before = ensureAccess(businessId);
    db.prepare(`UPDATE business_access SET state='blocked',updated_at=CURRENT_TIMESTAMP
      WHERE business_id=?`).run(businessId);
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_notifications'").get())
      db.prepare(`UPDATE app_notifications SET superseded_at=CURRENT_TIMESTAMP
        WHERE business_id=? AND kind LIKE 'reminder_%' AND superseded_at IS NULL`).run(businessId);
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='reminder_deliveries'").get())
      db.prepare(`UPDATE reminder_deliveries SET status='skipped',updated_at=CURRENT_TIMESTAMP
        WHERE business_id=? AND status='pending'`).run(businessId);
    audit(businessId, actorId, 'access_blocked', before, ensureAccess(businessId), input.reason);
  }).immediate();
  res.json(professionalRow(businessId));
});
adminRouter.post('/professionals/:id/extend', requireRecentAdminLogin, limitAdminMutation, (req, res) => {
  const input = adjustment.parse(req.body || {});
  const businessId = target(req);
  const actorId = (res.locals.user as AdminUser).id;
  db.transaction(() => {
    const before = ensureAccess(businessId);
    if (!before.access_ends_at)
      throw new ManualAccessError(409, 'Libere o acesso antes de estender o prazo.');
    const end = Math.max(Date.now(), before.access_ends_at) + input.days * 86_400_000;
    db.prepare(`UPDATE business_access SET state='active',access_ends_at=?,
      updated_at=CURRENT_TIMESTAMP WHERE business_id=?`).run(end, businessId);
    audit(businessId, actorId, 'access_extended', before, ensureAccess(businessId), input.reason);
  }).immediate();
  res.json(professionalRow(businessId));
});
adminRouter.get('/audit', (req, res) => {
  const input = z.object({ businessId: z.uuid(), page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20) }).parse(req.query);
  const rows = db.prepare(`SELECT action,previous_state AS previousState,new_state AS newState,
    previous_ends_at AS previousEndsAt,new_ends_at AS newEndsAt,reason,created_at AS createdAt
    FROM access_audit WHERE business_id=? ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?`)
    .all(input.businessId,input.pageSize,(input.page-1)*input.pageSize);
  res.json({items:rows,page:input.page,pageSize:input.pageSize});
});

// Claim identities for trials imported from the previous billing system.
// Keep only HMAC digests; names, CPF and client records never enter this table.
if (process.env.ACCESS_IDENTITY_SECRET) {
  const historical = db.prepare(`SELECT a.business_id,u.email,u.phone FROM business_access a
    JOIN users u ON u.business_id=a.business_id AND u.role='owner'
    WHERE a.trial_started_at IS NOT NULL`).all() as {business_id:string;email:string|null;phone:string|null}[];
  const add = db.prepare(`INSERT OR IGNORE INTO trial_identity_claims(identity_hash,kind,business_id)
    VALUES(?,?,?)`);
  db.transaction(() => {
    for (const owner of historical) {
      if (owner.email) add.run(claim('email',owner.email.trim().toLowerCase()),'email',owner.business_id);
      if (owner.phone) add.run(claim('phone',owner.phone.replace(/\D/g,'')),'phone',owner.business_id);
    }
  }).immediate();
}
