const DEFAULT_CANDIDATE_MODE = 'hybrid';
const DEFAULT_TARGET_CANDIDATE_COUNT = 6000;
const DEFAULT_MAX_CANDIDATES_PER_CIDR = 4096;
const DEFAULT_ENABLE_IPV6 = false;
const DEFAULT_IPV4_RANGE_SOURCES = ['/seed/ip.txt'];
const DEFAULT_IPV6_RANGE_SOURCES = ['/seed/ipv6.txt'];

export function getCandidatePoolConfig(env = {}) {
  return {
    candidateMode: normalizeCandidateMode(env.CANDIDATE_MODE),
    targetCandidateCount: normalizeInteger(env.TARGET_CANDIDATE_COUNT, DEFAULT_TARGET_CANDIDATE_COUNT),
    maxCandidatesPerCidr: normalizeInteger(env.MAX_CANDIDATES_PER_CIDR, DEFAULT_MAX_CANDIDATES_PER_CIDR),
    enableIpv6: normalizeBoolean(env.ENABLE_IPV6, DEFAULT_ENABLE_IPV6),
    ipv4RangeSources: splitMultiline(env.CF_IPV4_RANGE_SOURCES || '').length
      ? splitMultiline(env.CF_IPV4_RANGE_SOURCES || '')
      : DEFAULT_IPV4_RANGE_SOURCES,
    ipv6RangeSources: splitMultiline(env.CF_IPV6_RANGE_SOURCES || '').length
      ? splitMultiline(env.CF_IPV6_RANGE_SOURCES || '')
      : DEFAULT_IPV6_RANGE_SOURCES,
    runtimeSeed: String(env.CANDIDATE_RANDOM_SEED || '').trim(),
  };
}

export async function buildRuntimeCandidatePool({ env, requestUrl, tlsMode = 'tls', seed = '' }) {
  const config = getCandidatePoolConfig(env);
  const runtimeSeed = String(seed || config.runtimeSeed || Date.now());
  const ipv4Text = await loadRangeSources(config.ipv4RangeSources, env, requestUrl);
  const ipv4Ranges = parseIpv4Ranges(ipv4Text);
  const runtimeCandidates = generateIpv4Candidates({
    ranges: ipv4Ranges,
    targetCandidateCount: config.targetCandidateCount,
    maxCandidatesPerCidr: config.maxCandidatesPerCidr,
    seed: runtimeSeed,
    tlsMode,
  });

  const ipv6Text = config.enableIpv6
    ? await loadRangeSources(config.ipv6RangeSources, env, requestUrl)
    : '';
  const ipv6Ranges = config.enableIpv6 ? parseIpv6Ranges(ipv6Text) : [];

  return {
    candidateMode: config.candidateMode,
    candidates: runtimeCandidates,
    totalCandidates: runtimeCandidates.length,
    targetCandidateCount: config.targetCandidateCount,
    maxCandidatesPerCidr: config.maxCandidatesPerCidr,
    runtimeSeed,
    ipv4RangeCount: ipv4Ranges.length,
    ipv6RangeCount: ipv6Ranges.length,
    ranges: ipv4Ranges,
  };
}

export function getIpv4BucketKey(host = '') {
  if (!isIpv4Address(host)) {
    return '';
  }
  return host.split('.').slice(0, 3).join('.');
}

export function ipv4ToUint32(host) {
  const octets = String(host || '')
    .trim()
    .split('.')
    .map((item) => Number.parseInt(item, 10));
  if (octets.length !== 4 || octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
    return null;
  }
  return (
    (((octets[0] << 24) >>> 0) |
      ((octets[1] << 16) >>> 0) |
      ((octets[2] << 8) >>> 0) |
      (octets[3] >>> 0)) >>>
    0
  );
}

export function isIpv4Address(host = '') {
  return ipv4ToUint32(host) !== null;
}

function parseIpv4Ranges(text) {
  return normalizeLines(text)
    .map((line, index) => parseIpv4Range(line, index))
    .filter(Boolean);
}

function parseIpv6Ranges(text) {
  return normalizeLines(text).map((cidr, index) => ({
    cidr,
    rangeId: `ipv6-${index}`,
  }));
}

function parseIpv4Range(cidr, index) {
  const [rawIp, rawPrefix] = String(cidr || '').trim().split('/');
  const prefix = Number.parseInt(rawPrefix || '32', 10);
  const network = ipv4ToUint32(rawIp);
  if (network === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return null;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const normalizedNetwork = (network & mask) >>> 0;

  return {
    cidr: `${uint32ToIpv4(normalizedNetwork)}/${prefix}`,
    rangeId: `ipv4-${index}`,
    network: normalizedNetwork,
    end: (normalizedNetwork + (2 ** (32 - prefix) - 1)) >>> 0,
    prefix,
    bucketCapacity: computeBucketCapacity(prefix),
  };
}

function generateIpv4Candidates({
  ranges,
  targetCandidateCount,
  maxCandidatesPerCidr,
  seed,
  tlsMode,
}) {
  const prepared = ranges
    .map((range) => ({
      ...range,
      candidateCapacity: Math.max(0, Math.min(range.bucketCapacity, maxCandidatesPerCidr)),
    }))
    .filter((range) => range.candidateCapacity > 0);

  if (!prepared.length) {
    return [];
  }

  const totalCapacity = prepared.reduce((sum, range) => sum + range.candidateCapacity, 0);
  const target = Math.max(1, Math.min(targetCandidateCount, totalCapacity));
  const allocations = allocateAcrossRanges(prepared, target);

  const runtimeCandidates = [];

  prepared.forEach((range, rangeIndex) => {
    const allocation = allocations[range.rangeId] || 0;
    if (!allocation) {
      return;
    }

    const selectedBuckets = pickBucketIndexes(range.candidateCapacity, allocation);
    selectedBuckets.forEach((bucketIndex, candidateIndex) => {
      const host = sampleIpv4FromRange(range, bucketIndex, `${seed}:${range.cidr}:${bucketIndex}`);
      runtimeCandidates.push({
        host,
        port: tlsMode === 'tls' ? 443 : undefined,
        label: 'CF-RANGE',
        source: 'runtime-cf-range',
        rangeId: range.rangeId,
        cidr: range.cidr,
        prefix: range.prefix,
        bucketIndex,
        bucketKey: getIpv4BucketKey(host),
        insertionOrder: runtimeCandidates.length + candidateIndex + rangeIndex,
      });
    });
  });

  return runtimeCandidates;
}

function allocateAcrossRanges(ranges, target) {
  const totalCapacity = ranges.reduce((sum, range) => sum + range.candidateCapacity, 0);
  if (target >= totalCapacity) {
    return Object.fromEntries(ranges.map((range) => [range.rangeId, range.candidateCapacity]));
  }

  const allocations = new Map();
  const remainders = [];
  let assigned = 0;

  ranges.forEach((range) => {
    const exact = (range.candidateCapacity / totalCapacity) * target;
    const base = Math.max(1, Math.floor(exact));
    const allocation = Math.min(range.candidateCapacity, base);
    allocations.set(range.rangeId, allocation);
    remainders.push({
      rangeId: range.rangeId,
      fraction: exact - Math.floor(exact),
      capacity: range.candidateCapacity,
    });
    assigned += allocation;
  });

  if (assigned > target) {
    const shrinkable = [...allocations.entries()]
      .map(([rangeId, allocation]) => ({
        rangeId,
        allocation,
        capacity: ranges.find((range) => range.rangeId === rangeId)?.candidateCapacity || allocation,
      }))
      .sort((left, right) => right.allocation - left.allocation);

    let overflow = assigned - target;
    while (overflow > 0) {
      const next = shrinkable.find((item) => item.allocation > 1);
      if (!next) {
        break;
      }
      next.allocation -= 1;
      allocations.set(next.rangeId, next.allocation);
      overflow -= 1;
    }
    return Object.fromEntries(allocations.entries());
  }

  remainders.sort((left, right) => right.fraction - left.fraction || right.capacity - left.capacity);
  let remaining = target - assigned;

  for (const item of remainders) {
    if (remaining <= 0) {
      break;
    }
    const current = allocations.get(item.rangeId) || 0;
    if (current >= item.capacity) {
      continue;
    }
    allocations.set(item.rangeId, current + 1);
    remaining -= 1;
  }

  return Object.fromEntries(allocations.entries());
}

function pickBucketIndexes(capacity, allocation) {
  if (allocation >= capacity) {
    return Array.from({ length: capacity }, (_, index) => index);
  }

  const indexes = [];
  for (let index = 0; index < allocation; index += 1) {
    indexes.push(Math.floor((index * capacity) / allocation));
  }
  return Array.from(new Set(indexes));
}

function sampleIpv4FromRange(range, bucketIndex, seed) {
  const hash = stableHash32(seed);
  if (range.prefix >= 24) {
    const size = 2 ** (32 - range.prefix);
    const offset = size <= 1 ? 0 : hash % size;
    return uint32ToIpv4((range.network + offset) >>> 0);
  }

  const bucketStart = (range.network + bucketIndex * 256) >>> 0;
  const offset = hash % 256;
  return uint32ToIpv4((bucketStart + offset) >>> 0);
}

function computeBucketCapacity(prefix) {
  if (prefix >= 24) {
    return 1;
  }
  return 2 ** (24 - prefix);
}

function stableHash32(value) {
  let hash = 0x811c9dc5;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function uint32ToIpv4(value) {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.');
}

async function loadRangeSources(sources, env, requestUrl) {
  const outputs = [];
  for (const sourceUrl of sources) {
    const text = await fetchTextSource(sourceUrl, env, requestUrl).catch(() => '');
    if (text) {
      outputs.push(text);
    }
  }
  return outputs.join('\n');
}

async function fetchTextSource(sourceUrl, env, requestUrl) {
  const normalized = String(sourceUrl || '').trim();
  if (!normalized) {
    return '';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    if (normalized.startsWith('/')) {
      if (!env.ASSETS?.fetch) {
        throw new Error(`未绑定 ASSETS，无法读取内置候选源：${normalized}`);
      }
      const assetUrl = new URL(normalized, requestUrl.origin);
      const response = await env.ASSETS.fetch(
        new Request(assetUrl.toString(), { signal: controller.signal }),
      );
      if (!response.ok) {
        throw new Error(`读取内置候选源失败：${normalized}`);
      }
      return await response.text();
    }

    const response = await fetch(normalized, {
      headers: {
        Accept: 'text/plain, */*',
        'User-Agent': 'CloudflareSub-Top200-CandidatePool',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`读取候选源失败：${normalized} (${response.status})`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeLines(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitMultiline(value) {
  return String(value || '')
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeCandidateMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'runtime_cf_ranges' || normalized === 'hybrid' || normalized === 'seed_only') {
    return normalized;
  }
  return DEFAULT_CANDIDATE_MODE;
}

function normalizeInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBoolean(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}
