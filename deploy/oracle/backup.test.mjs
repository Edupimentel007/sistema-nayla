import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import Database from 'better-sqlite3';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

test('scheduled backup includes committed writes still in SQLite WAL', t => {
  const directory = mkdtempSync(join(tmpdir(), 'nayla-oracle-backup-'));
  const sourcePath = join(directory, 'source.sqlite');
  const backupDirectory = join(directory, 'backups');
  const source = new Database(sourcePath);
  t.after(() => {
    source.close();
    rmSync(directory, { recursive: true, force: true });
  });
  source.pragma('journal_mode = WAL');
  source.exec("CREATE TABLE sample (value TEXT NOT NULL); INSERT INTO sample VALUES ('preserved');");

  const run = spawnSync(process.execPath, ['deploy/oracle/backup.mjs'], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_PATH: sourcePath, BACKUP_DIR: backupDirectory },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const files = readdirSync(backupDirectory);
  assert.equal(files.length, 1);
  const snapshot = new Database(join(backupDirectory, files[0]), { readonly: true });
  try {
    assert.equal(snapshot.prepare('SELECT value FROM sample').get()?.value, 'preserved');
    assert.deepEqual(snapshot.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
  } finally {
    snapshot.close();
  }
});
