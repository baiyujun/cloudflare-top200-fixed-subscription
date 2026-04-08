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

test('api/status exposes local-cli workflow fields after update-preferred', async () => {
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

  await callWorker(worker, env, '/api/update-preferred', {
    method: 'POST',
    headers: adminHeaders(env),
    body: JSON.stringify({
      preferredIps: Array.from({ length: 200 }, (_, index) => `198.51.100.${(index % 200) + 1}:443#CF-${index + 1}`),
      source: 'local-cli-optimize',
      candidateMode: 'local-cli',
      candidateCount: 5955,
      testedCount: 218,
      lastOptimizedAt: 1712345678901,
    }),
  });

  const status = await callWorker(worker, env, '/api/status', {
    headers: {
      authorization: `Bearer ${env.ADMIN_TOKEN}`,
    },
  });
  assert.equal(status.status, 200);
  const statusJson = await status.json();
  assert.equal(statusJson.ok, true);
  assert.equal(statusJson.workflowMode, 'local-cli-first');
  assert.equal(statusJson.recommendedCommand, 'subup');
  assert.equal(statusJson.recommendedCommands.unix, 'subup');
  assert.equal(statusJson.recommendedCommands.windows, 'subup');
  assert.equal(statusJson.startEndpointDeprecated, true);
  assert.equal(statusJson.candidateCount, 5955);
  assert.equal(statusJson.testedCount, 218);
  assert.equal(statusJson.candidateMode, 'local-cli');
  assert.equal(statusJson.latestRunStatus.candidateMode, 'local-cli');
  assert.equal(statusJson.preferredCount, 200);
});
