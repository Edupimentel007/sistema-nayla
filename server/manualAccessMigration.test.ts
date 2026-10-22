import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';

describe('manual access migration', () => {
  it('preserves an existing trial and paid period, without giving pending owners a new trial', () => {
    const directory = mkdtempSync(join(tmpdir(),'nayla-access-migrate-'));
    const path = join(directory,'nayla.sqlite');
    try {
      const db = new Database(path);
      db.exec(readFileSync(resolve('database/schema.sql'),'utf8'));
      db.exec(`CREATE TABLE business_billing (
        business_id TEXT PRIMARY KEY,
        onboarding_completed INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'none',
        current_period_end TEXT,
        trial_started_at INTEGER
      )`);
      const now = Date.now();
      const business = db.prepare(`INSERT INTO businesses(id,slug,name) VALUES(?,?,?)`);
      const owner = db.prepare(`INSERT INTO users(id,business_id,role,name,email,password_hash)
        VALUES(?,?,'owner',?,?,?)`);
      for (const id of ['trial','paid','pending','expired','expired-paid']) {
        business.run(id,id,id);
        owner.run(`owner-${id}`,id,id,`${id}@example.test`,'hash');
      }
      db.prepare(`INSERT INTO business_billing
        (business_id,onboarding_completed,status,trial_started_at) VALUES(?,1,'none',?)`)
        .run('trial',now-5*86_400_000);
      db.prepare(`INSERT INTO business_billing
        (business_id,onboarding_completed,status,current_period_end) VALUES(?,1,'active',?)`)
        .run('paid',new Date(now+20*86_400_000).toISOString());
      db.prepare(`INSERT INTO business_billing
        (business_id,onboarding_completed,status,trial_started_at) VALUES(?,1,'none',?)`)
        .run('expired',now-40*86_400_000);
      db.prepare(`INSERT INTO business_billing
        (business_id,onboarding_completed,status,current_period_end) VALUES(?,1,'past_due',?)`)
        .run('expired-paid',new Date(now-10*86_400_000).toISOString());
      db.close();
      execFileSync(process.execPath,['--import','tsx','-e',"import('./server/db.ts')"],{
        cwd:resolve('.'),env:{...process.env,DATABASE_PATH:path,NODE_ENV:'test'},
        stdio:'pipe',timeout:20_000,
      });
      const result = new Database(path,{readonly:true});
      try {
        const access = result.prepare('SELECT * FROM business_access WHERE business_id=?');
        const trial = access.get('trial') as Record<string,any>;
        const paid = access.get('paid') as Record<string,any>;
        const expired = access.get('expired') as Record<string,any>;
        const expiredPaid = access.get('expired-paid') as Record<string,any>;
        assert.equal(trial.state,'trial');
        assert.equal(trial.onboarding_completed,1);
        assert.ok(trial.access_ends_at>now);
        assert.equal(paid.state,'active');
        assert.ok(paid.access_ends_at>now);
        assert.equal(expired.state,'trial');
        assert.ok(expired.access_ends_at<now);
        assert.equal(expiredPaid.state,'active');
        assert.ok(expiredPaid.access_ends_at<now);
        assert.equal(expiredPaid.trial_started_at,null);
        assert.equal(access.get('pending'),undefined);
      } finally {result.close();}
    } finally {
      if (directory.startsWith(join(tmpdir(),'nayla-access-migrate-')))
        rmSync(directory,{recursive:true,force:true,maxRetries:3,retryDelay:200});
    }
  });
});
