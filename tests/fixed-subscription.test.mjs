import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { callWorker, createTestEnv } from './helpers/mock-env.mjs';

const vmess =
  'vmess://eyJ2IjoiMiIsInBzIjoiZml4ZWQtdG9wMjAwIiwicG9ydCI6IjQ0MyIsImFkZCI6ImVkZ2UuZXhhbXBsZS5jb20iLCJpZCI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSIsInNjeSI6ImF1dG8iLCJuZXQiOiJ3cyIsInRscyI6InRscyIsInBhdGgiOiIvd3MiLCJob3N0IjoiZWRnZS5leGFtcGxlLmNvbSIsInNuaSI6ImVkZ2UuZXhhbXBsZS5jb20ifQ==';

function adminHeaders(env) {
  return {
    authorization: `Bearer ${env.ADMIN_TOKEN}`,
    'content-type': 'application/json',
  };
}

test('fixed subscription flow still writes Top200 from runtime candidate pool', async () => {
  const env = createTestEnv({
    CANDIDATE_RANDOM_SEED: 'fixed-subscription-test',
  });

  const saveBase = await callWorker(worker, env, '/api/save-base', {
    method: 'POST',
    headers: adminHeaders(env),
    body: JSON.stringify({
      namePrefix: 'Default',
      nodeLinks: vmess,
      keepOriginalHost: true,
    }),
  });
  assert.equal(saveBase.status, 200);

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
  assert.ok(startJson.candidateCount >= 5000);
  assert.equal(startJson.candidateMode, 'hybrid');

  const fixedRaw = await callWorker(
    worker,
    env,
    `/sub/fixed?target=raw&token=${encodeURIComponent(env.SUB_ACCESS_TOKEN)}`,
  );
  assert.equal(fixedRaw.status, 200);
  const decoded = Buffer.from(await fixedRaw.text(), 'base64').toString('utf8');
  assert.equal(decoded.split('\n').filter(Boolean).length, 200);
});
