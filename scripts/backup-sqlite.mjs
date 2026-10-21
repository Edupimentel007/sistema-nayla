import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync, createReadStream, existsSync, linkSync, mkdirSync,
  statSync, unlinkSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

// Usage: node scripts/backup-sqlite.mjs <source.db> <new-backup.db>
// SQLite's backup API includes committed rows still present in the WAL file.
const [sourceArgument, destinationArgument, ...extra] = process.argv.slice(2);
if (!sourceArgument || !destinationArgument || extra.length) {
  console.error('Uso: node scripts/backup-sqlite.mjs <banco-origem> <novo-backup.db>');
  process.exitCode = 2;
} else {
  try {
    const sourcePath = resolve(sourceArgument);
    const destinationPath = resolve(destinationArgument);
    if (sourcePath === destinationPath) throw new Error('Origem e destino devem ser diferentes.');
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile())
      throw new Error('Banco de origem nao encontrado. Nenhum banco novo foi criado.');
    if (existsSync(destinationPath))
      throw new Error('O arquivo de destino ja existe. Escolha um novo nome para nao sobrescrever um backup.');

    mkdirSync(dirname(destinationPath), { recursive: true, mode: 0o700 });
    const temporaryPath = join(dirname(destinationPath),
      `.${basename(destinationPath)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
    const previousUmask = process.umask(0o077);
    let sourceDb;
    let snapshotDb;
    try {
      sourceDb = new Database(sourcePath, { readonly: true, fileMustExist: true });
      await sourceDb.backup(temporaryPath);
      sourceDb.close();
      sourceDb = undefined;

      snapshotDb = new Database(temporaryPath, { fileMustExist: true });
      snapshotDb.pragma('journal_mode = WAL');
      const integrity = snapshotDb.pragma('integrity_check');
      if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok')
        throw new Error('A copia falhou no PRAGMA integrity_check.');
      const foreignKeyErrors = snapshotDb.pragma('foreign_key_check');
      if (foreignKeyErrors.length)
        throw new Error(`A copia contem ${foreignKeyErrors.length} violacao(oes) de chave estrangeira.`);

      const tables = {};
      for (const { name } of snapshotDb.prepare(`SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all()) {
        const quotedName = `"${name.replaceAll('"', '""')}"`;
        tables[name] = snapshotDb.prepare(`SELECT COUNT(*) AS total FROM ${quotedName}`).get().total;
      }
      snapshotDb.pragma('wal_checkpoint(TRUNCATE)');
      snapshotDb.close();
      snapshotDb = undefined;

      // The temporary file is adjacent to the destination; creating the hard
      // link is atomic and fails if a backup with that name appeared meanwhile.
      chmodSync(temporaryPath, 0o600);
      linkSync(temporaryPath, destinationPath);
      unlinkSync(temporaryPath);

      const hash = createHash('sha256');
      for await (const chunk of createReadStream(destinationPath)) hash.update(chunk);
      console.log(JSON.stringify({
        backup: destinationPath,
        bytes: statSync(destinationPath).size,
        sha256: hash.digest('hex'),
        tables,
      }, null, 2));
    } finally {
      sourceDb?.close();
      snapshotDb?.close();
      for (const suffix of ['', '-wal', '-shm']) {
        try { unlinkSync(temporaryPath + suffix); } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      process.umask(previousUmask);
    }
  } catch (error) {
    console.error(`Falha no backup: ${error.message}`);
    process.exitCode = 1;
  }
}
