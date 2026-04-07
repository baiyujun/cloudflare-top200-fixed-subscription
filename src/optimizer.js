import { parsePreferredEndpoints } from './core.js';

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

  const staticCandidates = parseEndpointText(config.inlineText, 'static');
  const apiCandidates = await loadTextSources(config.apiSources, env, requestUrl, 'api');
  const csvCandidates = await loadCsvSources(config.csvSources, env, requestUrl, {
    tlsMode,
    speedFloor: config.speedFloor,
    csvRemarkOffset: config.csvRemarkOffset,
  });

  const merged = dedupeCandidates([...csvCandidates, ...apiCandidates, ...staticCandidates]);
  if (merged.length < TOP200_LIMIT) {
    throw new Error(
      `优选候选不足 ${TOP200_LIMIT} 条，当前仅 ${merged.length} 条。请补充 ADD / ADDAPI / ADDCSV 来源。`,
    );
  }

  const top200 = merged.slice(0, TOP200_LIMIT);

  return {
    tlsMode,
    totalCandidates: merged.length,
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
    })),
  };
}

function getOptimizerConfig(env, tlsMode) {
  const isTls = tlsMode === 'tls';
  const inlineText = String(isTls ? env.ADD || '' : env.ADDNOTLS || '').trim();
  const apiSources = splitMultiline(isTls ? env.ADDAPI || '' : env.ADDNOTLSAPI || '');
  const csvSources = splitMultiline(env.ADDCSV || '');
  const defaultApiSources = isTls
    ? ['/seed/addressesapi.txt', '/seed/addressesipv6api.txt']
    : [];
  const defaultCsvSources = ['/seed/addressescsv.csv'];

  return {
    inlineText,
    apiSources: apiSources.length ? apiSources : defaultApiSources,
    csvSources: csvSources.length ? csvSources : defaultCsvSources,
    speedFloor: normalizeNumber(env.DLS, DEFAULT_SPEED_FLOOR),
    csvRemarkOffset: normalizeInteger(env.CSVREMARK, DEFAULT_CSV_REMARK_OFFSET),
  };
}

async function loadTextSources(sources, env, requestUrl, source) {
  const outputs = [];
  for (const sourceUrl of sources) {
    const text = await fetchTextSource(sourceUrl, env, requestUrl);
    outputs.push(...parseEndpointText(text, source));
  }
  return outputs;
}

async function loadCsvSources(sources, env, requestUrl, options) {
  const outputs = [];

  for (const sourceUrl of sources) {
    const text = await fetchTextSource(sourceUrl, env, requestUrl);
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
  const body = lines.slice(1).map((line) => line.split(',')[0]).filter(Boolean).join('\n');
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
    return [];
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

function compareCandidates(left, right) {
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
