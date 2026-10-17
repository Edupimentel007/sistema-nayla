import type { NextFunction, Request, Response } from 'express';

const nativeOrigins = new Set(['capacitor://localhost', 'https://localhost']);
const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function appOrigin() {
  const raw = process.env.APP_ORIGIN?.trim().replace(/\/$/, '');
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.origin === raw && !parsed.username && !parsed.password ? parsed.origin : null;
  } catch { return null; }
}

export function assertProductionSecurityConfiguration() {
  if (process.env.NODE_ENV !== 'production') return;
  const origin = appOrigin();
  if (!origin?.startsWith('https://'))
    throw new Error('APP_ORIGIN precisa ser uma origem HTTPS válida em produção.');
}

function trustedNativeRequest(req: Request) {
  return nativeOrigins.has(req.get('origin') || '') &&
    (req.get('x-nayla-app') === 'mobile' || /^Bearer [a-f0-9]{64}$/.test(req.get('authorization') || ''));
}

// Protect cookie-authenticated browser mutations. Capacitor uses a bearer token from
// secure storage and its known WebView origin, so it has a separate allowed path.
export function browserRequestGuard(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith('/api/') || !unsafeMethods.has(req.method) ||
    req.path.startsWith('/api/webhooks/')) return next();
  if (trustedNativeRequest(req)) return next();

  const site = req.get('sec-fetch-site');
  if (site === 'cross-site')
    return res.status(403).json({ error: 'Origem não permitida.' });

  const origin = req.get('origin');
  const expected = appOrigin();
  // In production, the configured origin is authoritative. This avoids Host
  // header poisoning being mistaken for a trusted same-origin request.
  const allowedOrigins = process.env.NODE_ENV === 'production'
    ? [expected] : [expected, `${req.protocol}://${req.get('host')}`];
  if (origin && !allowedOrigins.includes(origin))
    return res.status(403).json({ error: 'Origem não permitida.' });

  // Browsers normally send Origin for mutations. The referer is a fallback for
  // clients that omit it. Requests with neither header are kept for native/API
  // clients and integration tests; SameSite cookies also limit browser CSRF.
  const referer = req.get('referer');
  if (!origin && referer) {
    try {
      if (!allowedOrigins.includes(new URL(referer).origin))
        return res.status(403).json({ error: 'Origem não permitida.' });
    } catch { return res.status(403).json({ error: 'Origem não permitida.' }); }
  }
  next();
}

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
].join('; ');

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  else res.setHeader('Content-Security-Policy', contentSecurityPolicy);
  if (process.env.NODE_ENV === 'production' && req.secure)
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
}
