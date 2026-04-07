import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRuntimeCandidatePool } from '../src/candidate-pool.js';
import { createTestEnv } from './helpers/mock-env.mjs';

test('runtime candidate pool expands Cloudflare IPv4 ranges into thousands-scale candidates', async () => {
  const env = createTestEnv({
    CANDIDATE_MODE: 'runtime_cf_ranges',
    CANDIDATE_RANDOM_SEED: 'candidate-pool-test',
  });

  const pool = await buildRuntimeCandidatePool({
    env,
    requestUrl: new URL('https://example.test'),
    tlsMode: 'tls',
  });

  assert.equal(pool.candidateMode, 'runtime_cf_ranges');
  assert.ok(pool.ipv4RangeCount >= 20);
  assert.ok(pool.totalCandidates >= 5000);
  assert.ok(pool.totalCandidates <= 7000);
  assert.equal(new Set(pool.candidates.map((candidate) => candidate.bucketKey)).size, pool.totalCandidates);
});
