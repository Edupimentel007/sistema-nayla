import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, unlink, lstat, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

export const groqModel = 'openai/gpt-oss-120b';
const envPath = resolve(process.cwd(), '.env');

export async function currentEnv() {
  try {
    const stats = await lstat(envPath);
    if (!stats.isFile()) throw new Error('.env precisa ser um arquivo regular.');
    const content = await readFile(envPath, 'utf8');
    return { content, values: parse(content) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { content: '', values: {} };
    throw error;
  }
}

export async function verifyGroqKey(key) {
  if (!/^[A-Za-z0-9_-]{12,256}$/.test(key))
    throw new Error('Formato da chave inválido. Confira a chave na Groq Console.');
  let response;
  try {
    response = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('Não foi possível acessar a Groq por HTTPS. Confira a conexão e tente novamente.');
  }
  if (!response.ok) {
    if ([401, 403].includes(response.status))
      throw new Error('A Groq recusou a chave. Gere outra chave no projeto correto.');
    throw new Error(`A Groq não confirmou a chave (HTTP ${response.status}).`);
  }
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('A Groq retornou uma resposta inválida. Tente novamente.'); }
  if (!Array.isArray(payload.data) || !payload.data.some(item => item.id === groqModel))
    throw new Error(`A conta não disponibiliza o modelo ${groqModel}. Confira o projeto e o plano.`);
}

export async function saveGroqKey(key, content) {
  const clean = content.split(/\r?\n/).filter(line =>
    !/^(?:AI_PROVIDER|GROQ_API_KEY|GROQ_MODEL)=/.test(line)).join('\n').trimEnd();
  const updated = `${clean ? `${clean}\n` : ''}AI_PROVIDER=groq\nGROQ_API_KEY=${key}\nGROQ_MODEL=${groqModel}\n`;
  const temporary = resolve(process.cwd(), `.env.${randomBytes(8).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, updated, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, envPath);
    if (process.platform !== 'win32') await chmod(envPath, 0o600);
  } finally {
    await unlink(temporary).catch(error => { if (error?.code !== 'ENOENT') throw error; });
  }
}
