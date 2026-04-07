import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { callWorker, createTestEnv } from './helpers/mock-env.mjs';

const vmess =
  'vmess://eyJ2IjoiMiIsInBzIjoiZml4ZWQtdGVzdCIsImFkZCI6ImVkZ2UuZXhhbXBsZS5jb20iLCJwb3J0IjoiNDQzIiwiaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJzY3kiOiJhdXRvIiwibmV0Ijoid3MiLCJ0bHMiOiJ0bHMiLCJwYXRoIjoiL3dzIiwiaG9zdCI6ImVkZ2UuZXhhbXBsZS5jb20iLCJzbmkiOiJlZGdlLmV4YW1wbGUuY29tIn0=';

function adminHeaders(env) {
  return {
    authorization: `Bearer ${env.ADMIN_TOKEN}`,
    'content-type': 'application/json',
  };
}

test('fixed subscription save-base -> update-preferred -> status -> sub/fixed', async () => {
  const env = createTestEnv();

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
  const saveJson = await saveBase.json();
  assert.equal(saveJson.ok, true);
  assert.equal(saveJson.inputNodeCount, 1);

  const preferredIps = Array.from({ length: 200 }, (_, index) => `cf-${index + 1}.example.com:443#CF-${index + 1}`);
  const updatePreferred = await callWorker(worker, env, '/api/update-preferred', {
    method: 'POST',
    headers: adminHeaders(env),
    body: JSON.stringify({
      preferredIps,
      source: 'manual-test',
      lastOptimizedAt: 1712345678901,
    }),
  });
  assert.equal(updatePreferred.status, 200);
  const updateJson = await updatePreferred.json();
  assert.equal(updateJson.preferredCount, 200);
  assert.match(updateJson.fixedUrls.raw, /\/sub\/fixed\?target=raw&token=/);

  const publicStatus = await callWorker(worker, env, '/api/status');
  const publicStatusJson = await publicStatus.json();
  assert.equal(publicStatusJson.ok, true);
  assert.equal(publicStatusJson.preferredCount, 200);
  assert.equal(publicStatusJson.hasNodeLinks, true);

  const fixedDenied = await callWorker(worker, env, '/sub/fixed?target=raw');
  assert.equal(fixedDenied.status, 403);

  const fixedRaw = await callWorker(
    worker,
    env,
    `/sub/fixed?target=raw&token=${encodeURIComponent(env.SUB_ACCESS_TOKEN)}`,
  );
  assert.equal(fixedRaw.status, 200);
  const fixedRawText = await fixedRaw.text();
  const decoded = Buffer.from(fixedRawText, 'base64').toString('utf8');
  assert.equal(decoded.split('\n').filter(Boolean).length, 200);
});
