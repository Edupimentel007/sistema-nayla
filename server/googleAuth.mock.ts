// Test-only Google endpoints. Loaded only by googleAuth.test.ts's child process.
import { createSign, generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'nayla-test-key', alg: 'RS256', use: 'sig' };
const actualFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url === 'https://www.googleapis.com/oauth2/v3/certs')
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
  if (url === 'https://oauth2.googleapis.com/token') {
    const form = new URLSearchParams(String(init?.body || ''));
    const code = form.get('code') || '';
    if (!form.get('code_verifier') || form.get('grant_type') !== 'authorization_code')
      return new Response('{}', { status: 400 });
    let account: { nonce: string; sub: string; email: string; name: string };
    try { account = JSON.parse(Buffer.from(code, 'base64url').toString('utf8')); }
    catch { return new Response('{}', { status: 400 }); }
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'nayla-test-key', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com',
      aud: form.get('client_id'), exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000), nonce: account.nonce, sub: account.sub,
      email: account.email, email_verified: true, name: account.name })).toString('base64url');
    const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey).toString('base64url');
    return new Response(JSON.stringify({ id_token: `${header}.${payload}.${signature}` }), { status: 200,
      headers: { 'Content-Type': 'application/json' } });
  }
  return actualFetch(input, init);
}) as typeof fetch;
