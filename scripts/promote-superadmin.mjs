import 'dotenv/config';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || process.argv.length !== 3) {
  process.stderr.write('Uso: npm run admin:promote -- email@exemplo.com\n');
  process.exit(1);
}
if (!stdin.isTTY || !stdout.isTTY) {
  process.stderr.write('Execute em um terminal interativo local.\n');
  process.exit(1);
}

const path = resolve(process.env.DATABASE_PATH || resolve('database/nayla.sqlite'));
if (!existsSync(path)) {
  process.stderr.write('Banco da Nayla não encontrado. Crie e acesse sua conta antes de promover.\n');
  process.exit(1);
}
const db = new Database(path, { fileMustExist: true });

function hiddenPassword(prompt) {
  return new Promise((resolvePassword, reject) => {
    stdout.write(prompt);
    let value = '';
    const previousRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    const finish = (error) => {
      stdin.off('data', onData);
      stdin.setRawMode(Boolean(previousRaw));
      stdout.write('\n');
      if (error) reject(error);
      else resolvePassword(value);
    };
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u0003') return finish(new Error('Operação cancelada.'));
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ' && value.length < 200) value += character;
      }
    };
    stdin.on('data', onData);
  });
}

try {
  const user = db.prepare("SELECT id,password_hash FROM users WHERE role='owner' AND email=?")
    .get(email);
  if (!user) throw new Error('Conta profissional não encontrada para este e-mail.');
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='super_admin_accounts'")
    .get();
  if (!table) throw new Error('Atualize a API Nayla antes de promover o administrador.');
  const password = await hiddenPassword('Senha atual da conta (oculta): ');
  if (!await bcrypt.compare(password, user.password_hash))
    throw new Error('Senha incorreta. Promoção cancelada.');
  const terminal = createInterface({ input: stdin, output: stdout });
  const confirmation = await terminal.question(`Promover ${email} a superadministrador? Digite PROMOVER: `);
  terminal.close();
  if (confirmation !== 'PROMOVER') throw new Error('Confirmação não recebida.');
  db.prepare('INSERT OR IGNORE INTO super_admin_accounts(user_id) VALUES(?)').run(user.id);
  stdout.write('Superadministrador ativado. Faça login novamente e abra /superadmin.\n');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Falha ao promover conta.'}\n`);
  process.exitCode = 1;
} finally {
  db.close();
}
