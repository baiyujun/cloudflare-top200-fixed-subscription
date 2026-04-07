import { parsePreferredEndpoints } from './core.js';
import {
  buildRuntimeCandidatePool,
  getCandidatePoolConfig,
  getIpv4BucketKey,
  ipv4ToUint32,
  isIpv4Address,
} from './candidate-pool.js';

export const TOP200_LIMIT = 200;
const DEFAULT_SPEED_FLOOR = 7;
const DEFAULT_CSV_REMARK_OFFSET = 1;

export function chooseTlsMode(baseNodes = []) {
  if (!Array.isArray(baseNodes) || !baseNodes.length) {
    return 'tls';
  }
  return baseNodes.every((node) => node.tls === false) ? 'notls' : 'tls';
}

export async function optimizePreferredIps({ env, requestUrl, baseNodes = [] }) {
  const tlsMode = chooseTlsMode(baseNodes);
  const config = getOptimizerConfig(env, tlsMode);
  const shouldLoadSupplemental =
    config.candidateMode === 'hybrid' || config.candidateMode === 'seed_only';

  const staticCandidates = shouldLoadSupplemental
    ? parseEndpointText(config.inlineText, 'static')
    : [];
  const apiCandidates = shouldLoadSupplemental
    ? await loadTextSources(config.apiSources, env, requestUrl, 'api')
    : [];
  const csvCandidates = shouldLoadSupplemental
    ? await loadCsvSources(config.csvSources, env, requestUrl, {
        tlsMode,
        speedFloor: config.speedFloor,
        csvRemarkOffset: config.csvRemarkOffset,
      })
    : [];
  const supplementalCandidates = dedupeCandidates([
    ...csvCandidates,
    ...apiCandidates,
    ...staticCandidates,
  ]);

  let rankedCandidates = [];
  let runtimePool = {
    candidates: [],
    totalCandidates: 0,
    ipv4RangeCount: 0,
    ipv6RangeCount: 0,
    ranges: [],
  };

  if (config.candidateMode !== 'seed_only') {
    runtimePool = await buildRuntimeCandidatePool({
      env,
      requestUrl,
      tlsMode,
      seed: config.runtimeSeed,
    });
  }

  if (runtimePool.totalCandidates > 0 && config.candidateMode !== 'seed_only') {
    rankedCandidates = rankRuntimeCandidates(
      runtimePool.candidates,
      supplementalCandidates,
      runtimePool.ranges,
      config.runtimeSeed,
    );
  } else if (supplementalCandidates.length) {
    rankedCandidates = sortExactCandidates(supplementalCandidates);
  } else {
    throw new Error('候选池为空：既没有生成运行时 Cloudflare IP 段候选，也没有可用的补充 seed / CSV / API 数据。');
  }

  const top200 = rankedCandidates.slice(0, TOP200_LIMIT);

  return {
    tlsMode,
    candidateMode: config.candidateMode,
    totalCandidates: rankedCandidates.length,
    runtimeCandidateCount: runtimePool.totalCandidates,
    ipv4RangeCount: runtimePool.ipv4RangeCount,
    ipv6RangeCount: runtimePool.ipv6RangeCount,
    staticCount: staticCandidates.length,
    apiCount: apiCandidates.length,
    csvCount: csvCandidates.length,
    preferredIps: top200.map(formatCandidateLine),
    preferredPreview: top200.slice(0, 20).map((candidate) => ({
      endpoint: formatCandidateLine(candidate),
      label: candidate.label,
      speed: candidate.speed ?? null,
      latency: candidate.latency ?? null,
      source: candidate.source,
      cidr: candidate.cidr || null,
    })),
  };
}

function getOptimizerConfig(env, tlsMode) {
  const isTls = tlsMode === 'tls';
  const poolConfig = getCandidatePoolConfig(env);
  const inlineText = String(isTls ? env.ADD || '' : env.ADDNOTLS || '').trim();
  const apiSources = splitMultiline(isTls ? env.ADDAPI || '' : env.ADDNOTLSAPI || '');
  const csvSources = splitMultiline(env.ADDCSV || '');
  const defaultApiSources = isTls ? ['/seed/addressesapi.txt', '/seed/addressesipv6api.txt'] : [];
  const defaultCsvSources = isTls
    ? ['/seed/addressescsv.csv', '/seed/CloudflareSpeedTest.csv']
    : ['/seed/addressescsv.csv'];

  return {
    candidateMode: poolConfig.candidateMode,
    runtimeSeed: String(poolConfig.runtimeSeed || Date.now()),
    inlineText,
    apiSources: apiSources.length ? apiSources : defaultApiSources,
    csvSources: csvSources.length ? csvSources : defaultCsvSources,
    speedFloor: normalizeNumber(env.DLS, DEFAULT_SPEED_FLOOR),
    csvRemarkOffset: normalizeInteger(env.CSVREMARK, DEFAULT_CSV_REMARK_OFFSET),
  };
}

function rankRuntimeCandidates(runtimeCandidates, supplementalCandidates, ranges, runtimeSeed) {
  const hintMaps = buildRuntimeHintMaps(supplementalCandidates, ranges);
  const ranked = runtimeCandidates.map((candidate, index) =>
    applyRuntimeHints(candidate, index, hintMaps, runtimeSeed),
  );
  ranked.sort(compareCandidates);
  return ranked;
}

function buildRuntimeHintMaps(candidates, ranges) {
  const exact = new Map();
  const bucket = new Map();
  const range = new Map();

  candidates.forEach((candidate) => {
    const score = computeHintScore(candidate);
    const hint = {
      score,
      label: candidate.label || '',
      speed: Number.isFinite(candidate.speed) ? candidate.speed : null,
      latency: Number.isFinite(candidate.latency) ? candidate.latency : null,
      source: candidate.source,
    };

    mergeHint(exact, candidate.host, hint);

    if (isIpv4Address(candidate.host)) {
      const bucketKey = getIpv4BucketKey(candidate.host);
      mergeHint(bucket, bucketKey, hint);

      const rangeId = findRangeId(candidate.host, ranges);
      if (rangeId) {
        mergeHint(range, rangeId, hint);
      }
    }
  });

  return { exact, bucket, range };
}

function applyRuntimeHints(candidate, index, hintMaps, runtimeSeed) {
  const exactHint = hintMaps.exact.get(candidate.host);
  const bucketHint = candidate.bucketKey ? hintMaps.bucket.get(candidate.bucketKey) : null;
  const rangeHint = candidate.rangeId ? hintMaps.range.get(candidate.rangeId) : null;
  const bestHint = exactHint || bucketHint || rangeHint;

  const exactScore = exactHint ? exactHint.score + 60000 : 0;
  const bucketScore = bucketHint ? bucketHint.score + 20000 : 0;
  const rangeScore = rangeHint ? rangeHint.score + 8000 : 0;
  const specificityBonus = (candidate.prefix || 0) * 50;
  const entropy = stableFraction(`${runtimeSeed}:${candidate.host}:${candidate.rangeId}:${candidate.bucketIndex}`);
  const rankScore = exactScore + bucketScore + rangeScore + specificityBonus + entropy * 500;

  return {
    ...candidate,
    label: bestHint?.label || candidate.label,
    speed: bestHint?.speed ?? null,
    latency: bestHint?.latency ?? null,
    source: bestHint ? `${candidate.source}+${bestHint.source}` : candidate.source,
    rankScore,
    insertionOrder: index,
  };
}

function findRangeId(host, ranges) {
  const numericHost = ipv4ToUint32(host);
  if (numericHost === null) {
    return '';
  }

  const matched = ranges.find((range) => numericHost >= range.network && numericHost <= range.end);
  return matched?.rangeId || '';
}

function mergeHint(map, key, hint) {
  if (!key) {
    return;
  }
  const current = map.get(key);
  if (!current || hint.score > current.score) {
    map.set(key, hint);
  }
}

function computeHintScore(candidate) {
  const speed = Number.isFinite(candidate.speed) ? candidate.speed : sourceBaseScore(candidate.source);
  const latency = Number.isFinite(candidate.latency) ? candidate.latency : 300;
  return speed * 1000 - latency * 5 + sourcePriority(candidate.source);
}

function sourceBaseScore(source = '') {
  const normalized = String(source || '').toLowerCase();
  if (normalized.includes('csv-speedtest')) {
    return 120;
  }
  if (normalized.includes('csv')) {
    return 80;
  }
  if (normalized.includes('api')) {
    return 40;
  }
  if (normalized.includes('static')) {
    return 20;
  }
  return 10;
}

function sourcePriority(source = '') {
  const normalized = String(source || '').toLowerCase();
  if (normalized.includes('csv-speedtest')) {
    return 5000;
  }
  if (normalized.includes('csv')) {
    return 2000;
  }
  if (normalized.includes('api')) {
    return 1000;
  }
  if (normalized.includes('static')) {
    return 500;
  }
  return 0;
}

function sortExactCandidates(candidates) {
  const sorted = [...candidates];
  sorted.sort(compareCandidates);
  return sorted;
}

async function loadTextSources(sources, env, requestUrl, source) {
  const outputs = [];
  for (const sourceUrl of sources) {
    const text = await fetchTextSource(sourceUrl, env, requestUrl).catch(() => '');
    outputs.push(...parseEndpointText(text, source));
  }
  return outputs;
}

async function loadCsvSources(sources, env, requestUrl, options) {
  const outputs = [];

  for (const sourceUrl of sources) {
    const text = await fetchTextSource(sourceUrl, env, requestUrl).catch(() => '');
    const csvCandidates = parseCsvCandidates(text, {
      tlsMode: options.tlsMode,
      speedFloor: options.speedFloor,
      csvRemarkOffset: options.csvRemarkOffset,
    });
    outputs.push(...csvCandidates);
  }

  outputs.sort(compareCandidates);
  return outputs;
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
        Accept: 'text/plain, text/csv, */*',
        'User-Agent': 'CloudflareSub-Top200-Optimizer',
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

function parseEndpointText(text, source) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split(/\r?\n/).filter(Boolean);
  if (lines[0]?.split(',').length > 3) {
    return parseCsvApiStyle(lines, source);
  }

  const { endpoints } = parsePreferredEndpoints(normalized);
  return endpoints.map((endpoint, index) => ({
    host: endpoint.host,
    port: endpoint.port,
    label: endpoint.label,
    source,
    insertionOrder: index,
  }));
}

function parseCsvApiStyle(lines, source) {
  const body = lines
    .slice(1)
    .map((line) => line.split(',')[0])
    .filter(Boolean)
    .join('\n');
  if (!body) {
    return [];
  }
  return parseEndpointText(body, source);
}

function parseCsvCandidates(text, options) {
  const rows = normalizeCsvText(text)
    .split('\n')
    .filter(Boolean)
    .map((line) => splitCsvLine(line));

  if (rows.length <= 1) {
    return [];
  }

  const [header, ...dataRows] = rows;
  const tlsIndex = findCsvIndex(header, ['TLS']);
  if (tlsIndex < 0) {
    return parseSpeedTestCsvCandidates(dataRows, options);
  }

  const ipIndex = findCsvIndex(header, ['IP地址', 'IP', 'Address']);
  const portIndex = findCsvIndex(header, ['端口', 'Port']);
  const speedIndex = findCsvIndex(header, ['速度(MB/s)', '速度', 'Speed(MB/s)', 'Speed']);
  const latencyIndex = findCsvIndex(header, ['TCP延迟(ms)', '延迟', 'Latency', 'TCP Latency(ms)']);
  const labelIndex = findCsvIndex(header, ['数据中心', 'Data Center', 'colo']);
  const fallbackLabelIndex = Math.max(tlsIndex + options.csvRemarkOffset, 0);
  const wantedTls = options.tlsMode === 'tls' ? 'TRUE' : 'FALSE';

  const candidates = [];

  dataRows.forEach((row, index) => {
    const tlsValue = String(row[tlsIndex] || '').trim().toUpperCase();
    const speed = parseFloat(row[speedIndex] || '');
    if (tlsValue !== wantedTls || !Number.isFinite(speed) || speed <= options.speedFloor) {
      return;
    }

    const host = String(row[ipIndex] || '').trim();
    const port = parseInteger(row[portIndex]);
    if (!host) {
      return;
    }

    const label = String(row[labelIndex] || row[fallbackLabelIndex] || '').trim();
    candidates.push({
      host,
      port,
      label,
      source: 'csv',
      speed,
      latency: parseFloat(row[latencyIndex] || ''),
      insertionOrder: index,
    });
  });

  candidates.sort(compareCandidates);
  return candidates;
}

function parseSpeedTestCsvCandidates(dataRows, options) {
  if (options.tlsMode !== 'tls') {
    return [];
  }

  const candidates = [];

  dataRows.forEach((row, index) => {
    const host = String(row[0] || '').trim();
    const speed = parseFloat(row[5] || '');
    const latency = parseFloat(row[4] || '');
    if (!host || !Number.isFinite(speed) || speed <= options.speedFloor) {
      return;
    }

    candidates.push({
      host,
      port: 443,
      label: 'CFST',
      source: 'csv-speedtest',
      speed,
      latency,
      insertionOrder: index,
    });
  });

  candidates.sort(compareCandidates);
  return candidates;
}

function compareCandidates(left, right) {
  const leftRank = Number.isFinite(left.rankScore) ? left.rankScore : Number.NEGATIVE_INFINITY;
  const rightRank = Number.isFinite(right.rankScore) ? right.rankScore : Number.NEGATIVE_INFINITY;
  if (leftRank !== rightRank) {
    return rightRank - leftRank;
  }

  const leftSpeed = Number.isFinite(left.speed) ? left.speed : -1;
  const rightSpeed = Number.isFinite(right.speed) ? right.speed : -1;
  if (leftSpeed !== rightSpeed) {
    return rightSpeed - leftSpeed;
  }

  const leftLatency = Number.isFinite(left.latency) ? left.latency : Number.POSITIVE_INFINITY;
  const rightLatency = Number.isFinite(right.latency) ? right.latency : Number.POSITIVE_INFINITY;
  if (leftLatency !== rightLatency) {
    return leftLatency - rightLatency;
  }

  return (left.insertionOrder || 0) - (right.insertionOrder || 0);
}

function dedupeCandidates(candidates) {
  const deduped = [];
  const seen = new Set();

  candidates.forEach((candidate) => {
    const key = `${candidate.host}:${candidate.port || ''}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    deduped.push(candidate);
  });

  return deduped;
}

export function formatCandidateLine(candidate) {
  const host = candidate.host || '';
  const port = candidate.port ? `:${candidate.port}` : '';
  const label = candidate.label ? `#${candidate.label}` : '';
  return `${host}${port}${label}`;
}

function splitMultiline(value) {
  return String(value || '')
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeCsvText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\uFEFF/, '')
    .trim();
}

function splitCsvLine(line) {
  return String(line)
    .split(',')
    .map((cell) => cell.trim());
}

function findCsvIndex(header, candidates) {
  const wanted = candidates.map((item) => item.toLowerCase());
  return header.findIndex((column) => wanted.includes(String(column || '').trim().toLowerCase()));
}

function parseInteger(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function normalizeNumber(value, fallback) {
  const parsed = Number.parseFloat(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function stableFraction(value) {
  let hash = 0x811c9dc5;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0xffffffff;
}
