import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizePreferredIps } from '../src/optimizer.js';
import { createTestEnv } from './helpers/mock-env.mjs';

test('default optimizer path uses runtime Cloudflare range pool instead of seed-only slicing', async () => {
  const env = createTestEnv({
    CANDIDATE_RANDOM_SEED: 'runtime-regression-test',
  });

  const optimized = await optimizePreferredIps({
    env,
    requestUrl: new URL('https://example.test'),
    baseNodes: [{ tls: true }],
  });

  assert.equal(optimized.candidateMode, 'hybrid');
  assert.ok(optimized.totalCandidates >= 5000);
  assert.equal(optimized.preferredIps.length, 200);
  assert.ok(optimized.runtimeCandidateCount >= 5000);
});
