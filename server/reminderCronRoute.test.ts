import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('the HTTP reminder route requires the cron secret and runs a sweep', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nayla-reminder-route-'));
  const previousPath = process.env.DATABASE_PATH;
  const previousSecret = process.env.CRON_SECRET;
  const secret = 'nayla-route-test-secret-with-at-least-32-characters';
  process.env.DATABASE_PATH = join(directory, 'nayla.sqlite');
  process.env.CRON_SECRET = secret;

  const { app } = await import('./index.js');
  const { db } = await import('./db.js');
  const server = createServer(app);
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/api/internal/reminders`;

    const unauthorized = await fetch(url);
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), { ok: false, error: 'Não autorizado.' });

    const authorized = await fetch(url, { headers: { authorization: `Bearer ${secret}` } });
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), { ok: true, queued: 0, processed: 0 });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
    rmSync(directory, { recursive: true, force: true });
  }
});
