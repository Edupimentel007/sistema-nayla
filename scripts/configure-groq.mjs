import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, unlink, lstat, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

const model = 'openai/gpt-oss-120b';
const envPath = resolve(process.cwd(), '.env');
const checkOnly = process.argv.includes('--check');

async function currentEnv() {
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

function hiddenKeyPrompt() {
  return new Promise((resolveKey, reject) => {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) {
      reject(new Error('Abra um terminal interativo ou configure GROQ_API_KEY no ambiente.'));
      return;
    }
    let value = '';
    const wasRaw = Boolean(process.stdin.isRaw);
    const finish = (error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolveKey(value);
    };
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === '\u0003' || character === '\u001b') {
          finish(new Error('Configuração cancelada.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= '!' && character <= '~' && value.length < 256) value += character;
      }
    };
    process.stdout.write('Cole sua chave Groq e pressione Enter (entrada oculta): ');
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

async function verify(key) {
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
  const payload = await response.json();
  if (!Array.isArray(payload.data) || !payload.data.some(item => item.id === model))
    throw new Error(`A conta não disponibiliza o modelo ${model}. Confira o projeto e o plano.`);
}

async function save(key, content) {
  const clean = content.split(/\r?\n/).filter(line =>
    !/^(?:AI_PROVIDER|GROQ_API_KEY|GROQ_MODEL)=/.test(line)).join('\n').trimEnd();
  const updated = `${clean ? `${clean}\n` : ''}AI_PROVIDER=groq\nGROQ_API_KEY=${key}\nGROQ_MODEL=${model}\n`;
  const temporary = resolve(process.cwd(), `.env.${randomBytes(8).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, updated, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, envPath);
    if (process.platform !== 'win32') await chmod(envPath, 0o600);
  } finally {
    await unlink(temporary).catch(error => { if (error?.code !== 'ENOENT') throw error; });
  }
}

try {
  const existing = await currentEnv();
  const key = process.env.GROQ_API_KEY || existing.values.GROQ_API_KEY ||
    (checkOnly ? '' : await hiddenKeyPrompt());
  if (!key) throw new Error('Chave ausente. Crie uma em https://console.groq.com/keys.');
  await verify(key);
  if (!checkOnly) await save(key, existing.content);
  console.log(checkOnly
    ? `Groq respondeu e disponibiliza ${model}. Nenhum arquivo foi alterado.`
    : `Groq configurada no .env local com ${model}. A chave não foi exibida.`);
  console.log('Ative Zero Data Retention na Groq Console em Data Controls.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha na configuração da Groq.');
  process.exitCode = 1;
}
