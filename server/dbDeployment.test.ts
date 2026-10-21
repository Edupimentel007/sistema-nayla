import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const projectRoot = resolve('.');

function temporaryDirectory(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), 'nayla-db-deployment-'));
  t.after(() => {
    const tempRoot = resolve(tmpdir()) + sep;
    assert.ok(resolve(directory).startsWith(tempRoot));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test('recusa SQLite local em Vercel Functions antes de criar dados', t => {
  const directory = temporaryDirectory(t);
  const databasePath = join(directory, 'descartavel.db');
  const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', "import('./server/db.ts')"], {
    cwd: projectRoot,
    env: { ...process.env, VERCEL: '1', DATABASE_PATH: databasePath },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /A API Nayla usa SQLite local/);
  assert.equal(existsSync(databasePath), false);
});

test('backup inclui transacoes confirmadas ainda no WAL e nao sobrescreve destino', t => {
  const directory = temporaryDirectory(t);
  const sourcePath = join(directory, 'origem.db');
  const destinationPath = join(directory, 'copia.db');
  const source = new Database(sourcePath);
  try {
    source.pragma('journal_mode = WAL');
    source.exec('CREATE TABLE exemplo (id INTEGER PRIMARY KEY, valor TEXT NOT NULL)');
    source.prepare('INSERT INTO exemplo (valor) VALUES (?)').run('registro ainda no WAL');
    assert.equal(existsSync(`${sourcePath}-wal`), true);

    const command = ['scripts/backup-sqlite.mjs', sourcePath, destinationPath];
    const backup = spawnSync(process.execPath, command, { cwd: projectRoot, encoding: 'utf8' });
    assert.equal(backup.status, 0, backup.stderr);
    const report = JSON.parse(backup.stdout) as { sha256: string; tables: Record<string, number> };
    assert.match(report.sha256, /^[0-9a-f]{64}$/);
    assert.equal(report.tables.exemplo, 1);

    const copy = new Database(destinationPath, { readonly: true, fileMustExist: true });
    try {
      assert.equal((copy.prepare('SELECT valor FROM exemplo').get() as { valor: string }).valor,
        'registro ainda no WAL');
      assert.deepEqual(copy.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
    } finally {
      copy.close();
    }

    const duplicate = spawnSync(process.execPath, command, { cwd: projectRoot, encoding: 'utf8' });
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /ja existe/);
  } finally {
    source.close();
  }
});
