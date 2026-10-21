import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z, ZodError } from 'zod';
import { catalog, specialtySchema, specialtyValues } from './catalog.js';
import { addMinutes, dateAgo, db, fromCents, id, localNow, toCents, validDate } from './db.js';
import { applyWebhookStatuses, NotificationError, sendBookingConfirmation,
  sendBookingChangeNotification, updateWhatsAppSettings, verifyWebhookChallenge, verifyWebhookSignature,
  webhookSettings, whatsAppConfig } from './notifications.js';
import { answerAssistant, assistantStatus } from './assistant.js';
import { assistantConversationHistory, AssistantActionConflict, AssistantConversationNotFound,
  deleteAssistantConversation, getAssistantConversation, listAssistantConversations,
  saveAssistantActionResult, saveAssistantExchange } from './assistantHistory.js';
import { businessLogoUrl, deleteBusinessLogo, parseLogo, publicBusinessLogo, uploadBusinessLogo } from './logo.js';
import { analyticsRouter } from './analytics.js';
import { GoogleAuthError, mountGoogleAuth } from './googleAuth.js';
import { billingAccessForBusiness, billingRouter, billingWebhookRouter,
  requireBillingAccess } from './billing.js';
import { assertProductionSecurityConfiguration, browserRequestGuard, securityHeaders } from './security.js';
import { listInbox, markInboxRead, notifyOfBookingChange,
  notifyOwnerOfBooking, startReminderWorker } from './inbox.js';
import { handleReminderCron } from './reminderCron.js';

type Row = Record<string, any>;
type User = Row & { id: string; business_id: string; role: 'owner' | 'client' };
export const app = express();
assertProductionSecurityConfiguration();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1');
app.use(securityHeaders);
app.use(browserRequestGuard);
app.use(express.json({ limit: '32kb', verify: (req, _res, body) => {
  (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(body);
} }));
app.use(cookieParser());

const nativeOrigins = new Set(['capacitor://localhost', 'https://localhost']);
const configuredWebOrigin = process.env.APP_ORIGIN?.replace(/\/$/, '');
function nativeRequest(req: Request) {
  return req.get('x-nayla-app') === 'mobile' && nativeOrigins.has(req.get('origin') || '');
}
app.use((req, res, next) => {
  const origin = req.get('origin');
  const sameOrigin = process.env.NODE_ENV !== 'production' && origin === `${req.protocol}://${req.get('host')}`;
  const allowed = Boolean(origin && (nativeOrigins.has(origin) || origin === configuredWebOrigin || sameOrigin));
  if (allowed) {
    res.vary('Origin');
    res.setHeader('Access-Control-Allow-Origin', origin!);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') {
    if (!allowed) return res.status(403).end();
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Nayla-App');
    res.setHeader('Access-Control-Max-Age', '600');
    return res.status(204).end();
  }
  if (origin && !allowed && !['GET', 'HEAD'].includes(req.method))
    return res.status(403).json({ error: 'Origem não permitida.' });
  next();
});

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const rateState = new Map<string, { count: number; until: number }>();
function rateLimit(max: number, windowMs = 15 * 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.route?.path || req.path}`;
    const now = Date.now();
    const current = rateState.get(key);
    const entry = current && current.until > now ? current : { count: 0, until: now + windowMs };
    entry.count++;
    rateState.set(key, entry);
    if (entry.count > max) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateState) if (value.until < now) rateState.delete(key);
}, 60_000).unref();

function cookieName(role: 'owner' | 'client') { return role === 'owner' ? 'nayla_owner_session' : 'nayla_client_session'; }
const weekMs = 7 * 24 * 60 * 60_000;
const shortSessionMs = 24 * 60 * 60_000;
function createSession(req: Request, res: Response, user: User, remember = false) {
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  const lifetime = remember ? weekMs : shortSessionMs;
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
    .run(hash, user.id, Date.now() + lifetime);
  if (!nativeRequest(req)) {
    res.cookie(cookieName(user.role), token, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
      ...(remember ? { maxAge: lifetime } : {}), path: '/',
    });
  }
  return nativeRequest(req) ? { sessionToken: token } : {};
}
function getSessionUser(req: Request, role: 'owner' | 'client'): User | undefined {
  const authorization = req.get('authorization');
  const token = authorization ? /^Bearer ([a-f0-9]{64})$/.exec(authorization)?.[1] :
    req.cookies?.[cookieName(role)];
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return;
  return db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.role=?`)
    .get(createHash('sha256').update(token).digest('hex'), Date.now(), role) as User | undefined;
}
function revokeSession(req: Request, role: 'owner' | 'client') {
  const authorization = req.get('authorization');
  const token = authorization ? /^Bearer ([a-f0-9]{64})$/.exec(authorization)?.[1] :
    req.cookies?.[cookieName(role)];
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return;
  db.prepare(`DELETE FROM sessions WHERE token_hash=? AND user_id IN
    (SELECT id FROM users WHERE role=?)`)
    .run(createHash('sha256').update(token).digest('hex'), role);
}
function requireRole(role: 'owner' | 'client') {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = getSessionUser(req, role);
    if (!user) return res.status(401).json({ error: 'Faça login para continuar.' });
    res.locals.user = user;
    next();
  };
}
const authenticatedOwner = requireRole('owner');
const owner = (req: Request, res: Response, next: NextFunction) =>
  authenticatedOwner(req, res, () => requireBillingAccess(req, res, next));
app.use('/api/billing/webhooks', billingWebhookRouter);
app.use('/api/billing', authenticatedOwner, billingRouter);
app.use('/api/analytics', owner, analyticsRouter);
app.use('/api/auth/google', rateLimit(20));
function currentUser(res: Response): User { return res.locals.user as User; }
function businessById(businessId: string) {
  const row = db.prepare('SELECT * FROM businesses WHERE id=?').get(businessId) as Row;
  return businessDto(row);
}
function businessDto(row: Row) {
  return {
    id: row.id, name: row.name, slug: row.slug, description: row.description || '', phone: row.phone || '',
    specialties: JSON.parse(row.specialties) as string[], address: row.address || '',
    logoUrl: businessLogoUrl(row.id, row.slug),
    startTime: row.start_time, endTime: row.end_time,
    workdays: JSON.parse(row.workdays) as number[], slotInterval: row.slot_interval,
  };
}
function userDto(row: Row) {
  return { id: row.id, name: row.name, email: row.email || '', phone: row.phone || '',
    cpf: row.cpf || '', whatsappOptIn: Boolean(row.whatsapp_opt_in),
    role: row.role, businessId: row.business_id };
}
mountGoogleAuth(app, { createSession, businessById, businessDto, userDto, nativeRequest, rateLimit });
function serviceDto(row: Row) {
  return { id: row.id, name: row.name, description: row.description,
    category: row.category, durationMinutes: row.duration_minutes,
    price: fromCents(row.price_cents), active: Boolean(row.active) };
}
function appointmentDto(row: Row) {
  return {
    id: row.id, clientId: row.client_id, serviceId: row.service_id,
    clientName: row.client_name, clientPhone: row.client_phone || '', serviceName: row.service_name,
    date: row.date, time: row.start_time, endTime: row.end_time,
    startsAt: `${row.date}T${row.start_time}:00-03:00`,
    endsAt: `${row.date}T${row.end_time}:00-03:00`,
    status: row.status, price: fromCents(row.price_cents), notes: row.notes || '',
    whatsappOptIn: Boolean(row.whatsapp_opt_in),
    createdAt: row.created_at,
  };
}
function getAppointment(businessId: string, appointmentId: string) {
  return db.prepare(`SELECT a.*,u.name AS client_name,u.phone AS client_phone,s.name AS service_name
    FROM appointments a JOIN users u ON u.id=a.client_id JOIN services s ON s.id=a.service_id
    WHERE a.business_id=? AND a.id=?`).get(businessId, appointmentId) as Row | undefined;
}
function normalizeCpf(value: string) { return value.replace(/\D/g, ''); }
function validCpf(value: string) {
  const cpf = normalizeCpf(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (count: number) => {
    const sum = Array.from(cpf.slice(0, count)).reduce((acc, part, index) => acc + Number(part) * (count + 1 - index), 0);
    return ((sum * 10) % 11) % 10;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}
const email = z.email().max(180).transform(value => value.trim().toLowerCase());
const optionalEmail = z.preprocess(value => value === '' || value === null ? undefined : value, email.optional());
const password = z.string().min(12, 'Use pelo menos 12 caracteres na senha.').max(100)
  .refine(value => /[A-Za-z]/.test(value) && /\d/.test(value),
    'Use letras e números na senha.');
const slug = z.string().min(3).max(45).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const specialty = specialtySchema;
const date = z.string().refine(validDate, 'Data inválida.');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const money = z.number().finite().min(0).max(1_000_000);
const customService = z.object({
  name: z.string().trim().min(2).max(100), category: specialty, price: money,
  durationMinutes: z.number().int().min(15).max(480),
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/catalog', (_req, res) => res.json({ services: catalog }));

app.post('/api/auth/register', rateLimit(10), async (req, res) => {
  const input = z.object({
    ownerName: z.string().trim().min(2).max(100), businessName: z.string().trim().min(2).max(100),
    slug, email, password, phone: z.string().optional(), remember: z.boolean().default(false),
    specialties: z.array(specialty).min(1).max(specialtyValues.length),
    selectedServices: z.array(z.string().min(1).max(160)).max(catalog.length),
    customServices: z.array(customService).max(10).default([]),
  }).parse(req.body);
  const selectedTemplates = new Set(input.selectedServices);
  if (selectedTemplates.size !== input.selectedServices.length ||
    catalog.some(item => selectedTemplates.has(item.id) && !input.specialties.includes(item.category)) ||
    input.selectedServices.some(serviceId => !catalog.some(item => item.id === serviceId)))
    throw new ApiError(400, 'Escolha apenas serviços das suas áreas de atuação.');
  if (input.customServices.some(item => !input.specialties.includes(item.category)))
    throw new ApiError(400, 'Escolha uma das suas áreas para cada serviço personalizado.');
  const normalizedName = (name: string) => name.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const customNames = input.customServices.map(item => `${item.category}:${normalizedName(item.name)}`);
  if (new Set(customNames).size !== customNames.length ||
    input.customServices.some(item => catalog.some(template =>
      template.category === item.category && normalizedName(template.name) === normalizedName(item.name))))
    throw new ApiError(400, 'Cada serviço personalizado precisa ter um nome diferente dos serviços da área.');
  if (!selectedTemplates.size && !input.customServices.length)
    throw new ApiError(400, 'Escolha pelo menos um serviço que você oferece.');
  if (db.prepare('SELECT 1 FROM businesses WHERE slug=?').get(input.slug)) throw new ApiError(409, 'Este link de agendamento já está em uso.');
  if (db.prepare(`SELECT 1 FROM users WHERE role='owner' AND email=?`).get(input.email)) throw new ApiError(409, 'Este e-mail já está cadastrado.');
  const hash = await bcrypt.hash(input.password, 12);
  const businessId = id(), userId = id();
  db.transaction(() => {
    db.prepare('INSERT INTO businesses(id,slug,name,phone,specialties) VALUES(?,?,?,?,?)')
      .run(businessId, input.slug, input.businessName, input.phone || null, JSON.stringify([...new Set(input.specialties)]));
    db.prepare(`INSERT INTO users(id,business_id,role,name,email,phone,password_hash)
      VALUES(?,?,'owner',?,?,?,?)`).run(userId, businessId, input.ownerName, input.email, input.phone || null, hash);
    const addService = db.prepare(`INSERT INTO services(id,business_id,name,category,duration_minutes,price_cents,active)
      VALUES(?,?,?,?,?,?,?)`);
    for (const item of catalog.filter(item => input.specialties.includes(item.category)))
      addService.run(id(), businessId, item.name, item.category, item.durationMinutes,
        toCents(item.price), Number(selectedTemplates.has(item.id)));
    for (const item of input.customServices)
      addService.run(id(), businessId, item.name, item.category, item.durationMinutes,
        toCents(item.price), 1);
  })();
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId) as User;
  const session = createSession(req, res, user, input.remember);
  res.status(201).json({ user: userDto(user), business: businessById(businessId), ...session });
});

app.post('/api/auth/login', rateLimit(15), async (req, res) => {
  const input = z.object({ email: email.optional(), identifier: z.string().optional(), password: z.string(),
    remember: z.boolean().default(false) }).parse(req.body);
  const address = (input.email || input.identifier || '').trim().toLowerCase();
  const user = db.prepare(`SELECT * FROM users WHERE role='owner' AND email=?`).get(address) as User | undefined;
  if (!user || !await bcrypt.compare(input.password, user.password_hash)) throw new ApiError(401, 'E-mail ou senha inválidos.');
  const session = createSession(req, res, user, input.remember);
  res.json({ user: userDto(user), business: businessById(user.business_id), ...session });
});
app.get('/api/auth/me', authenticatedOwner, (_req, res) => {
  const user = currentUser(res);
  res.json({ user: userDto(user), business: businessById(user.business_id) });
});
app.post('/api/auth/logout', (req, res) => {
  revokeSession(req, 'owner');
  res.clearCookie(cookieName('owner'), { path: '/' });
  res.status(204).end();
});
app.delete('/api/auth/account', authenticatedOwner, rateLimit(10), async (req, res) => {
  const { password: suppliedPassword } = z.object({ password: z.string().min(1).max(100) }).parse(req.body);
  const user = currentUser(res);
  if (!await bcrypt.compare(suppliedPassword, user.password_hash))
    throw new ApiError(401, 'Senha incorreta.');
  db.transaction(() => {
    if (getSessionUser(req, 'owner')?.id !== user.id)
      throw new ApiError(401, 'Sessão expirada. Faça login novamente.');
    const businessId = user.business_id;
    db.prepare('DELETE FROM notification_outbox WHERE business_id=?').run(businessId);
    db.prepare('DELETE FROM financial_entries WHERE business_id=?').run(businessId);
    db.prepare('DELETE FROM appointments WHERE business_id=?').run(businessId);
    db.prepare('DELETE FROM businesses WHERE id=?').run(businessId);
  }).immediate();
  res.clearCookie(cookieName('owner'), { path: '/' });
  res.status(204).end();
});

app.get('/api/business', owner, (_req, res) => res.json(businessById(currentUser(res).business_id)));
app.post('/api/business/logo', authenticatedOwner, rateLimit(10), parseLogo, uploadBusinessLogo);
app.delete('/api/business/logo', authenticatedOwner, deleteBusinessLogo);
app.get('/api/public/:slug/logo', publicBusinessLogo);
app.patch('/api/business', owner, (req, res) => {
  const input = z.object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    phone: z.string().trim().max(25).optional(),
    address: z.string().trim().max(250).optional(),
    specialties: z.array(specialty).min(1).max(specialtyValues.length).optional(),
    startTime: time.optional(), endTime: time.optional(),
    workdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    slotInterval: z.number().int().min(15).max(120).optional(),
  }).parse(req.body);
  const previous = businessById(currentUser(res).business_id);
  const startTime = input.startTime ?? previous.startTime;
  const endTime = input.endTime ?? previous.endTime;
  if (startTime >= endTime) throw new ApiError(400, 'O horário final deve ser posterior ao inicial.');
  const selected = [...new Set(input.specialties ?? previous.specialties)] as string[];
  db.transaction(() => {
    db.prepare(`UPDATE businesses SET name=?,description=?,phone=?,address=?,specialties=?,start_time=?,end_time=?,workdays=?,slot_interval=? WHERE id=?`)
      .run(input.name ?? previous.name, input.description ?? previous.description,
        input.phone ?? previous.phone, input.address ?? previous.address,
        JSON.stringify(selected), startTime, endTime,
        JSON.stringify(input.workdays ?? previous.workdays), input.slotInterval ?? previous.slotInterval,
        currentUser(res).business_id);
    db.prepare(`UPDATE services SET active=0 WHERE business_id=? AND category NOT IN (${selected.map(() => '?').join(',')})`)
      .run(currentUser(res).business_id, ...selected);
    const addService = db.prepare(`INSERT INTO services(id,business_id,name,category,duration_minutes,price_cents,active)
      VALUES(?,?,?,?,?,?,?)`);
    for (const category of selected.filter(value => !previous.specialties.includes(value))) {
      const exists = db.prepare('SELECT 1 FROM services WHERE business_id=? AND category=? LIMIT 1')
        .get(currentUser(res).business_id, category);
      if (!exists) for (const item of catalog.filter(item => item.category === category))
        addService.run(id(), currentUser(res).business_id, item.name, item.category,
          item.durationMinutes, toCents(item.price), 0);
    }
  }).immediate();
  res.json(businessById(currentUser(res).business_id));
});

app.get('/api/services', owner, (_req, res) => {
  const rows = db.prepare('SELECT * FROM services WHERE business_id=? ORDER BY category,name')
    .all(currentUser(res).business_id) as Row[];
  res.json(rows.map(serviceDto));
});
const serviceInput = z.object({
  name: z.string().trim().min(2).max(100), description: z.string().trim().max(500).default(''),
  category: specialty,
  durationMinutes: z.number().int().min(15).max(480), price: money,
  active: z.boolean().default(true),
});
app.post('/api/services', owner, (req, res) => {
  const input = serviceInput.parse(req.body);
  if (!businessById(currentUser(res).business_id).specialties.includes(input.category))
    throw new ApiError(400, 'Escolha uma área de atuação do seu espaço para este serviço.');
  const serviceId = id();
  db.prepare(`INSERT INTO services(id,business_id,name,description,category,duration_minutes,price_cents,active)
    VALUES(?,?,?,?,?,?,?,?)`).run(serviceId, currentUser(res).business_id, input.name, input.description,
    input.category, input.durationMinutes, toCents(input.price), Number(input.active));
  res.status(201).json(serviceDto(db.prepare('SELECT * FROM services WHERE id=?').get(serviceId) as Row));
});
app.patch('/api/services/:id', owner, (req, res) => {
  const previous = db.prepare('SELECT * FROM services WHERE id=? AND business_id=?')
    .get(req.params.id, currentUser(res).business_id) as Row | undefined;
  if (!previous) throw new ApiError(404, 'Serviço não encontrado.');
  const input = serviceInput.partial().parse(req.body);
  if (!businessById(currentUser(res).business_id).specialties.includes(input.category ?? previous.category))
    throw new ApiError(400, 'Esta área não está ativa no seu espaço.');
  db.prepare(`UPDATE services SET name=?,description=?,category=?,duration_minutes=?,price_cents=?,active=?
    WHERE id=? AND business_id=?`).run(input.name ?? previous.name, input.description ?? previous.description,
      input.category ?? previous.category, input.durationMinutes ?? previous.duration_minutes,
      input.price === undefined ? previous.price_cents : toCents(input.price),
      input.active === undefined ? previous.active : Number(input.active), previous.id, currentUser(res).business_id);
  res.json(serviceDto(db.prepare('SELECT * FROM services WHERE id=?').get(previous.id) as Row));
});
app.delete('/api/services/:id', owner, (req, res) => {
  const result = db.prepare('UPDATE services SET active=0 WHERE id=? AND business_id=?')
    .run(req.params.id, currentUser(res).business_id);
  if (!result.changes) throw new ApiError(404, 'Serviço não encontrado.');
  res.status(204).end();
});

app.get('/api/clients', owner, (req, res) => {
  const search = String(req.query.search || '').trim();
  const rows = db.prepare(`SELECT u.id,u.name,u.email,u.phone,u.cpf,u.notes,u.tags,u.whatsapp_opt_in,u.created_at,
    COUNT(CASE WHEN a.status='completed' THEN 1 END) AS visits,
    COALESCE(SUM(CASE WHEN a.status='completed' THEN a.price_cents ELSE 0 END),0) AS spent_cents,
    MAX(CASE WHEN a.status='completed' THEN a.date END) AS last_visit
    FROM users u LEFT JOIN appointments a ON a.client_id=u.id
    WHERE u.business_id=? AND u.role='client' AND (u.name LIKE ? OR u.phone LIKE ? OR u.email LIKE ?)
    GROUP BY u.id ORDER BY u.name`)
    .all(currentUser(res).business_id, `%${search}%`, `%${search}%`, `%${search}%`) as Row[];
  res.json(rows.map(row => ({ id: row.id, name: row.name, email: row.email || '',
    phone: row.phone || '', cpf: row.cpf || '', whatsappOptIn: Boolean(row.whatsapp_opt_in),
    notes: row.notes || '', tags: JSON.parse(row.tags || '[]'), visits: row.visits,
    spent: fromCents(row.spent_cents), totalSpent: fromCents(row.spent_cents), lastVisit: row.last_visit,
    createdAt: row.created_at })));
});
const crmClientInput = z.object({
  name: z.string().trim().min(2).max(100),
  cpf: z.string().refine(validCpf, 'CPF inválido.').transform(normalizeCpf),
  phone: z.string().transform(value => value.replace(/\D/g, '')).refine(value => /^\d{10,13}$/.test(value)),
  email: optionalEmail, password: password.optional(),
  notes: z.string().trim().max(2000).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
});
app.post('/api/clients', owner, rateLimit(30), async (req, res) => {
  const input = crmClientInput.parse(req.body);
  const businessId = currentUser(res).business_id;
  const exists = db.prepare(`SELECT 1 FROM users WHERE business_id=? AND role='client'
    AND (cpf=? OR phone=? OR (email IS NOT NULL AND email=?))`)
    .get(businessId, input.cpf, input.phone, input.email || '') as Row | undefined;
  if (exists) throw new ApiError(409, 'Cliente já cadastrada neste espaço.');
  const temporaryPassword = input.password ? undefined : randomBytes(12).toString('base64url');
  const hash = await bcrypt.hash(input.password || temporaryPassword!, 12);
  const clientId = id();
  db.prepare(`INSERT INTO users(id,business_id,role,name,email,phone,cpf,notes,tags,password_hash)
    VALUES(?,?,'client',?,?,?,?,?,?,?)`).run(clientId, businessId, input.name,
      input.email || null, input.phone, input.cpf, input.notes || '', JSON.stringify(input.tags || []), hash);
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(clientId) as Row;
  res.status(201).json({ ...userDto(row), notes: row.notes, tags: JSON.parse(row.tags), temporaryPassword });
});
app.patch('/api/clients/:id', owner, (req, res) => {
  const businessId = currentUser(res).business_id;
  const row = db.prepare(`SELECT * FROM users WHERE id=? AND business_id=? AND role='client'`)
    .get(req.params.id, businessId) as Row | undefined;
  if (!row) throw new ApiError(404, 'Cliente não encontrada.');
  const input = crmClientInput.pick({ name: true, phone: true, email: true, notes: true, tags: true })
    .partial().parse(req.body);
  db.prepare(`UPDATE users SET name=?,phone=?,email=?,notes=?,tags=? WHERE id=? AND business_id=?`)
    .run(input.name ?? row.name, input.phone ?? row.phone, input.email ?? row.email,
      input.notes ?? row.notes, JSON.stringify(input.tags ?? JSON.parse(row.tags)), row.id, businessId);
  const updated = db.prepare('SELECT * FROM users WHERE id=?').get(row.id) as Row;
  res.json({ ...userDto(updated), notes: updated.notes, tags: JSON.parse(updated.tags) });
});
app.get('/api/clients/:id', owner, (req, res) => {
  const businessId = currentUser(res).business_id;
  const row = db.prepare(`SELECT * FROM users WHERE id=? AND business_id=? AND role='client'`)
    .get(req.params.id, businessId) as Row | undefined;
  if (!row) throw new ApiError(404, 'Cliente não encontrada.');
  const appointments = db.prepare(`${appointmentSelect} WHERE a.business_id=? AND a.client_id=?
    ORDER BY a.date DESC,a.start_time DESC LIMIT 100`).all(businessId, row.id) as Row[];
  const completed = appointments.filter(item => item.status === 'completed');
  res.json({ ...userDto(row), notes: row.notes, tags: JSON.parse(row.tags),
    visits: completed.length, spent: fromCents(completed.reduce((sum, item) => sum + item.price_cents, 0)),
    lastVisit: completed[0]?.date || null, appointments: appointments.map(appointmentDto) });
});

const appointmentSelect = `SELECT a.*,u.name AS client_name,u.phone AS client_phone,s.name AS service_name
  FROM appointments a JOIN users u ON u.id=a.client_id JOIN services s ON s.id=a.service_id`;
app.get('/api/appointments', owner, (req, res) => {
  const from = req.query.from ? date.parse(req.query.from) : dateAgo(90);
  const to = req.query.to ? date.parse(req.query.to) : (() => {
    const d = new Date(`${localNow().date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 90);
    return d.toISOString().slice(0, 10);
  })();
  if (from > to) throw new ApiError(400, 'Período inválido.');
  const rows = db.prepare(`${appointmentSelect} WHERE a.business_id=? AND a.date BETWEEN ? AND ?
    ORDER BY a.date DESC,a.start_time DESC LIMIT 500`).all(currentUser(res).business_id, from, to) as Row[];
  res.json(rows.map(appointmentDto));
});

app.get('/api/appointments/today', owner, (_req, res) => {
  const day = localNow().date;
  const rows = db.prepare(`${appointmentSelect} WHERE a.business_id=? AND a.date=?
    ORDER BY a.start_time ASC,a.created_at ASC`).all(currentUser(res).business_id, day) as Row[];
  res.json({ date: day, appointments: rows.map(appointmentDto) });
});

const appointmentStatus = z.enum(['pending', 'confirmed', 'completed', 'cancelled', 'no_show']);
app.patch('/api/appointments/:id', owner, async (req, res) => {
  const { status } = z.object({ status: appointmentStatus }).parse(req.body);
  if (status === 'cancelled')
    return cancelAppointment(req, res, 'owner', 'owner_cancelled');
  const user = currentUser(res);
  const existing = getAppointment(user.business_id, String(req.params.id));
  if (!existing) throw new ApiError(404, 'Agendamento não encontrado.');
  if (existing.status === 'completed' && status !== 'completed')
    throw new ApiError(409, 'Um atendimento concluído não pode voltar para outro estado.');
  db.transaction(() => {
    if (['pending', 'confirmed', 'completed'].includes(status) &&
      ['cancelled', 'no_show'].includes(existing.status)) {
      const conflict = db.prepare(`SELECT 1 FROM appointments WHERE business_id=? AND date=? AND id<>?
        AND status IN ('pending','confirmed','completed') AND start_time<? AND end_time>? LIMIT 1`)
        .get(user.business_id, existing.date, existing.id, existing.end_time, existing.start_time);
      if (conflict) throw new ApiError(409, 'O horário foi ocupado por outro agendamento.');
    }
    db.prepare('UPDATE appointments SET status=?,completed_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=?')
      .run(status, status === 'completed' ? new Date().toISOString() : null, existing.id, user.business_id);
    if (status === 'completed') {
      const prepaidCents = (db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS total
        FROM financial_entries WHERE business_id=? AND prepaid_appointment_id=? AND type='income'`)
        .get(user.business_id, existing.id) as { total: number }).total;
      const remainingCents = Math.max(0, existing.price_cents - prepaidCents);
      if (remainingCents) db.prepare(`INSERT OR IGNORE INTO financial_entries
        (id,business_id,appointment_id,type,description,category,amount_cents,date)
        VALUES(?,?,?,'income',?,'Atendimento',?,?)`)
        .run(id(), user.business_id, existing.id, `${existing.service_name} — ${existing.client_name}`,
          remainingCents, existing.date);
    }
  }).immediate();
  res.json(appointmentDto(getAppointment(user.business_id, existing.id)!));
});

function publicBusiness(slugValue: string): Row {
  const row = db.prepare('SELECT * FROM businesses WHERE slug=?').get(slugValue) as Row | undefined;
  if (!row) throw new ApiError(404, 'Página de agendamento não encontrada.');
  return row;
}
function bookingIsAllowed(business: Row, service: Row, day: string, startTime: string,
  excludeAppointmentId = '') {
  const now = localNow();
  if (day < now.date || (day === now.date && startTime <= now.time))
    throw new ApiError(400, 'Escolha um horário futuro.');
  const futureLimit = new Date(`${now.date}T12:00:00Z`);
  futureLimit.setUTCDate(futureLimit.getUTCDate() + 180);
  if (day > futureLimit.toISOString().slice(0, 10)) throw new ApiError(400, 'Agendamentos disponíveis até 180 dias.');
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const workdays = JSON.parse(business.workdays) as number[];
  const endTime = addMinutes(startTime, service.duration_minutes);
  const startMinutes = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3));
  const openMinutes = Number(business.start_time.slice(0, 2)) * 60 + Number(business.start_time.slice(3));
  if (!workdays.includes(weekday) || startTime < business.start_time || !endTime || endTime > business.end_time ||
    (startMinutes - openMinutes) % business.slot_interval !== 0)
    throw new ApiError(409, 'Este horário não está disponível.');
  const clash = db.prepare(`SELECT 1 FROM appointments WHERE business_id=? AND date=? AND id<>?
    AND status IN ('pending','confirmed','completed') AND start_time<? AND end_time>? LIMIT 1`)
    .get(business.id, day, excludeAppointmentId, endTime, startTime);
  if (clash) throw new ApiError(409, 'Este horário acabou de ser reservado. Escolha outro.');
  return endTime;
}
function availability(business: Row, service: Row, day: string, excludeAppointmentId = '') {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const workdays = JSON.parse(business.workdays) as number[];
  if (!workdays.includes(weekday)) return [];
  const slots: string[] = [];
  for (let slot = business.start_time as string; slot < business.end_time; slot = addMinutes(slot, business.slot_interval) || '24:00') {
    const end = addMinutes(slot, service.duration_minutes);
    if (!end || end > business.end_time) break;
    try { bookingIsAllowed(business, service, day, slot, excludeAppointmentId); slots.push(slot); }
    catch (error) { if (!(error instanceof ApiError)) throw error; }
  }
  return slots;
}
function availableSlotsThisMonth(businessId: string, serviceId: string, monthDate: string,
  omit?: { date: string; time: string }) {
  const business = db.prepare('SELECT * FROM businesses WHERE id=?').get(businessId) as Row;
  const service = db.prepare('SELECT * FROM services WHERE business_id=? AND id=? AND active=1')
    .get(businessId, serviceId) as Row | undefined;
  if (!service) return [];
  const [year, month] = monthDate.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const suggestions: { date: string; time: string }[] = [];
  for (let day = 1; day <= lastDay && suggestions.length < 8; day++) {
    const dateValue = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const slot = availability(business, service, dateValue)
      .find(candidate => omit?.date !== dateValue || omit.time !== candidate);
    if (slot) suggestions.push({ date: dateValue, time: slot });
  }
  return suggestions;
}
function serviceForBusiness(businessId: string, serviceId: string) {
  const service = db.prepare('SELECT * FROM services WHERE id=? AND business_id=? AND active=1')
    .get(serviceId, businessId) as Row | undefined;
  if (!service) throw new ApiError(404, 'Serviço não encontrado.');
  const business = businessById(businessId);
  if (!business.specialties.includes(service.category))
    throw new ApiError(404, 'Serviço não disponível neste espaço.');
  return service;
}

app.get('/api/public/:slug', (req, res) => {
  const business = publicBusiness(String(req.params.slug));
  const services = db.prepare('SELECT * FROM services WHERE business_id=? AND active=1 ORDER BY category,name')
    .all(business.id) as Row[];
  const allowed = JSON.parse(business.specialties) as string[];
  res.json({ business: businessDto(business), services: services.filter(item => allowed.includes(item.category)).map(serviceDto) });
});
app.get('/api/public/:slug/availability', (req, res) => {
  const business = publicBusiness(String(req.params.slug));
  if (!billingAccessForBusiness(business.id)) return res.json({ slots: [] });
  const input = z.object({ serviceId: z.uuid(), date,
    excludeAppointmentId: z.uuid().optional() }).parse(req.query);
  if (input.excludeAppointmentId) {
    const user = clientForRequest(req, res);
    const row = getAppointment(business.id, input.excludeAppointmentId);
    if (!row || row.client_id !== user.id || user.business_id !== business.id)
      throw new ApiError(403, 'Agendamento não pertence a esta cliente.');
  }
  const service = serviceForBusiness(business.id, input.serviceId);
  res.json({ slots: availability(business, service, input.date, input.excludeAppointmentId) });
});

const clientDetails = z.object({
  name: z.string().trim().min(2).max(100),
  cpf: z.string().refine(validCpf, 'CPF inválido.'),
  phone: z.string().transform(value => value.replace(/\D/g, '')).refine(value => /^\d{10,13}$/.test(value), 'Telefone inválido.'),
  email: optionalEmail, password: z.string().max(100).optional(),
  whatsappOptIn: z.boolean().default(false),
});
const bookingInput = z.object({ serviceId: z.uuid(), date, time,
  remember: z.boolean().default(false), client: clientDetails.optional() });
app.post('/api/public/:slug/bookings', rateLimit(20), async (req, res) => {
  const business = publicBusiness(String(req.params.slug));
  if (!billingAccessForBusiness(business.id))
    throw new ApiError(503, 'Este espaço está temporariamente indisponível para novos agendamentos.');
  const input = bookingInput.parse(req.body);
  const service = serviceForBusiness(business.id, input.serviceId);
  let bookingClient = getSessionUser(req, 'client');
  if (bookingClient?.business_id !== business.id) bookingClient = undefined;
  let newClient: { name: string; cpf: string; phone: string; email: string | null;
    hash: string; whatsappOptIn: boolean } | undefined;
  if (!bookingClient) {
    if (!input.client) throw new ApiError(401, 'Faça login ou informe seus dados para agendar.');
    const cpf = normalizeCpf(input.client.cpf);
    const existing = db.prepare(`SELECT * FROM users WHERE business_id=? AND role='client' AND cpf=?`)
      .get(business.id, cpf) as User | undefined;
    if (existing) {
      if (!input.client.password || !await bcrypt.compare(input.client.password, existing.password_hash))
        throw new ApiError(401, 'Cliente já cadastrado. Informe a senha para agendar.');
      bookingClient = existing;
    } else {
      if (!input.client.password || !password.safeParse(input.client.password).success)
        throw new ApiError(400, 'Crie uma senha com 12 ou mais caracteres, letras e números.');
      newClient = { name: input.client.name, cpf, phone: input.client.phone,
        email: input.client.email || null, hash: await bcrypt.hash(input.client.password, 12),
        whatsappOptIn: input.client.whatsappOptIn };
    }
  }
  const appointmentId = id();
  const result = db.transaction(() => {
    const end = bookingIsAllowed(business, service, input.date, input.time);
    let user = bookingClient;
    if (user && input.client) {
      if (normalizeCpf(input.client.cpf) !== user.cpf)
        throw new ApiError(400, 'O CPF informado não corresponde à conta conectada.');
      db.prepare(`UPDATE users SET phone=?,email=?,whatsapp_opt_in=?,whatsapp_opt_in_at=?
        WHERE id=? AND business_id=? AND role='client'`)
        .run(input.client.phone, input.client.email || null, Number(input.client.whatsappOptIn),
          input.client.whatsappOptIn ? new Date().toISOString() : null, user.id, business.id);
      user = db.prepare('SELECT * FROM users WHERE id=? AND business_id=?').get(user.id, business.id) as User;
    }
    if (!user && newClient) {
      const clientId = id();
      db.prepare(`INSERT INTO users(id,business_id,role,name,email,phone,cpf,password_hash,
        whatsapp_opt_in,whatsapp_opt_in_at) VALUES(?,?,'client',?,?,?,?,?,?,?)`)
        .run(clientId, business.id, newClient.name, newClient.email, newClient.phone,
          newClient.cpf, newClient.hash, Number(newClient.whatsappOptIn),
          newClient.whatsappOptIn ? new Date().toISOString() : null);
      user = db.prepare('SELECT * FROM users WHERE id=?').get(clientId) as User;
    }
    if (!user) throw new ApiError(401, 'Cliente não identificado.');
    const bookingConsent = Boolean(input.client?.whatsappOptIn && user.whatsapp_opt_in);
    db.prepare(`INSERT INTO appointments(id,business_id,client_id,service_id,date,start_time,end_time,status,
      price_cents,whatsapp_opt_in) VALUES(?,?,?,?,?,?,?,'confirmed',?,?)`)
      .run(appointmentId, business.id, user.id, service.id, input.date, input.time,
        end, service.price_cents, Number(bookingConsent));
    notifyOwnerOfBooking({ businessId: business.id, appointmentId,
      clientName: user.name, serviceName: service.name, date: input.date, time: input.time });
    return user;
  }).immediate();
  const session = createSession(req, res, result, input.remember);
  const notificationStatus = await sendBookingConfirmation({
    businessId: business.id, appointmentId, recipient: result.phone,
    clientName: result.name, serviceName: service.name, date: input.date, time: input.time,
  });
  res.status(201).json({ appointment: appointmentDto(getAppointment(business.id, appointmentId)!),
    notificationStatus, ...session });
});

app.post('/api/appointments', owner, async (req, res) => {
  const input = z.object({ clientId: z.uuid(), serviceId: z.uuid(), date, time,
    notes: z.string().max(500).optional(), whatsappOptIn: z.boolean().optional() }).parse(req.body);
  const businessId = currentUser(res).business_id;
  const business = db.prepare('SELECT * FROM businesses WHERE id=?').get(businessId) as Row;
  const service = serviceForBusiness(businessId, input.serviceId);
  const customer = db.prepare(`SELECT * FROM users WHERE id=? AND business_id=? AND role='client'`)
    .get(input.clientId, businessId) as User | undefined;
  if (!customer) throw new ApiError(404, 'Cliente não encontrada.');
  const appointmentId = id();
  db.transaction(() => {
    const end = bookingIsAllowed(business, service, input.date, input.time);
    db.prepare(`INSERT INTO appointments(id,business_id,client_id,service_id,date,start_time,end_time,status,
      notes,price_cents,whatsapp_opt_in) VALUES(?,?,?,?,?,?,?,'confirmed',?,?,?)`)
      .run(appointmentId, businessId, customer.id, service.id, input.date, input.time,
        end, input.notes || '', service.price_cents,
        Number(Boolean(customer.whatsapp_opt_in) && input.whatsappOptIn !== false));
  }).immediate();
  const notificationStatus = await sendBookingConfirmation({ businessId, appointmentId, recipient: customer.phone,
    clientName: customer.name, serviceName: service.name, date: input.date, time: input.time });
  res.status(201).json({ ...appointmentDto(getAppointment(businessId, appointmentId)!), notificationStatus });
});

async function loginClient(req: Request, res: Response) {
  const input = z.object({ slug: slug.optional(), identifier: z.string().optional(), email: z.string().optional(),
    password: z.string(), remember: z.boolean().default(false) }).parse(req.body);
  const slugValue = req.params.slug ? String(req.params.slug) : input.slug;
  if (!slugValue) throw new ApiError(400, 'Informe o link da profissional.');
  const business = publicBusiness(slugValue);
  const identifier = (input.identifier || input.email || '').trim();
  const digits = identifier.replace(/\D/g, '');
  const user = db.prepare(`SELECT * FROM users WHERE business_id=? AND role='client'
    AND (email=? OR cpf=? OR phone=?)`).get(business.id, identifier.toLowerCase(), digits, digits) as User | undefined;
  if (!user || !await bcrypt.compare(input.password, user.password_hash))
    throw new ApiError(401, 'Dados de acesso inválidos.');
  const session = createSession(req, res, user, input.remember);
  res.json({ client: userDto(user), user: userDto(user), business: businessDto(business), ...session });
}
app.post('/api/client/login', rateLimit(15), loginClient);
app.post('/api/public/:slug/login', rateLimit(15), loginClient);
function clientForRequest(req: Request, _res: Response) {
  const user = getSessionUser(req, 'client');
  if (!user) throw new ApiError(401, 'Faça login para continuar.');
  const slugValue = req.params.slug;
  if (slugValue && publicBusiness(String(slugValue)).id !== user.business_id)
    throw new ApiError(403, 'Conta não pertence a esta profissional.');
  return user;
}
function clientMe(req: Request, res: Response) {
  const user = clientForRequest(req, res);
  res.json({ client: userDto(user), user: userDto(user), business: businessById(user.business_id) });
}
function clientAppointments(req: Request, res: Response) {
  const user = clientForRequest(req, res);
  const rows = db.prepare(`${appointmentSelect} WHERE a.business_id=? AND a.client_id=?
    ORDER BY a.date DESC,a.start_time DESC LIMIT 100`).all(user.business_id, user.id) as Row[];
  res.json(rows.map(appointmentDto));
}
function clientLogout(req: Request, res: Response) {
  revokeSession(req, 'client');
  res.clearCookie(cookieName('client'), { path: '/' });
  res.status(204).end();
}
app.get('/api/client/me', clientMe);
app.get('/api/client/appointments', clientAppointments);
app.post('/api/client/logout', clientLogout);
app.get('/api/public/:slug/me', clientMe);
app.get('/api/public/:slug/appointments', clientAppointments);
app.post('/api/public/:slug/logout', clientLogout);
app.delete('/api/client/account', rateLimit(10), async (req, res) => {
  const user = clientForRequest(req, res);
  const { password: suppliedPassword } = z.object({ password: z.string().min(1).max(100) }).parse(req.body);
  if (!await bcrypt.compare(suppliedPassword, user.password_hash))
    throw new ApiError(401, 'Senha incorreta.');
  db.transaction(() => {
    if (getSessionUser(req, 'client')?.id !== user.id)
      throw new ApiError(401, 'Sessão expirada. Faça login novamente.');
    db.prepare(`DELETE FROM notification_outbox WHERE business_id=? AND appointment_id IN
      (SELECT id FROM appointments WHERE business_id=? AND client_id=?)`)
      .run(user.business_id, user.business_id, user.id);
    db.prepare(`DELETE FROM financial_entries WHERE business_id=? AND appointment_id IN
      (SELECT id FROM appointments WHERE business_id=? AND client_id=?)`)
      .run(user.business_id, user.business_id, user.id);
    db.prepare('DELETE FROM appointments WHERE business_id=? AND client_id=?')
      .run(user.business_id, user.id);
    db.prepare("DELETE FROM users WHERE business_id=? AND id=? AND role='client'")
      .run(user.business_id, user.id);
  }).immediate();
  res.clearCookie(cookieName('client'), { path: '/' });
  res.status(204).end();
});
function updateClientPreferences(req: Request, res: Response) {
  const user = clientForRequest(req, res);
  const { whatsappOptIn } = z.object({ whatsappOptIn: z.boolean() }).parse(req.body);
  db.prepare(`UPDATE users SET whatsapp_opt_in=?,whatsapp_opt_in_at=?
    WHERE id=? AND business_id=? AND role='client'`)
    .run(Number(whatsappOptIn), whatsappOptIn ? new Date().toISOString() : null,
      user.id, user.business_id);
  const updated = db.prepare('SELECT * FROM users WHERE id=? AND business_id=?')
    .get(user.id, user.business_id) as User;
  res.json({ client: userDto(updated) });
}
app.patch('/api/client/preferences', updateClientPreferences);
app.patch('/api/public/:slug/preferences', updateClientPreferences);

type ChangeActor = 'client' | 'owner';
type ChangeKind = 'client_rescheduled' | 'client_cancelled' | 'owner_rescheduled' |
  'owner_reschedule_request' | 'owner_cancelled';
const changeReason = z.string().trim().max(500).optional();
function mutableAppointment(businessId: string, appointmentId: string, clientId?: string) {
  const row = getAppointment(businessId, appointmentId);
  if (!row || clientId && row.client_id !== clientId)
    throw new ApiError(404, 'Agendamento não encontrado.');
  if (!['pending', 'confirmed'].includes(row.status))
    throw new ApiError(409, 'Este agendamento não pode ser alterado.');
  const now = localNow();
  if (row.date < now.date || (row.date === now.date && row.start_time <= now.time))
    throw new ApiError(409, 'Este atendimento já começou. Entre em contato com a profissional.');
  return row;
}
const expectedAppointmentInput = z.object({ expectedDate: date.optional(),
  expectedTime: time.optional(), expectedServiceId: z.uuid().optional() });
function assertExpectedAppointment(row: Row, input: z.infer<typeof expectedAppointmentInput>) {
  if (input.expectedDate !== undefined && input.expectedDate !== row.date ||
    input.expectedTime !== undefined && input.expectedTime !== row.start_time ||
    input.expectedServiceId !== undefined && input.expectedServiceId !== row.service_id)
    throw new ApiError(409, 'O agendamento mudou. Atualize a agenda antes de continuar.');
}
function recordAppointmentEvent(actor: ChangeActor, kind: ChangeKind, previous: Row,
  next: Row, reason?: string) {
  const eventId = id();
  db.prepare(`INSERT INTO appointment_events
    (id,business_id,appointment_id,actor,kind,reason,previous_service_id,previous_date,previous_time,
      new_service_id,new_date,new_time) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(eventId, previous.business_id, previous.id, actor,
      kind === 'owner_reschedule_request' ? 'reschedule_requested' :
        kind.endsWith('cancelled') ? 'cancelled' : 'rescheduled',
      reason || null, previous.service_id, previous.date, previous.start_time,
      next.status === 'cancelled' ? null : next.service_id,
      next.status === 'cancelled' ? null : next.date,
      next.status === 'cancelled' ? null : next.start_time);
  return eventId;
}
async function notifyAppointmentChange(kind: ChangeKind, previous: Row, next: Row,
  reason?: string) {
  const availableSlots = availableSlotsThisMonth(next.business_id, next.service_id, next.date,
    { date: previous.date, time: previous.start_time });
  return sendBookingChangeNotification({
    businessId: next.business_id, appointmentId: next.id, recipient: next.client_phone,
    clientName: next.client_name, kind, serviceName: next.service_name, date: next.date,
    time: next.start_time, previousServiceName: previous.service_name,
    previousDate: previous.date, previousTime: previous.start_time,
    reason, availableSlots,
  });
}
const rescheduleInput = expectedAppointmentInput.extend({ serviceId: z.uuid().optional(),
  date: date.optional(), time: time.optional(), reason: changeReason });
async function rescheduleAppointment(req: Request, res: Response, actor: ChangeActor) {
  const input = rescheduleInput.parse(req.body);
  const user = actor === 'client' ? clientForRequest(req, res) : currentUser(res);
  const businessId = user.business_id;
  const changed = db.transaction(() => {
    const before = mutableAppointment(businessId, String(req.params.id),
      actor === 'client' ? user.id : undefined);
    if (actor === 'owner') assertExpectedAppointment(before, input);
    const serviceId = input.serviceId ?? before.service_id;
    const day = input.date ?? before.date;
    const startTime = input.time ?? before.start_time;
    if (serviceId === before.service_id && day === before.date && startTime === before.start_time)
      throw new ApiError(400, 'Escolha um serviço, dia ou horário diferente.');
    const business = db.prepare('SELECT * FROM businesses WHERE id=?').get(businessId) as Row;
    const service = serviceForBusiness(businessId, serviceId);
    const endTime = bookingIsAllowed(business, service, day, startTime, before.id);
    db.prepare(`UPDATE appointments SET service_id=?,date=?,start_time=?,end_time=?,price_cents=?,
      updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=?`)
      .run(service.id, day, startTime, endTime, service.price_cents, before.id, businessId);
    const after = getAppointment(businessId, before.id)!;
    const eventId = recordAppointmentEvent(actor,
      actor === 'client' ? 'client_rescheduled' : 'owner_rescheduled',
      before, after, input.reason);
    notifyOfBookingChange({ businessId, appointmentId: before.id, clientId: before.client_id,
      actor, eventId, cancelled: false, clientName: before.client_name,
      serviceName: after.service_name, date: after.date, time: after.start_time });
    return { before, after, eventId };
  }).immediate();
  const notificationStatus = await notifyAppointmentChange(
    actor === 'client' ? 'client_rescheduled' : 'owner_rescheduled',
    changed.before, changed.after, input.reason);
  res.json({ ...appointmentDto(changed.after), notificationStatus, eventId: changed.eventId });
}
async function cancelAppointment(req: Request, res: Response,
  actor: ChangeActor, kind: ChangeKind) {
  const input = expectedAppointmentInput.extend({ reason: changeReason }).parse(req.body ?? {});
  const { reason } = input;
  const user = actor === 'client' ? clientForRequest(req, res) : currentUser(res);
  const changed = db.transaction(() => {
    const before = mutableAppointment(user.business_id, String(req.params.id),
      actor === 'client' ? user.id : undefined);
    if (actor === 'owner') assertExpectedAppointment(before, input);
    db.prepare(`UPDATE appointments SET status='cancelled',updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND business_id=?`).run(before.id, user.business_id);
    const after = getAppointment(user.business_id, before.id)!;
    const eventId = recordAppointmentEvent(actor, kind, before, after, reason);
    notifyOfBookingChange({ businessId: user.business_id, appointmentId: before.id,
      clientId: before.client_id, actor, eventId, cancelled: true,
      clientName: before.client_name, serviceName: before.service_name,
      date: before.date, time: before.start_time });
    return { before, after, eventId };
  }).immediate();
  const notificationStatus = await notifyAppointmentChange(kind, changed.before, changed.after, reason);
  res.json({ ...appointmentDto(changed.after), notificationStatus, eventId: changed.eventId });
}
async function cancelClientAppointment(req: Request, res: Response) {
  return cancelAppointment(req, res, 'client', 'client_cancelled');
}
app.patch('/api/client/appointments/:id', (req, res) => rescheduleAppointment(req, res, 'client'));
app.patch('/api/client/appointments/:id/cancel', cancelClientAppointment);
app.patch('/api/public/:slug/appointments/:id', (req, res) => rescheduleAppointment(req, res, 'client'));
app.patch('/api/public/:slug/appointments/:id/cancel', cancelClientAppointment);
app.patch('/api/appointments/:id/reschedule', owner, (req, res) => rescheduleAppointment(req, res, 'owner'));
app.patch('/api/appointments/:id/reschedule-request', owner,
  (req, res) => cancelAppointment(req, res, 'owner', 'owner_reschedule_request'));
app.patch('/api/appointments/:id/cancel-by-owner', owner,
  (req, res) => cancelAppointment(req, res, 'owner', 'owner_cancelled'));

function periodDates(query: Request['query']) {
  const period = z.coerce.number().refine(value => [1, 7, 30, 60, 90].includes(value))
    .parse(query.period ?? 30);
  const to = localNow().date;
  return { from: period === 1 ? to : dateAgo(period), to, period };
}
function financeDates(query: Request['query']) {
  if (query.from === undefined && query.to === undefined) return periodDates(query);
  if (query.from === undefined || query.to === undefined || query.period !== undefined)
    throw new ApiError(400, 'Informe data inicial e final sem combinar com outro filtro.');
  const from = date.parse(query.from);
  const to = date.parse(query.to);
  if (from > to) throw new ApiError(400, 'Período inválido.');
  return { from, to };
}
function entryDto(row: Row) {
  return { id: row.id, type: row.type, description: row.description,
    category: row.category || '', amount: fromCents(row.amount_cents), date: row.date,
    appointmentId: row.appointment_id, prepaidAppointmentId: row.prepaid_appointment_id,
    prepaidAppointmentStatus: row.prepaid_appointment_status ?? null,
    createdAt: row.created_at };
}
function listFinance(businessId: string, from: string, to: string) {
  const rows = db.prepare(`SELECT f.*,a.status AS prepaid_appointment_status FROM financial_entries f
    LEFT JOIN appointments a ON a.id=f.prepaid_appointment_id
    WHERE f.business_id=? AND f.date BETWEEN ? AND ?
    ORDER BY f.date DESC,f.created_at DESC LIMIT 1000`).all(businessId, from, to) as Row[];
  return rows.map(entryDto);
}
app.get('/api/finance', owner, (req, res) => {
  const { from, to } = financeDates(req.query);
  const businessId = currentUser(res).business_id;
  const entries = listFinance(businessId, from, to);
  const totals = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN type='income' THEN amount_cents ELSE 0 END),0) AS income_cents,
    COALESCE(SUM(CASE WHEN type='expense' THEN amount_cents ELSE 0 END),0) AS expenses_cents
    FROM financial_entries WHERE business_id=? AND date BETWEEN ? AND ?`)
    .get(businessId, from, to) as Row;
  const income = fromCents(totals.income_cents);
  const expenses = fromCents(totals.expenses_cents);
  res.json({ entries, income, expenses, balance: income - expenses });
});
app.get('/api/finance/entries', owner, (req, res) => {
  const from = req.query.from ? date.parse(req.query.from) : dateAgo(30);
  const to = req.query.to ? date.parse(req.query.to) : localNow().date;
  if (from > to) throw new ApiError(400, 'Período inválido.');
  res.json(listFinance(currentUser(res).business_id, from, to));
});
const financeInput = z.object({
  type: z.enum(['income', 'expense']), description: z.string().trim().min(2).max(150),
  amount: money.refine(value => value > 0), date,
  category: z.string().trim().max(50).optional(),
});
const financeCreateInput = financeInput.extend({ appointmentId: z.string().uuid().optional() });
function prepaidTotalCents(businessId: string, appointmentId: string, excludeId = '') {
  return (db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS total FROM financial_entries
    WHERE business_id=? AND prepaid_appointment_id=? AND type='income' AND id<>?`)
    .get(businessId, appointmentId, excludeId) as { total: number }).total;
}
function validatePrepayment(businessId: string, appointmentId: string, amountCents: number,
  receivedDate: string, excludeId = '') {
  const appointment = db.prepare(`SELECT status,price_cents FROM appointments WHERE id=? AND business_id=?`)
    .get(appointmentId, businessId) as { status: string; price_cents: number } | undefined;
  if (!appointment) throw new ApiError(404, 'Agendamento não encontrado.');
  if (!['pending', 'confirmed'].includes(appointment.status))
    throw new ApiError(409, 'Vincule pagamentos somente a agendamentos pendentes ou confirmados.');
  if (receivedDate > localNow().date)
    throw new ApiError(400, 'Para vincular ao agendamento, informe a data em que o pagamento já foi recebido.');
  if (amountCents > appointment.price_cents - prepaidTotalCents(businessId, appointmentId, excludeId))
    throw new ApiError(409, 'O pagamento excede o valor restante do agendamento.');
}
function createFinanceEntry(req: Request, res: Response) {
  const input = financeCreateInput.parse(req.body);
  const entryId = id();
  const businessId = currentUser(res).business_id;
  db.transaction(() => {
    if (input.appointmentId) {
      if (input.type !== 'income') throw new ApiError(400, 'Somente entradas podem ser vinculadas a agendamentos.');
      validatePrepayment(businessId, input.appointmentId, toCents(input.amount), input.date);
    }
    db.prepare(`INSERT INTO financial_entries
      (id,business_id,prepaid_appointment_id,type,description,category,amount_cents,date)
      VALUES(?,?,?,?,?,?,?,?)`).run(entryId, businessId, input.appointmentId ?? null,
        input.type, input.description, input.category || '', toCents(input.amount), input.date);
  }).immediate();
  res.status(201).json(entryDto(db.prepare('SELECT * FROM financial_entries WHERE id=?').get(entryId) as Row));
}
function deleteFinanceEntry(req: Request, res: Response) {
  const linked = db.prepare(`SELECT a.status FROM financial_entries f JOIN appointments a
    ON a.id=f.prepaid_appointment_id WHERE f.id=? AND f.business_id=?`)
    .get(req.params.id, currentUser(res).business_id) as { status: string } | undefined;
  if (linked?.status === 'completed')
    throw new ApiError(409, 'Este pagamento integra um atendimento concluído e não pode ser excluído.');
  const result = db.prepare(`DELETE FROM financial_entries WHERE id=? AND business_id=? AND appointment_id IS NULL`)
    .run(req.params.id, currentUser(res).business_id);
  if (!result.changes) throw new ApiError(404, 'Lançamento manual não encontrado.');
  res.status(204).end();
}
function updateFinanceEntry(req: Request, res: Response) {
  const businessId = currentUser(res).business_id;
  const previous = db.prepare(`SELECT * FROM financial_entries WHERE id=? AND business_id=? AND appointment_id IS NULL`)
    .get(req.params.id, businessId) as Row | undefined;
  if (!previous) throw new ApiError(404, 'Lançamento manual não encontrado.');
  const input = financeInput.partial().parse(req.body);
  db.transaction(() => {
    if (previous.prepaid_appointment_id) {
      if (input.type && input.type !== 'income')
        throw new ApiError(400, 'Um pagamento vinculado deve continuar como entrada.');
      validatePrepayment(businessId, previous.prepaid_appointment_id,
        input.amount === undefined ? previous.amount_cents : toCents(input.amount),
        input.date ?? previous.date, previous.id);
    }
    db.prepare(`UPDATE financial_entries SET type=?,description=?,category=?,amount_cents=?,date=?
      WHERE id=? AND business_id=? AND appointment_id IS NULL`).run(input.type ?? previous.type,
        input.description ?? previous.description, input.category ?? previous.category,
        input.amount === undefined ? previous.amount_cents : toCents(input.amount),
        input.date ?? previous.date, previous.id, businessId);
  }).immediate();
  res.json(entryDto(db.prepare('SELECT * FROM financial_entries WHERE id=?').get(previous.id) as Row));
}
app.post('/api/finance', owner, createFinanceEntry);
app.post('/api/finance/entries', owner, createFinanceEntry);
app.patch('/api/finance/:id', owner, updateFinanceEntry);
app.patch('/api/finance/entries/:id', owner, updateFinanceEntry);
app.delete('/api/finance/:id', owner, deleteFinanceEntry);
app.delete('/api/finance/entries/:id', owner, deleteFinanceEntry);

app.get('/api/dashboard', owner, (req, res) => {
  const businessId = currentUser(res).business_id;
  const { from, to } = periodDates(req.query);
  const revenueCents = (db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS total FROM financial_entries
    WHERE business_id=? AND type='income' AND date BETWEEN ? AND ?`)
    .get(businessId, from, to) as Row).total as number;
  const stats = db.prepare(`SELECT
    COUNT(CASE WHEN status!='cancelled' THEN 1 END) AS appointments,
    COUNT(DISTINCT CASE WHEN status!='cancelled' THEN client_id END) AS clients,
    COUNT(CASE WHEN status='completed' THEN 1 END) AS completed,
    COALESCE(SUM(CASE WHEN status='completed' THEN price_cents ELSE 0 END),0) AS completed_cents
    FROM appointments WHERE business_id=? AND date BETWEEN ? AND ?`)
    .get(businessId, from, to) as Row;
  const topClients = db.prepare(`SELECT u.id,u.name,
    COUNT(a.id) AS visits, COALESCE(SUM(a.price_cents),0) AS spent_cents
    FROM appointments a JOIN users u ON u.id=a.client_id
    WHERE a.business_id=? AND a.date BETWEEN ? AND ? AND a.status='completed'
    GROUP BY a.client_id ORDER BY visits DESC,spent_cents DESC LIMIT 5`)
    .all(businessId, from, to) as Row[];
  const recent = db.prepare(`${appointmentSelect} WHERE a.business_id=? AND a.date BETWEEN ? AND ?
    ORDER BY a.date DESC,a.start_time DESC LIMIT 8`).all(businessId, from, to) as Row[];
  res.json({
    revenue: fromCents(revenueCents),
    ticketAverage: stats.completed ? fromCents(Math.round(stats.completed_cents / stats.completed)) : 0,
    appointments: stats.appointments, clients: stats.clients,
    topClients: topClients.map(row => ({ id: row.id, name: row.name, visits: row.visits,
      spent: fromCents(row.spent_cents) })),
    recentAppointments: recent.map(appointmentDto),
  });
});

app.get('/api/assistant/status', owner, async (_req, res) => res.json(await assistantStatus()));
app.get('/api/assistant/conversations', owner, (req, res) => {
  const limit = z.coerce.number().int().min(1).max(100).parse(req.query.limit ?? 100);
  const offset = z.coerce.number().int().min(0).parse(req.query.offset ?? 0);
  const user = currentUser(res);
  res.json(listAssistantConversations({ businessId: user.business_id, userId: user.id }, limit, offset));
});
app.get('/api/assistant/conversations/:id', owner, (req, res) => {
  const conversationId = z.uuid().parse(req.params.id);
  const user = currentUser(res);
  const conversation = getAssistantConversation({ businessId: user.business_id, userId: user.id },
    conversationId);
  if (!conversation) throw new ApiError(404, 'Conversa não encontrada.');
  res.json(conversation);
});
app.delete('/api/assistant/conversations/:id', owner, (req, res) => {
  const conversationId = z.uuid().parse(req.params.id);
  const user = currentUser(res);
  if (!deleteAssistantConversation({ businessId: user.business_id, userId: user.id }, conversationId))
    throw new ApiError(404, 'Conversa não encontrada.');
  res.status(204).end();
});
app.post('/api/assistant/action-preparation', owner, rateLimit(60, 60_000), (req, res) => {
  const { message, conversationId, kind } = z.object({
    message: z.string().trim().min(2).max(1000),
    conversationId: z.uuid().optional(),
    kind: z.enum(['reschedule-request', 'cancel-by-owner']),
  }).parse(req.body);
  const user = currentUser(res);
  const now = localNow();
  const future = db.prepare(`SELECT 1 FROM appointments WHERE business_id=?
    AND status IN ('pending','confirmed') AND (date>? OR (date=? AND start_time>?)) LIMIT 1`)
    .get(user.business_id, now.date, now.date, now.time);
  const answer = !future
    ? 'Não encontrei agendamentos futuros ativos para alterar. Confira sua agenda ou peça à cliente para fazer um novo agendamento.'
    : kind === 'reschedule-request'
      ? 'Vou te ajudar a pedir uma remarcação. Escolha o agendamento exato; depois você poderá revisar e confirmar o aviso à cliente.'
      : 'Vou te ajudar a cancelar por imprevisto. Escolha o agendamento exato; depois você poderá revisar e confirmar o aviso à cliente.';
  const saved = saveAssistantExchange({ businessId: user.business_id, userId: user.id },
    conversationId, message, answer);
  res.json({ answer, ...saved });
});
app.post('/api/assistant/conversations/:id/action-result', owner, rateLimit(60, 60_000),
  (req, res) => {
    const conversationId = z.uuid().parse(req.params.id);
    const { eventId } = z.object({ eventId: z.uuid() }).parse(req.body);
    const user = currentUser(res);
    res.json(saveAssistantActionResult({ businessId: user.business_id, userId: user.id },
      conversationId, eventId));
  });
app.post('/api/assistant', owner, rateLimit(60, 60_000), async (req, res) => {
  const { message, conversationId } = z.object({
    message: z.string().trim().min(2).max(1000),
    conversationId: z.uuid().optional(),
  }).parse(req.body);
  const user = currentUser(res);
  const scope = { businessId: user.business_id, userId: user.id };
  const history = conversationId ? assistantConversationHistory(scope, conversationId) : [];
  const reply = await answerAssistant(user.business_id, message, history);
  const saved = saveAssistantExchange(scope, conversationId, message, reply.answer);
  res.json({ ...reply, ...saved });
});

function publicOrigin(req: Request) {
  return process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
}
app.get('/api/notifications/config', owner, (req, res) => {
  res.json(whatsAppConfig(currentUser(res).business_id, publicOrigin(req)));
});
app.patch('/api/notifications/config', owner, (req, res) => {
  const input = z.object({
    mode: z.enum(['disabled', 'simulate', 'meta']),
    templateName: z.string().trim().max(100).refine(value => !value || /^[a-z0-9_]+$/.test(value)).default(''),
    urgentTemplateName: z.string().trim().max(100)
      .refine(value => !value || /^[a-z0-9_]+$/.test(value)).optional(),
    reminderTemplateName: z.string().trim().max(100)
      .refine(value => !value || /^[a-z0-9_]+$/.test(value)).optional(),
    sender: z.string().trim().max(35).default(''),
    phoneNumberId: z.string().trim().max(40).refine(value => !value || /^\d+$/.test(value)).default(''),
    accessToken: z.string().trim().max(2048).nullable().optional(),
    appSecret: z.string().trim().max(2048).nullable().optional(),
  }).parse(req.body);
  res.json(updateWhatsAppSettings(currentUser(res).business_id, input, publicOrigin(req)));
});
app.get('/api/notifications', owner, (req, res) => {
  const limit = z.coerce.number().int().min(1).max(100).parse(req.query.limit ?? 50);
  const rows = db.prepare(`SELECT n.id,n.appointment_id,n.kind,n.recipient,n.message,n.status,
    n.provider_message_id,n.error,n.created_at,n.updated_at,
    a.whatsapp_opt_in AS booking_consent,u.whatsapp_opt_in AS client_consent
    FROM notification_outbox n JOIN appointments a ON a.id=n.appointment_id
    JOIN users u ON u.id=a.client_id
    WHERE n.business_id=? ORDER BY n.created_at DESC,n.id DESC LIMIT ?`)
    .all(currentUser(res).business_id, limit) as Row[];
  res.json(rows.map(row => ({ id: row.id, appointmentId: row.appointment_id,
    kind: row.kind,
    recipient: row.recipient, message: row.message, status: row.status,
    providerMessageId: row.provider_message_id, error: row.error,
    canContact: Boolean(row.booking_consent && row.client_consent),
    createdAt: row.created_at, updatedAt: row.updated_at })));
});

app.get('/api/inbox', owner, (req, res) => {
  const limit = z.coerce.number().int().min(1).max(100).parse(req.query.limit ?? 50);
  const user = currentUser(res);
  res.json(listInbox(user.id, user.business_id, limit));
});
app.patch('/api/inbox/:id/read', owner, (req, res) => {
  const user = currentUser(res);
  const notificationId = z.uuid().parse(req.params.id);
  if (!markInboxRead(user.id, user.business_id, notificationId))
    throw new ApiError(404, 'Notificação não encontrada.');
  res.status(204).end();
});
app.get('/api/client/inbox', (req, res) => {
  const user = clientForRequest(req, res);
  const limit = z.coerce.number().int().min(1).max(100).parse(req.query.limit ?? 50);
  res.json(listInbox(user.id, user.business_id, limit));
});
app.patch('/api/client/inbox/:id/read', (req, res) => {
  const user = clientForRequest(req, res);
  const notificationId = z.uuid().parse(req.params.id);
  if (!markInboxRead(user.id, user.business_id, notificationId))
    throw new ApiError(404, 'Notificação não encontrada.');
  res.status(204).end();
});

app.get('/api/webhooks/whatsapp/:key', (req, res) => {
  const settings = webhookSettings(String(req.params.key));
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (!settings || mode !== 'subscribe' || typeof token !== 'string' ||
    typeof challenge !== 'string' || !verifyWebhookChallenge(settings, token))
    return res.status(403).end();
  res.type('text/plain').send(challenge);
});
app.post('/api/webhooks/whatsapp/:key', (req, res) => {
  const settings = webhookSettings(String(req.params.key));
  const signature = req.get('x-hub-signature-256') || '';
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!settings || !rawBody || !verifyWebhookSignature(settings, signature, rawBody))
    return res.status(403).end();
  applyWebhookStatuses(settings, req.body);
  res.status(200).send('EVENT_RECEIVED');
});

app.get('/api/internal/reminders', async (req, res) => {
  const result = await handleReminderCron({ method: req.method,
    authorization: req.get('authorization') });
  res.status(result.status).json(result.body);
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
const distPath = resolve(process.cwd(), 'dist');
app.use(express.static(distPath));
app.use((_req, res, next) => {
  const indexPath = resolve(distPath, 'index.html');
  if (!existsSync(indexPath)) return next();
  res.sendFile(indexPath);
});
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const parserType = error && typeof error === 'object' && 'type' in error
    ? (error as { type?: unknown }).type : undefined;
  if (parserType === 'entity.parse.failed')
    return res.status(400).json({ error: 'JSON inválido.' });
  if (parserType === 'entity.too.large')
    return res.status(413).json({ error: 'Dados enviados excedem o limite permitido.' });
  if (error instanceof ZodError) return res.status(400).json({ error: 'Dados inválidos.', details: error.issues.map(issue => ({
    field: issue.path.join('.'), message: issue.message,
  })) });
  if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
  if (error instanceof AssistantConversationNotFound)
    return res.status(404).json({ error: error.message });
  if (error instanceof AssistantActionConflict)
    return res.status(409).json({ error: error.message });
  if (error instanceof GoogleAuthError) return res.status(error.status).json({ error: error.message });
  if (error instanceof NotificationError) return res.status(error.status).json({ error: error.message });
  if (error instanceof Error && /SQLITE_CONSTRAINT/.test(error.message))
    return res.status(409).json({ error: 'Este registro já existe ou está em uso.' });
  // Parser errors may contain the request body, including passwords or tokens.
  // Never log the raw error object or request payload.
  console.error('API error', error instanceof Error ? error.constructor.name : 'UnknownError');
  res.status(500).json({ error: 'Não foi possível concluir a solicitação.' });
});

// Importing the app must not start an HTTP listener or a background worker.
// A future Vercel adapter will also need persistent storage before it can
// serve requests: the current SQLite database is local to this process.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001);
  startReminderWorker();
  app.listen(port, () => console.log(`Nayla API disponível em http://localhost:${port}`));
}

export default app;
