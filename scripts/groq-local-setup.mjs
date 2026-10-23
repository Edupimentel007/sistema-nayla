import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { currentEnv, groqModel, saveGroqKey, verifyGroqKey } from './groq-setup-core.mjs';

const maxBodyBytes = 4096;
const lifetimeMs = 15 * 60_000;
const maxAttempts = 5;

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function document(content) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Configurar IA · Nayla</title><style>
  :root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#fff9fb;color:#242026}
  *{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:20px}
  main{width:min(100%,440px);padding:36px;background:#fff;border:1px solid #f4dce6;border-radius:22px;box-shadow:0 18px 50px #5e234618}
  .mark{display:inline-block;font-size:14px;font-weight:800;letter-spacing:.18em;color:#9c315d}
  h1{font-size:25px;line-height:1.15;margin:22px 0 10px}p{color:#685e66;line-height:1.55;font-size:14px}
  label{display:block;margin:25px 0 9px;font-weight:700;font-size:13px}input{width:100%;padding:13px 14px;border:1px solid #d5c8d0;border-radius:10px;font:inherit}
  input:focus{outline:2px solid #c34e81;outline-offset:2px}button{width:100%;margin-top:18px;padding:13px;border:0;border-radius:10px;background:#a82d62;color:#fff;font:inherit;font-weight:700;cursor:pointer}
  button:hover{background:#87234e}.note{font-size:12px}.alert{padding:12px;border-radius:10px;background:#fff0f4;color:#8b214b;font-weight:600}
  .success{padding:12px;border-radius:10px;background:#e9f7ee;color:#21633c;font-weight:700}
  </style></head><body><main><span class="mark">NAYLA</span>${content}</main></body></html>`;
}

function formPage(csrf, message = '') {
  return document(`<h1>Conectar a assistente à Groq</h1><p>Cole sua chave nesta página local do seu computador. Ela será verificada diretamente com a Groq e guardada apenas no arquivo <code>.env</code> da Nayla.</p>
    ${message ? `<p class="alert" role="alert">${htmlEscape(message)}</p>` : ''}
    <form method="post" action="/configure" autocomplete="off"><input type="hidden" name="csrf" value="${csrf}"><label for="key">Chave da API Groq</label>
    <input id="key" name="key" type="password" required minlength="12" maxlength="256" autocomplete="off" spellcheck="false" autocapitalize="none" autofocus>
    <button type="submit">Verificar e conectar</button></form><p class="note">A chave não aparece na URL nem é enviada para esta conversa. Esta página fecha após a configuração ou 15 minutos.</p>`);
}

function sendHtml(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.end(body);
}

function sameToken(input, expected) {
  if (typeof input !== 'string' || !/^[a-f0-9]{64}$/.test(input)) return false;
  return timingSafeEqual(Buffer.from(input, 'hex'), Buffer.from(expected, 'hex'));
}

async function readForm(req) {
  let bytes = 0;
  const parts = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) throw new Error('Solicitação muito grande.');
    parts.push(chunk);
  }
  const params = new URLSearchParams(Buffer.concat(parts).toString('utf8'));
  if (params.getAll('csrf').length !== 1 || params.getAll('key').length !== 1)
    throw new Error('Formulário inválido. Atualize a página e tente novamente.');
  return { csrf: params.get('csrf'), key: params.get('key') };
}

export async function startGroqLocalSetup({
  verify = verifyGroqKey,
  save = async key => { const existing = await currentEnv(); await saveGroqKey(key, existing.content); },
  lifetime = lifetimeMs,
  onSuccess = () => process.stdout.write('Groq configurada no .env local. Chave não exibida.\n'),
} = {}) {
  const csrf = randomBytes(32).toString('hex');
  let attempts = 0;
  let busy = false;
  let done = false;
  let origin = '';
  let timer;
  const server = createServer(async (req, res) => {
    if (req.headers.host !== origin.slice('http://'.length)) {
      sendHtml(res, 403, document('<h1>Acesso negado</h1>'));
      return;
    }
    if (done) {
      sendHtml(res, 410, document('<h1>Configuração concluída</h1>'));
      return;
    }
    if (req.method === 'GET' && req.url === '/') {
      sendHtml(res, 200, formPage(csrf));
      return;
    }
    if (req.method !== 'POST' || req.url !== '/configure') {
      sendHtml(res, 404, document('<h1>Página não encontrada</h1>'));
      return;
    }
    // Some embedded browsers omit Origin on same-origin HTML form posts. The
    // one-time token and exact Host check still prevent cross-site submissions.
    const requestOrigin = req.headers.origin;
    if ((requestOrigin && requestOrigin !== origin && requestOrigin !== 'null') ||
        req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') {
      sendHtml(res, 403, document('<h1>Acesso negado</h1>'));
      return;
    }
    if (attempts >= maxAttempts || busy) {
      sendHtml(res, 429, formPage(csrf, 'Limite de tentativas ou verificação em andamento.'));
      return;
    }
    let input;
    try { input = await readForm(req); }
    catch (error) {
      sendHtml(res, 400, formPage(csrf, error instanceof Error ? error.message : 'Formulário inválido.'));
      return;
    }
    if (!sameToken(input.csrf, csrf)) {
      sendHtml(res, 403, document('<h1>Acesso negado</h1>'));
      return;
    }
    attempts++;
    busy = true;
    try {
      await verify(input.key);
      await save(input.key);
      done = true;
      sendHtml(res, 200, document(`<h1>Groq conectada</h1><p class="success">A Nayla está configurada para usar ${htmlEscape(groqModel)}.</p><p>Avise nesta conversa que a página confirmou a conexão. Vou reiniciar o servidor local para ativar a IA.</p>`));
      onSuccess();
      setTimeout(() => { server.closeAllConnections(); server.close(); }, 1500).unref();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível verificar a chave.';
      sendHtml(res, 400, formPage(csrf, message));
    } finally {
      busy = false;
    }
  });
  try {
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', resolveListen);
    });
  } catch (error) {
    server.close();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Endereço local indisponível.');
  origin = `http://127.0.0.1:${address.port}`;
  timer = setTimeout(() => {
    process.stdout.write('Página local da Groq expirada.\n');
    server.closeAllConnections();
    server.close();
  }, lifetime);
  timer.unref();
  server.on('close', () => clearTimeout(timer));
  return { url: `${origin}/`, server };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { url } = await startGroqLocalSetup();
    console.log(`Abra esta página no mesmo computador: ${url}`);
  } catch {
    console.error('Não foi possível iniciar a configuração local da Groq.');
    process.exitCode = 1;
  }
}
