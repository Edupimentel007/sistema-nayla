import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { handleReminderCron } from './reminderCron.js';

const previousSecret = process.env.CRON_SECRET;
const secret = 'nayla-reminder-cron-secret-for-tests-123456789';

after(() => {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
});

describe('authenticated reminder cron', () => {
  it('fails closed when the secret is missing or weak', async () => {
    let calls = 0;
    const sweep = async () => { calls++; return { queued: 1, processed: 1 }; };
    delete process.env.CRON_SECRET;
    assert.equal((await handleReminderCron({ method: 'GET', authorization: `Bearer ${secret}` }, sweep)).status, 503);
    process.env.CRON_SECRET = 'short';
    assert.equal((await handleReminderCron({ method: 'GET', authorization: `Bearer ${secret}` }, sweep)).status, 503);
    assert.equal(calls, 0);
  });

  it('rejects unauthenticated and non-GET requests before running the sweep', async () => {
    process.env.CRON_SECRET = secret;
    let calls = 0;
    const sweep = async () => { calls++; return { queued: 1, processed: 1 }; };
    assert.equal((await handleReminderCron({ method: 'POST', authorization: `Bearer ${secret}` }, sweep)).status, 405);
    assert.equal((await handleReminderCron({ method: 'GET' }, sweep)).status, 401);
    assert.equal((await handleReminderCron({ method: 'GET', authorization: `Bearer ${secret}wrong` }, sweep)).status, 401);
    assert.equal((await handleReminderCron({ method: 'GET', authorization: `Bearer ${secret} ` }, sweep)).status, 401);
    assert.equal(calls, 0);
  });

  it('runs an authorized sweep and reports failures without disclosing internals', async () => {
    process.env.CRON_SECRET = secret;
    const request = { method: 'GET', authorization: `Bearer ${secret}` };
    assert.deepEqual(await handleReminderCron(request, async () => ({ queued: 2, processed: 1 })),
      { status: 200, body: { ok: true, queued: 2, processed: 1 } });
    const originalError = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await handleReminderCron(request, async () => { throw new Error('secret details'); }),
        { status: 500, body: { ok: false, error: 'Falha ao processar lembretes.' } });
    } finally { console.error = originalError; }
  });
});
