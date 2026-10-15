import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import { catalog } from './catalog.js';
import { addMinutes, dateAgo, db, fromCents, id, localNow, toCents, validDate } from './db.js';
import { applyWebhookStatuses, NotificationError, sendBookingConfirmation,
  updateWhatsAppSettings, verifyWebhookChallenge, verifyWebhookSignature,
  webhookSettings, whatsAppConfig } from './notifications.js';
import { answerAssistant } from './assistant.js';

type Row = Record<string, any>;
type User = Row & { id: string; business_id: string; role: 'owner' | 'client' };
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1');
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
  const sameOrigin = origin === `${req.protocol}://${req.get('host')}`;
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
function createSession(req: Request, res: Response, user: User) {
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
    .run(hash, user.id, Date.now() + 30 * 24 * 60 * 60_000);
  if (!nativeRequest(req)) {
    res.cookie(cookieName(user.role), token, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60_000, path: '/',
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
const owner = requireRole('owner');
function currentUser(res: Response): User { return res.locals.user as User; }
function businessById(businessId: string) {
  const row = db.prepare('SELECT * FROM businesses WHERE id=?').get(businessId) as Row;
  return businessDto(row);
}
function businessDto(row: Row) {
  return {
    id: row.id, name: row.name, slug: row.slug, description: row.description || '', phone: row.phone || '',
    specialties: JSON.parse(row.specialties) as string[], address: row.address || '',
    startTime: row.start_time, endTime: row.end_time,
    workdays: JSON.parse(row.workdays) as number[], slotInterval: row.slot_interval,
  };
}
function userDto(row: Row) {
  return { id: row.id, name: row.name, email: row.email || '', phone: row.phone || '',
    cpf: row.cpf || '', whatsappOptIn: Boolean(row.whatsapp_opt_in),
    role: row.role, businessId: row.business_id };
}
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
const password = z.string().min(8, 'A senha precisa ter ao menos 8 caracteres.').max(100);
const slug = z.string().min(3).max(45).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const specialty = z.enum(['unhas', 'sobrancelhas', 'cilios']);
const date = z.string().refine(validDate, 'Data inválida.');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const money = z.number().finite().min(0).max(1_000_000);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/register', rateLimit(10), async (req, res) => {
  const input = z.object({
    ownerName: z.string().trim().min(2).max(100), businessName: z.string().trim().min(2).max(100),
    slug, email, password, phone: z.string().optional(),
    specialties: z.array(specialty).min(1).max(3),
  }).parse(req.body);
  if (db.prepare('SELECT 1 FROM businesses WHERE slug=?').get(input.slug)) throw new ApiError(409, 'Este link de agendamento já está em uso.');
  if (db.prepare(`SELECT 1 FROM users WHERE role='owner' AND email=?`).get(input.email)) throw new ApiError(409, 'Este e-mail já está cadastrado.');
  const hash = await bcrypt.hash(input.password, 12);
  const businessId = id(), userId = id();
  db.transaction(() => {
    db.prepare('INSERT INTO businesses(id,slug,name,phone,specialties) VALUES(?,?,?,?,?)')
      .run(businessId, input.slug, input.businessName, input.phone || null, JSON.stringify([...new Set(input.specialties)]));
    db.prepare(`INSERT INTO users(id,business_id,role,name,email,phone,password_hash)
      VALUES(?,?,'owner',?,?,?,?)`).run(userId, businessId, input.ownerName, input.email, input.phone || null, hash);
    const addService = db.prepare(`INSERT INTO services(id,business_id,name,category,duration_minutes,price_cents)
      VALUES(?,?,?,?,?,?)`);
    for (const item of catalog.filter(item => input.specialties.includes(item.category)))
      addService.run(id(), businessId, item.name, item.category, item.durationMinutes, toCents(item.price));
  })();
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId) as User;
  const session = createSession(req, res, user);
  res.status(201).json({ user: userDto(user), business: businessById(businessId), ...session });
});

app.post('/api/auth/login', rateLimit(15), async (req, res) => {
  const input = z.object({ email: email.optional(), identifier: z.string().optional(), password: z.string() }).parse(req.body);
  const address = (input.email || input.identifier || '').trim().toLowerCase();
  const user = db.prepare(`SELECT * FROM users WHERE role='owner' AND email=?`).get(address) as User | undefined;
  if (!user || !await bcrypt.compare(input.password, user.password_hash)) throw new ApiError(401, 'E-mail ou senha inválidos.');
  const session = createSession(req, res, user);
  res.json({ user: userDto(user), business: businessById(user.business_id), ...session });
});
app.get('/api/auth/me', owner, (_req, res) => {
  const user = currentUser(res);
  res.json({ user: userDto(user), business: businessById(user.business_id) });
});
app.post('/api/auth/logout', (req, res) => {
  revokeSession(req, 'owner');
  res.clearCookie(cookieName('owner'), { path: '/' });
  res.status(204).end();
});
app.delete('/api/auth/account', owner, rateLimit(10), async (req, res) => {
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
app.patch('/api/business', owner, (req, res) => {
  const input = z.object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    phone: z.string().trim().max(25).optional(),
    address: z.string().trim().max(250).optional(),
    specialties: z.array(specialty).min(1).max(3).optional(),
    startTime: time.optional(), endTime: time.optional(),
    workdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    slotInterval: z.number().int().min(15).max(120).optional(),
  }).parse(req.body);
  const previous = businessById(currentUser(res).business_id);
  const startTime = input.startTime ?? previous.startTime;
  const endTime = input.endTime ?? previous.endTime;
  if (startTime >= endTime) throw new ApiError(400, 'O horário final deve ser posterior ao inicial.');
  db.prepare(`UPDATE businesses SET name=?,description=?,phone=?,address=?,specialties=?,start_time=?,end_time=?,workdays=?,slot_interval=? WHERE id=?`)
    .run(input.name ?? previous.name, input.description ?? previous.description,
      input.phone ?? previous.phone, input.address ?? previous.address,
      JSON.stringify(input.specialties ?? previous.specialties), startTime, endTime,
      JSON.stringify(input.workdays ?? previous.workdays), input.slotInterval ?? previous.slotInterval,
      currentUser(res).business_id);
  res.json(businessById(currentUser(res).business_id));
});

app.get('/api/services', owner, (_req, res) => {
  const rows = db.prepare('SELECT * FROM services WHERE business_id=? ORDER BY category,name')
    .all(currentUser(res).business_id) as Row[];
  res.json(rows.map(serviceDto));
});
const serviceInput = z.object({
  name: z.string().trim().min(2).max(100), description: z.string().trim().max(500).default(''),
  category: z.enum(['unhas', 'sobrancelhas', 'cilios', 'outros']),
  durationMinutes: z.number().int().min(15).max(480), price: money,
  active: z.boolean().default(true),
});
app.post('/api/services', owner, (req, res) => {
  const input = serviceInput.parse(req.body);
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

const appointmentStatus = z.enum(['pending', 'confirmed', 'completed', 'cancelled', 'no_show']);
app.patch('/api/appointments/:id', owner, (req, res) => {
  const { status } = z.object({ status: appointmentStatus }).parse(req.body);
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
      db.prepare(`INSERT OR IGNORE INTO financial_entries
        (id,business_id,appointment_id,type,description,category,amount_cents,date)
        VALUES(?,?,?,'income',?,'Atendimento',?,?)`)
        .run(id(), user.business_id, existing.id, `${existing.service_name} — ${existing.client_name}`,
          existing.price_cents, existing.date);
    }
  }).immediate();
  res.json(appointmentDto(getAppointment(user.business_id, existing.id)!));
});

function publicBusiness(slugValue: string): Row {
  const row = db.prepare('SELECT * FROM businesses WHERE slug=?').get(slugValue) as Row | undefined;
  if (!row) throw new ApiError(404, 'Página de agendamento não encontrada.');
  return row;
}
function bookingIsAllowed(business: Row, service: Row, day: string, startTime: string) {
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
  const clash = db.prepare(`SELECT 1 FROM appointments WHERE business_id=? AND date=?
    AND status IN ('pending','confirmed','completed') AND start_time<? AND end_time>? LIMIT 1`)
    .get(business.id, day, endTime, startTime);
  if (clash) throw new ApiError(409, 'Este horário acabou de ser reservado. Escolha outro.');
  return endTime;
}
function availability(business: Row, service: Row, day: string) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const workdays = JSON.parse(business.workdays) as number[];
  if (!workdays.includes(weekday)) return [];
  const slots: string[] = [];
  for (let slot = business.start_time as string; slot < business.end_time; slot = addMinutes(slot, business.slot_interval) || '24:00') {
    const end = addMinutes(slot, service.duration_minutes);
    if (!end || end > business.end_time) break;
    try { bookingIsAllowed(business, service, day, slot); slots.push(slot); }
    catch (error) { if (!(error instanceof ApiError)) throw error; }
  }
  return slots;
}
function serviceForBusiness(businessId: string, serviceId: string) {
  const service = db.prepare('SELECT * FROM services WHERE id=? AND business_id=? AND active=1')
    .get(serviceId, businessId) as Row | undefined;
  if (!service) throw new ApiError(404, 'Serviço não encontrado.');
  return service;
}

app.get('/api/public/:slug', (req, res) => {
  const business = publicBusiness(String(req.params.slug));
  const services = db.prepare('SELECT * FROM services WHERE business_id=? AND active=1 ORDER BY category,name')
    .all(business.id) as Row[];
  res.json({ business: businessDto(business), services: services.map(serviceDto) });
});
app.get('/api/public/:slug/availability', (req, res) => {
  const business = publicBusiness(String(req.params.slug));
  const input = z.object({ serviceId: z.uuid(), date }).parse(req.query);
  const service = serviceForBusiness(business.id, input.serviceId);
  res.json({ slots: availability(business, service, input.date) });
});

const clientDetails = z.object({
  name: z.string().trim().min(2).max(100),
  cpf: z.string().refine(validCpf, 'CPF inválido.'),
  phone: z.string().transform(value => value.replace(/\D/g, '')).refine(value => /^\d{10,13}$/.test(value), 'Telefone inválido.'),
  email: optionalEmail, password: password.optional(),
  whatsappOptIn: z.boolean().default(false),
});
const bookingInput = z.object({ serviceId: z.uuid(), date, time, client: clientDetails.optional() });
app.post('/api/public/:slug/bookings', rateLimit(20), async (req, res) => {
  const business = publicBusiness(String(req.params.slug));
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
      if (!input.client.password) throw new ApiError(400, 'Crie uma senha no primeiro agendamento.');
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
    return user;
  }).immediate();
  const session = createSession(req, res, result);
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
    password: z.string() }).parse(req.body);
  const slugValue = req.params.slug ? String(req.params.slug) : input.slug;
  if (!slugValue) throw new ApiError(400, 'Informe o link da profissional.');
  const business = publicBusiness(slugValue);
  const identifier = (input.identifier || input.email || '').trim();
  const digits = identifier.replace(/\D/g, '');
  const user = db.prepare(`SELECT * FROM users WHERE business_id=? AND role='client'
    AND (email=? OR cpf=? OR phone=?)`).get(business.id, identifier.toLowerCase(), digits, digits) as User | undefined;
  if (!user || !await bcrypt.compare(input.password, user.password_hash))
    throw new ApiError(401, 'Dados de acesso inválidos.');
  const session = createSession(req, res, user);
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

function cancelClientAppointment(req: Request, res: Response) {
  const user = clientForRequest(req, res);
  const row = getAppointment(user.business_id, String(req.params.id));
  if (!row || row.client_id !== user.id) throw new ApiError(404, 'Agendamento não encontrado.');
  if (!['pending', 'confirmed'].includes(row.status)) throw new ApiError(409, 'Este agendamento não pode ser cancelado.');
  const now = localNow();
  if (row.date < now.date || (row.date === now.date && row.start_time <= now.time))
    throw new ApiError(409, 'Este atendimento já começou. Entre em contato com a profissional.');
  db.prepare(`UPDATE appointments SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=? AND client_id=?`)
    .run(row.id, user.business_id, user.id);
  res.json(appointmentDto(getAppointment(user.business_id, row.id)!));
}
app.patch('/api/client/appointments/:id/cancel', cancelClientAppointment);
app.patch('/api/public/:slug/appointments/:id/cancel', cancelClientAppointment);

function periodDates(query: Request['query']) {
  const period = z.coerce.number().refine(value => [7, 30, 60, 90].includes(value))
    .parse(query.period ?? 30);
  return { from: dateAgo(period), to: localNow().date, period };
}
function entryDto(row: Row) {
  return { id: row.id, type: row.type, description: row.description,
    category: row.category || '', amount: fromCents(row.amount_cents), date: row.date,
    appointmentId: row.appointment_id, createdAt: row.created_at };
}
function listFinance(businessId: string, from: string, to: string) {
  const rows = db.prepare(`SELECT * FROM financial_entries WHERE business_id=? AND date BETWEEN ? AND ?
    ORDER BY date DESC,created_at DESC LIMIT 1000`).all(businessId, from, to) as Row[];
  return rows.map(entryDto);
}
app.get('/api/finance', owner, (req, res) => {
  const { from, to } = periodDates(req.query);
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
function createFinanceEntry(req: Request, res: Response) {
  const input = financeInput.parse(req.body);
  const entryId = id();
  db.prepare(`INSERT INTO financial_entries(id,business_id,type,description,category,amount_cents,date)
    VALUES(?,?,?,?,?,?,?)`).run(entryId, currentUser(res).business_id, input.type,
      input.description, input.category || '', toCents(input.amount), input.date);
  res.status(201).json(entryDto(db.prepare('SELECT * FROM financial_entries WHERE id=?').get(entryId) as Row));
}
function deleteFinanceEntry(req: Request, res: Response) {
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
  db.prepare(`UPDATE financial_entries SET type=?,description=?,category=?,amount_cents=?,date=?
    WHERE id=? AND business_id=? AND appointment_id IS NULL`).run(input.type ?? previous.type,
      input.description ?? previous.description, input.category ?? previous.category,
      input.amount === undefined ? previous.amount_cents : toCents(input.amount),
      input.date ?? previous.date, previous.id, businessId);
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

app.post('/api/assistant', owner, rateLimit(60, 60_000), async (req, res) => {
  const { message } = z.object({ message: z.string().trim().min(2).max(1000) }).parse(req.body);
  const answer = await answerAssistant(currentUser(res).business_id, message);
  res.json({ answer });
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
    sender: z.string().trim().max(35).default(''),
    phoneNumberId: z.string().trim().max(40).refine(value => !value || /^\d+$/.test(value)).default(''),
    accessToken: z.string().trim().max(2048).nullable().optional(),
    appSecret: z.string().trim().max(2048).nullable().optional(),
  }).parse(req.body);
  res.json(updateWhatsAppSettings(currentUser(res).business_id, input, publicOrigin(req)));
});
app.get('/api/notifications', owner, (req, res) => {
  const limit = z.coerce.number().int().min(1).max(100).parse(req.query.limit ?? 50);
  const rows = db.prepare(`SELECT n.id,n.appointment_id,n.recipient,n.message,n.status,
    n.provider_message_id,n.error,n.created_at,n.updated_at,
    a.whatsapp_opt_in AS booking_consent,u.whatsapp_opt_in AS client_consent
    FROM notification_outbox n JOIN appointments a ON a.id=n.appointment_id
    JOIN users u ON u.id=a.client_id
    WHERE n.business_id=? ORDER BY n.created_at DESC,n.id DESC LIMIT ?`)
    .all(currentUser(res).business_id, limit) as Row[];
  res.json(rows.map(row => ({ id: row.id, appointmentId: row.appointment_id,
    recipient: row.recipient, message: row.message, status: row.status,
    providerMessageId: row.provider_message_id, error: row.error,
    canContact: Boolean(row.booking_consent && row.client_consent),
    createdAt: row.created_at, updatedAt: row.updated_at })));
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

app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
const distPath = resolve(process.cwd(), 'dist');
if (existsSync(resolve(distPath, 'index.html'))) {
  app.use(express.static(distPath));
  app.use((_req, res) => res.sendFile(resolve(distPath, 'index.html')));
}
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) return res.status(400).json({ error: 'Dados inválidos.', details: error.issues.map(issue => ({
    field: issue.path.join('.'), message: issue.message,
  })) });
  if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
  if (error instanceof NotificationError) return res.status(error.status).json({ error: error.message });
  if (error instanceof Error && /SQLITE_CONSTRAINT/.test(error.message))
    return res.status(409).json({ error: 'Este registro já existe ou está em uso.' });
  console.error('API error', error);
  res.status(500).json({ error: 'Não foi possível concluir a solicitação.' });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`Nayla API disponível em http://localhost:${port}`));
