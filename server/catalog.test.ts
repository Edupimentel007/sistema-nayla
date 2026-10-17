import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { catalog, specialtyValues } from './catalog.js';

describe('catálogo de especialidades', () => {
  it('has unique template IDs and a manual category for other beauty services', () => {
    assert.equal(new Set(catalog.map(item => item.id)).size, catalog.length);
    for (const specialty of specialtyValues.filter(value => value !== 'outros'))
      assert.ok(catalog.some(item => item.category === specialty), specialty);
    assert.equal(catalog.some(item => item.category === 'outros'), false);
  });

  it('migrates old service categories without losing historical appointments', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nayla-catalog-migration-'));
    const path = join(directory, 'legacy.sqlite');
    try {
      const oldDb = new Database(path);
      const schema = readFileSync(resolve('database/schema.sql'), 'utf8');
      const oldSchema = schema.replace(
        /category TEXT NOT NULL CHECK \(category IN \([\s\S]*?'outros'\)\)/,
        "category TEXT NOT NULL CHECK (category IN ('unhas','sobrancelhas','cilios','outros'))",
      );
      assert.notEqual(schema, oldSchema);
      oldDb.exec(oldSchema);
      oldDb.prepare("INSERT INTO businesses(id,slug,name,specialties) VALUES('b1','legacy-studio','Legacy','[\"unhas\"]')").run();
      oldDb.prepare("INSERT INTO users(id,business_id,role,name,password_hash) VALUES('c1','b1','client','Cliente','hash')").run();
      oldDb.prepare("INSERT INTO services(id,business_id,name,category,duration_minutes,price_cents) VALUES('s1','b1','Manicure','unhas',60,5000)").run();
      oldDb.prepare("INSERT INTO appointments(id,business_id,client_id,service_id,date,start_time,end_time,price_cents) VALUES('a1','b1','c1','s1','2026-10-20','09:00','10:00',5000)").run();
      oldDb.close();

      execFileSync(process.execPath, ['--import', 'tsx', '-e', "import('./server/db.ts')"], {
        cwd: resolve('.'), env: { ...process.env, DATABASE_PATH: path }, timeout: 20_000,
      });

      const migrated = new Database(path);
      migrated.pragma('foreign_keys = ON');
      assert.deepEqual(migrated.pragma('foreign_key_check'), []);
      const historical = migrated.prepare(`SELECT a.id AS appointment_id,s.id AS service_id,s.category
        FROM appointments a JOIN services s ON s.id=a.service_id WHERE a.id='a1'`).get();
      assert.deepEqual(historical, { appointment_id: 'a1', service_id: 's1', category: 'unhas' });
      migrated.prepare("INSERT INTO services(id,business_id,name,category,duration_minutes,price_cents) VALUES('s2','b1','Maquiagem social','maquiagem',60,10000)").run();
      migrated.close();
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  });
});
