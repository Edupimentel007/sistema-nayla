import { randomBytes } from 'node:crypto';
import { lstat, readFile, rename, unlink, writeFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
const setting = 'ACCESS_IDENTITY_SECRET';

try {
  const stats = await lstat(envPath);
  if (!stats.isFile()) throw new Error('.env precisa ser um arquivo regular.');
  const original = await readFile(envPath, 'utf8');
  const matches = original.split(/\r?\n/).filter(line => line.startsWith(`${setting}=`));
  if (matches.length > 1) throw new Error('Remova entradas duplicadas de ACCESS_IDENTITY_SECRET do .env.');
  if (matches.length === 1 && matches[0] !== `${setting}=`) {
    const value = matches[0].slice(setting.length + 1);
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length !== 32 || decoded.toString('base64') !== value)
      throw new Error('ACCESS_IDENTITY_SECRET existente é inválido. Corrija-o sem trocar um segredo de produção em uso.');
    console.log('Segredo de identidade já configurado. Nenhum arquivo foi alterado.');
  } else {
    const secret = randomBytes(32).toString('base64');
    const lines = original.split(/\r?\n/).filter(line => !line.startsWith(`${setting}=`));
    const clean = lines.join('\n').trimEnd();
    const updated = `${clean ? `${clean}\n` : ''}${setting}=${secret}\n`;
    const temporary = resolve(process.cwd(), `.env.${randomBytes(8).toString('hex')}.tmp`);
    try {
      await writeFile(temporary, updated, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temporary, envPath);
      if (process.platform !== 'win32') await chmod(envPath, 0o600);
    } finally {
      await unlink(temporary).catch(error => { if (error?.code !== 'ENOENT') throw error; });
    }
    console.log('Segredo local gerado no .env sem exibir o valor. Guarde-o em backup seguro.');
  }
} catch (error) {
  console.error(error?.code === 'ENOENT'
    ? 'Crie primeiro o .env a partir de .env.example.'
    : error instanceof Error ? error.message : 'Não foi possível configurar o segredo.');
  process.exitCode = 1;
}
