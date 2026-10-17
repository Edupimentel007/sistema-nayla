import { createHash, createPublicKey, randomBytes, verify as verifySignature, type JsonWebKey } from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, id, toCents } from './db.js';
import { catalog, specialtySchema, specialtyValues } from './catalog.js';

type Row = Record<string, any>;
type Role = 'owner' | 'client';
type User = Row & { id: string; business_id: string; role: Role };
type GoogleClaims = { iss: string; aud: string; azp?: string; exp: number; nonce: string;
  sub: string; email: string; email_verified: boolean; name?: string };
type Options = {
  createSession: (req: Request, res: Response, user: User, remember: boolean) => { sessionToken?: string };
  businessById: (id: string) => unknown;
  businessDto: (business: Row) => unknown;
  userDto: (user: Row) => unknown;
  nativeRequest: (req: Request) => boolean;
  rateLimit: (max: number) => (req: Request, res: Response, next: NextFunction) => void;
};

export class GoogleAuthError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const flowCookie = 'nayla_google_flow';
const flowMs = 10 * 60_000;
const googleAuthorize = 'https://accounts.google.com/o/oauth2/v2/auth';
const googleToken = 'https://oauth2.googleapis.com/token';
const googleKeys = 'https://www.googleapis.com/oauth2/v3/certs';
let keyCache: { keys: JsonWebKey[]; expires: number } | null = null;

function configuration() {
  const origin = process.env.APP_ORIGIN?.trim().replace(/\/$/, '') || '';
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || '';
  if (!origin || !clientId || !clientSecret || !/^https?:\/\/[^/]+$/.test(origin)) return null;
  if (!origin.startsWith('https://') && !/^http:\/\/localhost(?::\d+)?$/.test(origin)) return null;
  return { origin, clientId, clientSecret, redirectUri: `${origin}/api/auth/google/callback` };
}

async function googlePublicKeys() {
  if (keyCache && keyCache.expires > Date.now()) return keyCache.keys;
  const response = await fetch(googleKeys, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new GoogleAuthError(502, 'Não foi possível verificar a identidade Google. Tente novamente.');
  const body = await response.json() as { keys?: JsonWebKey[] };
  if (!Array.isArray(body.keys)) throw new GoogleAuthError(502, 'Resposta de identidade Google inválida.');
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') || '')?.[1] || 300);
  keyCache = { keys: body.keys, expires: Date.now() + Math.min(maxAge, 3600) * 1000 };
  return body.keys;
}

async function verifyIdToken(token: string, nonce: string, audience: string): Promise<GoogleClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new GoogleAuthError(401, 'Identidade Google inválida.');
  let header: { alg?: string; kid?: string }, claims: GoogleClaims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { throw new GoogleAuthError(401, 'Identidade Google inválida.'); }
  if (header.alg !== 'RS256' || !header.kid)
    throw new GoogleAuthError(401, 'Assinatura Google inválida.');
  const key = (await googlePublicKeys()).find(item => item.kid === header.kid && item.kty === 'RSA');
  if (!key || !verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url')))
    throw new GoogleAuthError(401, 'Assinatura Google inválida.');
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) ||
    claims.aud !== audience || (claims.azp && claims.azp !== audience) ||
    typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now() ||
    claims.nonce !== nonce || !claims.email_verified ||
    typeof claims.sub !== 'string' || !claims.sub ||
    typeof claims.email !== 'string' || !z.email().safeParse(claims.email).success)
    throw new GoogleAuthError(401, 'Não foi possível validar sua conta Google.');
  return claims;
}

function ticketForRequest(req: Request, role: Role) {
  const input = z.object({ ticket: z.string().min(32), appNonce: z.string().optional() }).parse(req.body);
  const row = db.prepare('SELECT * FROM google_oauth_tickets WHERE ticket_hash=? AND role=? AND expires_at>?')
    .get(hash(input.ticket), role, Date.now()) as Row | undefined;
  if (!row) throw new GoogleAuthError(401, 'A entrada com Google expirou. Tente novamente.');
  if (row.mobile) {
    if (!/^[a-f0-9]{64}$/.test(input.appNonce || '') || hash(input.appNonce!) !== row.app_nonce)
      throw new GoogleAuthError(401, 'Este retorno do Google não pertence a este app.');
  } else if (hash(req.cookies?.[flowCookie] || '') !== row.csrf_hash) {
    throw new GoogleAuthError(401, 'Esta entrada com Google não pertence a este navegador.');
  }
  return { input, row };
}

function finishTicket(req: Request, res: Response, row: Row, user: Row, options: Options) {
  db.prepare('DELETE FROM google_oauth_tickets WHERE ticket_hash=?').run(row.ticket_hash);
  if (!row.mobile) res.clearCookie(flowCookie, { path: '/api/auth/google' });
  const session = options.createSession(req, res, user as User, Boolean(row.remember));
  return { user: options.userDto(user), business: options.businessById(user.business_id),
    ...(row.role === 'client' ? { client: options.userDto(user) } : {}), ...session };
}

function getBusiness(slug: string) {
  const business = db.prepare('SELECT * FROM businesses WHERE slug=?').get(slug) as Row | undefined;
  if (!business) throw new GoogleAuthError(404, 'Página de agendamento não encontrada.');
  return business;
}

function validCpf(value: string) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  for (let count = 9; count <= 10; count++) {
    const sum = Array.from(value.slice(0, count)).reduce((total, digit, index) =>
      total + Number(digit) * (count + 1 - index), 0);
    if (((sum * 10) % 11) % 10 !== Number(value[count])) return false;
  }
  return true;
}

function existingBySubject(row: Row) {
  return db.prepare(`SELECT * FROM users WHERE role=? AND google_subject=?
    AND (role='owner' OR business_id=?)`).get(row.role, row.google_subject, row.business_id) as Row | undefined;
}

export function mountGoogleAuth(app: Express, options: Options) {
  app.get('/api/auth/google/config', (_req, res) => res.json({ enabled: Boolean(configuration()) }));

  app.post('/api/auth/google/start', options.rateLimit(10), (req, res) => {
    const config = configuration();
    if (!config) throw new GoogleAuthError(503, 'Login com Google ainda não está configurado. Use e-mail e senha.');
    const input = z.object({ role: z.enum(['owner', 'client']), slug: z.string().optional(),
      remember: z.boolean().default(false), appNonce: z.string().optional() }).parse(req.body);
    const mobile = options.nativeRequest(req);
    if (mobile && !/^[a-f0-9]{64}$/.test(input.appNonce || ''))
      throw new GoogleAuthError(400, 'Não foi possível iniciar a entrada no app.');
    if (!mobile && input.appNonce) throw new GoogleAuthError(400, 'Origem de entrada inválida.');
    const business = input.role === 'client' ? getBusiness(input.slug || '') : null;
    const state = random(), verifier = random(), nonce = random();
    const csrf = mobile ? '' : random();
    db.prepare(`INSERT INTO google_oauth_flows
      (state_hash,verifier,nonce,role,business_id,slug,remember,mobile,app_nonce,csrf_hash,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(hash(state), verifier, nonce, input.role,
      business?.id || null, business?.slug || null, Number(input.remember), Number(mobile),
      mobile ? hash(input.appNonce!) : null, hash(csrf), Date.now() + flowMs);
    if (!mobile) res.cookie(flowCookie, csrf, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
      maxAge: flowMs, path: '/api/auth/google',
    });
    const url = new URL(googleAuthorize);
    url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri,
      response_type: 'code', scope: 'openid email profile', state, nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256', prompt: 'select_account' }).toString();
    res.json({ authorizationUrl: url.toString() });
  });

  app.get('/api/auth/google/callback', async (req, res) => {
    const config = configuration();
    if (!config) throw new GoogleAuthError(503, 'Login com Google indisponível.');
    const state = String(req.query.state || '');
    const code = String(req.query.code || '');
    const flow = db.prepare('SELECT * FROM google_oauth_flows WHERE state_hash=? AND expires_at>?')
      .get(hash(state), Date.now()) as Row | undefined;
    if (!flow || (!flow.mobile && hash(req.cookies?.[flowCookie] || '') !== flow.csrf_hash))
      throw new GoogleAuthError(401, 'Esta entrada com Google expirou ou não pertence a este navegador.');
    db.prepare('DELETE FROM google_oauth_flows WHERE state_hash=?').run(flow.state_hash);
    if (!code) {
      res.setHeader('Cache-Control', 'no-store');
      if (flow.mobile) return res.redirect(303, 'com.edupimentel.nayla://auth?error=cancelled');
      const destination = flow.role === 'owner' ? '/entrar' : `/agendar/${encodeURIComponent(flow.slug)}/entrar`;
      return res.redirect(303, `${config.origin}${destination}?google_error=cancelled`);
    }
    const tokenResponse = await fetch(googleToken, { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret,
        redirect_uri: config.redirectUri, grant_type: 'authorization_code', code_verifier: flow.verifier }),
      signal: AbortSignal.timeout(8_000) });
    if (!tokenResponse.ok) throw new GoogleAuthError(401, 'O Google não concluiu a entrada. Tente novamente.');
    const token = await tokenResponse.json() as { id_token?: string };
    if (!token.id_token) throw new GoogleAuthError(401, 'O Google não confirmou sua identidade.');
    const claims = await verifyIdToken(token.id_token, flow.nonce, config.clientId);
    const ticket = random();
    db.prepare(`INSERT INTO google_oauth_tickets
      (ticket_hash,role,business_id,slug,google_subject,email,name,remember,mobile,app_nonce,csrf_hash,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(hash(ticket), flow.role, flow.business_id,
      flow.slug, claims.sub, claims.email.trim().toLowerCase(),
      String(claims.name || claims.email.split('@')[0]).slice(0, 100),
      flow.remember, flow.mobile, flow.app_nonce, flow.csrf_hash, Date.now() + flowMs);
    res.setHeader('Cache-Control', 'no-store');
    if (flow.mobile) return res.redirect(303, `com.edupimentel.nayla://auth?ticket=${encodeURIComponent(ticket)}`);
    const destination = flow.role === 'owner' ? '/entrar' : `/agendar/${encodeURIComponent(flow.slug)}/entrar`;
    res.redirect(303, `${config.origin}${destination}?google_ticket=${encodeURIComponent(ticket)}`);
  });

  app.post('/api/auth/google/complete', options.rateLimit(15), (req, res) => {
    const role = z.enum(['owner', 'client']).parse(req.body?.role);
    const { row } = ticketForRequest(req, role);
    const user = existingBySubject(row);
    if (user) return res.json(finishTicket(req, res, row, user, options));
    const existingEmail = db.prepare(`SELECT 1 FROM users WHERE role=? AND email=?
      AND (role='owner' OR business_id=?)`).get(role, row.email, row.business_id);
    res.json({ registrationRequired: !existingEmail, passwordLinkRequired: Boolean(existingEmail),
      name: row.name, email: row.email });
  });

  app.post('/api/auth/google/link', options.rateLimit(5), async (req, res) => {
    const role = z.enum(['owner', 'client']).parse(req.body?.role);
    const { row } = ticketForRequest(req, role);
    const input = z.object({ password: z.string().min(1), identifier: z.string().optional() }).parse(req.body);
    const clientCpf = (input.identifier || '').replace(/\D/g, '');
    const user = role === 'owner'
      ? db.prepare("SELECT * FROM users WHERE role='owner' AND email=?").get(row.email) as Row | undefined
      : db.prepare(`SELECT * FROM users WHERE role='client' AND business_id=? AND cpf=?`)
        .get(row.business_id, clientCpf) as Row | undefined;
    if (!user || !await bcrypt.compare(input.password, user.password_hash))
      throw new GoogleAuthError(401, 'Confira a senha da conta para conectá-la ao Google.');
    if (user.google_subject && user.google_subject !== row.google_subject)
      throw new GoogleAuthError(409, 'Esta conta já está conectada a outro Google.');
    db.prepare('UPDATE users SET google_subject=? WHERE id=?').run(row.google_subject, user.id);
    res.json(finishTicket(req, res, row, user, options));
  });

  app.post('/api/auth/google/register', options.rateLimit(5), async (req, res) => {
    const role = z.enum(['owner', 'client']).parse(req.body?.role);
    const { row } = ticketForRequest(req, role);
    const strongPassword = z.string().min(12).max(100)
      .refine(value => /[A-Za-z]/.test(value) && /\d/.test(value));
    const common = z.object({ password: strongPassword });
    const customService = z.object({ name: z.string().trim().min(2).max(100), category: specialtySchema,
      price: z.number().finite().min(0).max(1_000_000), durationMinutes: z.number().int().min(15).max(480) });
    const details = role === 'owner'
      ? common.extend({ ownerName: z.string().trim().min(2).max(100),
          businessName: z.string().trim().min(2).max(100),
          slug: z.string().min(3).max(45).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
          specialties: z.array(specialtySchema).min(1).max(specialtyValues.length),
          selectedServices: z.array(z.string().min(1).max(160)).max(catalog.length),
          customServices: z.array(customService).max(10).default([]) }).parse(req.body)
      : common.extend({ name: z.string().trim().min(2).max(100),
          cpf: z.string().refine(validCpf, 'CPF inválido.'), phone: z.string().regex(/^\d{10,13}$/) }).parse(req.body);
    if (role === 'owner') {
      const ownerDetails = details as Extract<typeof details, { businessName: string }>;
      const selectedTemplates = new Set(ownerDetails.selectedServices);
      if (selectedTemplates.size !== ownerDetails.selectedServices.length ||
        catalog.some(item => selectedTemplates.has(item.id) && !ownerDetails.specialties.includes(item.category)) ||
        ownerDetails.selectedServices.some(serviceId => !catalog.some(item => item.id === serviceId)))
        throw new GoogleAuthError(400, 'Escolha apenas serviços das suas áreas de atuação.');
      if (ownerDetails.customServices.some(item => !ownerDetails.specialties.includes(item.category)))
        throw new GoogleAuthError(400, 'Escolha uma das suas áreas para cada serviço personalizado.');
      const normalizedName = (name: string) => name.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
      const customNames = ownerDetails.customServices.map(item => `${item.category}:${normalizedName(item.name)}`);
      if (new Set(customNames).size !== customNames.length ||
        ownerDetails.customServices.some(item => catalog.some(template =>
          template.category === item.category && normalizedName(template.name) === normalizedName(item.name))))
        throw new GoogleAuthError(400, 'Cada serviço personalizado precisa ter um nome diferente dos serviços da área.');
      if (!selectedTemplates.size && !ownerDetails.customServices.length)
        throw new GoogleAuthError(400, 'Escolha pelo menos um serviço que você oferece.');
    }
    const passwordHash = await bcrypt.hash(details.password, 12);
    const userId = id();
    db.transaction(() => {
      if (existingBySubject(row)) throw new GoogleAuthError(409, 'Essa conta Google já está cadastrada.');
      if (role === 'owner') {
        const ownerDetails = details as Extract<typeof details, { businessName: string }>;
        if (db.prepare("SELECT 1 FROM users WHERE role='owner' AND email=?").get(row.email))
          throw new GoogleAuthError(409, 'Este e-mail já tem conta. Conecte-a com sua senha.');
        const businessId = id();
        db.prepare('INSERT INTO businesses(id,slug,name,specialties) VALUES(?,?,?,?)')
          .run(businessId, ownerDetails.slug, ownerDetails.businessName,
            JSON.stringify([...new Set(ownerDetails.specialties)]));
        db.prepare(`INSERT INTO users(id,business_id,role,name,email,password_hash,google_subject)
          VALUES(?,?,'owner',?,?,?,?)`).run(userId, businessId, ownerDetails.ownerName,
            row.email, passwordHash, row.google_subject);
        const selectedTemplates = new Set(ownerDetails.selectedServices);
        const addService = db.prepare(`INSERT INTO services(id,business_id,name,category,duration_minutes,price_cents,active)
          VALUES(?,?,?,?,?,?,?)`);
        for (const item of catalog.filter(item => ownerDetails.specialties.includes(item.category)))
          addService.run(id(), businessId, item.name, item.category, item.durationMinutes,
            toCents(item.price), Number(selectedTemplates.has(item.id)));
        for (const item of ownerDetails.customServices)
          addService.run(id(), businessId, item.name, item.category, item.durationMinutes,
            toCents(item.price), 1);
      } else {
        const clientDetails = details as Extract<typeof details, { cpf: string }>;
        if (db.prepare(`SELECT 1 FROM users WHERE role='client' AND business_id=?
          AND (email=? OR cpf=? OR phone=?)`).get(row.business_id, row.email,
            clientDetails.cpf, clientDetails.phone))
          throw new GoogleAuthError(409, 'Seus dados já estão cadastrados aqui. Entre com CPF e senha para conectar o Google.');
        db.prepare(`INSERT INTO users(id,business_id,role,name,email,phone,cpf,password_hash,google_subject)
          VALUES(?,?,'client',?,?,?,?,?,?)`).run(userId, row.business_id, clientDetails.name,
            row.email, clientDetails.phone, clientDetails.cpf, passwordHash, row.google_subject);
      }
    }).immediate();
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId) as Row;
    res.status(201).json(finishTicket(req, res, row, user, options));
  });
}
