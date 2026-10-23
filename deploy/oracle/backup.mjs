import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const source = process.env.DATABASE_PATH;
const directory = process.env.BACKUP_DIR;
if (!source || !directory) {
  console.error('Configure DATABASE_PATH e BACKUP_DIR no ambiente da Nayla.');
  process.exit(1);
}

const databasePath = resolve(source);
const backupDirectory = resolve(directory);
if (!existsSync(databasePath)) {
  console.error('Banco de origem inexistente. Backup cancelado.');
  process.exit(1);
}

mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
const timestamp = new Date().toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const filename = `nayla-${timestamp}-${randomBytes(4).toString('hex')}.db`;
const backup = resolve(backupDirectory, filename);
const child = spawn(process.execPath,
  [resolve('scripts/backup-sqlite.mjs'), databasePath, backup],
  { stdio: 'inherit' });
child.on('error', () => {
  console.error('Não foi possível iniciar o backup da Nayla.');
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
});
