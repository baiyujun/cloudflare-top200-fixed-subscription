import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { callWorker, createTestEnv } from './helpers/mock-env.mjs';

const vmess =
  'vmess://eyJ2IjoiMiIsInBzIjoidG9wMjAwLXRlc3QiLCJhZGQiOiJlZGdlLmV4YW1wbGUuY29tIiwicG9ydCI6IjQ0MyIsImlkIjoiMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwic2N5IjoiYXV0byIsIm5ldCI6IndzIiwidGxzIjoidGxzIiwicGF0aCI6Ii93cyIsImhvc3QiOiJlZGdlLmV4YW1wbGUuY29tIiwic25pIjoiZWRnZS5leGFtcGxlLmNvbSJ9';

function adminHeaders(env, contentType = 'application/json') {
  return {
    authorization: `Bearer ${env.ADMIN_TOKEN}`,
    'content-type': contentType,
  };
}

test('api/start really writes Top200 instead of Top10', async () => {
  const env = createTestEnv();

  await callWorker(worker, env, '/api/save-base', {
    method: 'POST',
    headers: adminHeaders(env),
    body: JSON.stringify({
      namePrefix: 'Default',
      nodeLinks: vmess,
      keepOriginalHost: true,
    }),
  });

  const start = await callWorker(worker, env, '/api/start', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.ADMIN_TOKEN}`,
    },
  });
  assert.equal(start.status, 200);
  const startJson = await start.json();
  assert.equal(startJson.ok, true);
  assert.equal(startJson.preferredCount, 200);
  assert.ok(startJson.candidateCount >= 200);

  const status = await callWorker(worker, env, '/api/status', {
    headers: {
      authorization: `Bearer ${env.ADMIN_TOKEN}`,
    },
  });
  const statusJson = await status.json();
  assert.equal(statusJson.preferredIps.length, 200);
  assert.equal(statusJson.preferredCount, 200);
  assert.equal(statusJson.latestRunStatus.state, 'success');

  const fixedRaw = await callWorker(
    worker,
    env,
    `/sub/fixed?target=raw&token=${encodeURIComponent(env.SUB_ACCESS_TOKEN)}`,
  );
  const decoded = Buffer.from(await fixedRaw.text(), 'base64').toString('utf8');
  assert.equal(decoded.split('\n').filter(Boolean).length, 200);
});

test('legacy /api/generate and /sub/:id still work', async () => {
  const env = createTestEnv();
  const preferredIps = ['104.16.1.2#HK', '104.17.2.3:2053#US'].join('\n');

  const generate = await callWorker(worker, env, '/api/generate', {
    method: 'POST',
    headers: adminHeaders(env),
    body: JSON.stringify({
      nodeLinks: vmess,
      preferredIps,
      namePrefix: 'Legacy',
      keepOriginalHost: true,
    }),
  });
  assert.equal(generate.status, 200);
  const generateJson = await generate.json();
  assert.equal(generateJson.ok, true);
  assert.match(generateJson.urls.auto, /\/sub\//);

  const subUrl = new URL(generateJson.urls.raw);
  const legacySub = await callWorker(worker, env, `${subUrl.pathname}${subUrl.search}`);
  assert.equal(legacySub.status, 200);
  const decoded = Buffer.from(await legacySub.text(), 'base64').toString('utf8');
  assert.equal(decoded.split('\n').filter(Boolean).length, 2);
});
