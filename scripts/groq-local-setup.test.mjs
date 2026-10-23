import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { startGroqLocalSetup } from './groq-local-setup.mjs';

function postWithHost(url, fields, host) {
  return new Promise((resolveResponse, rejectResponse) => {
    const body = new URLSearchParams(fields).toString();
    const req = httpRequest(new URL('configure', url), {
      method: 'POST', headers: { Host: host, Origin: url.slice(0, -1),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body) },
    }, response => {
      response.resume();
      response.on('end', () => resolveResponse(response.statusCode));
    });
    req.on('error', rejectResponse);
    req.end(body);
  });
}

test('local Groq setup accepts one verified key and rejects cross-origin submissions', async () => {
  const key = 'test_key_1234567890';
  let saved = '';
  let verified = 0;
  const { url, server } = await startGroqLocalSetup({
    verify: async submitted => {
      verified++;
      if (submitted !== key) throw new Error('Chave inválida.');
    },
    save: async submitted => { saved = submitted; },
    lifetime: 10_000,
    onSuccess: () => {},
  });
  try {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy') || '', /form-action 'self'/);
    assert.match(page.headers.get('cache-control') || '', /no-store/);
    const html = await page.text();
    const csrf = /name="csrf" value="([a-f0-9]{64})"/.exec(html)?.[1];
    assert.ok(csrf);

    const post = (fields, headers = {}) => fetch(new URL('configure', url), {
      method: 'POST', body: new URLSearchParams(fields), headers,
    });
    const fields = { csrf, key };
    assert.equal((await post({ csrf, key: 'wrong_key_1234567890' })).status, 400);
    assert.equal((await post(fields, { Origin: 'https://other.example' })).status, 403);
    assert.equal(await postWithHost(url, fields, 'attacker.example'), 403);
    assert.equal((await post({ csrf: '0'.repeat(64), key }, { Origin: url.slice(0, -1) })).status, 403);
    assert.equal(verified, 1);
    assert.equal(saved, '');

    const invalid = await post({ csrf, key: 'wrong_key_1234567890' }, { Origin: url.slice(0, -1) });
    assert.equal(invalid.status, 400);
    assert.doesNotMatch(await invalid.text(), /wrong_key_1234567890/);
    assert.equal(saved, '');

    const success = await post(fields, { Origin: url.slice(0, -1) });
    assert.equal(success.status, 200);
    assert.doesNotMatch(await success.text(), new RegExp(key));
    assert.equal(saved, key);
    assert.equal(verified, 3);
    assert.equal((await fetch(url)).status, 410);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
