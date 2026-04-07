import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { callWorker, createTestEnv } from './helpers/mock-env.mjs';

const vmess =
  'vmess://eyJ2IjoiMiIsInBzIjoiYXBpLXN0YXR1cyIsImFkZCI6ImVkZ2UuZXhhbXBsZS5jb20iLCJwb3J0IjoiNDQzIiwiaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJzY3kiOiJhdXRvIiwibmV0Ijoid3MiLCJ0bHMiOiJ0bHMiLCJwYXRoIjoiL3dzIiwiaG9zdCI6ImVkZ2UuZXhhbXBsZS5jb20iLCJzbmkiOiJlZGdlLmV4YW1wbGUuY29tIn0=';

function adminHeaders(env) {
  return {
    authorization: `Bearer ${env.ADMIN_TOKEN}`,
    'content-type': 'application/json',
  };
}

test('api/status exposes candidateCount and candidateMode after runtime optimization', async () => {
  const env = createTestEnv({
    CANDIDATE_RANDOM_SEED: 'api-status-test',
  });

  await callWorker(worker, env, '/api/save-base', {
    method: 'POST',
    headers: adminHeaders(env),
    body: JSON.stringify({
      namePrefix: 'Default',
      nodeLinks: vmess,
      keepOriginalHost: true,
    }),
  });

  await callWorker(worker, env, '/api/start', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.ADMIN_TOKEN}`,
    },
  });

  const status = await callWorker(worker, env, '/api/status', {
    headers: {
      authorization: `Bearer ${env.ADMIN_TOKEN}`,
    },
  });
  assert.equal(status.status, 200);
  const statusJson = await status.json();
  assert.equal(statusJson.ok, true);
  assert.ok(statusJson.candidateCount >= 5000);
  assert.equal(statusJson.candidateMode, 'hybrid');
  assert.equal(statusJson.latestRunStatus.candidateMode, 'hybrid');
  assert.equal(statusJson.preferredCount, 200);
});
