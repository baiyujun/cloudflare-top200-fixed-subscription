import {
  buildShareUrls,
  detectTarget,
  expandNodes,
  parseNodeLinks,
  parsePreferredEndpoints,
  renderSubscription,
  summarizeNodes,
} from './core.js';
import { requireSubAccess } from './auth.js';
import { json, text } from './http.js';

function normalizeLines(value = '') {
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort()
    .join('\n');
}

function createShortId(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let output = '';
  for (let index = 0; index < length; index += 1) {
    output += chars[bytes[index] % chars.length];
  }
  return output;
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function buildDedupHash(body) {
  const normalized = {
    nodeLinks: normalizeLines(body.nodeLinks || ''),
    preferredIps: normalizeLines(body.preferredIps || ''),
    namePrefix: String(body.namePrefix || '').trim(),
    keepOriginalHost: body.keepOriginalHost !== false,
  };
  return sha256Hex(JSON.stringify(normalized));
}

async function createUniqueShortId(env, tries = 8) {
  for (let index = 0; index < tries; index += 1) {
    const shortId = createShortId();
    const exists = await env.SUB_STORE.get(`sub:${shortId}`);
    if (!exists) {
      return shortId;
    }
  }
  throw new Error('无法生成唯一短链接，请稍后重试。');
}

export async function handleLegacyGenerate(request, env, url) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: '请求体不是合法 JSON。' }, 400);
  }

  let parsedNodes;
  let parsedPreferred;

  try {
    parsedNodes = parseNodeLinks(body.nodeLinks || '');
    parsedPreferred = parsePreferredEndpoints(body.preferredIps || '');
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const expanded = expandNodes(parsedNodes.nodes, parsedPreferred.endpoints, {
    namePrefix: body.namePrefix || '',
    keepOriginalHost: body.keepOriginalHost !== false,
  });

  const payload = {
    version: 1,
    createdAt: new Date().toISOString(),
    options: {
      namePrefix: body.namePrefix || '',
      keepOriginalHost: body.keepOriginalHost !== false,
    },
    nodes: expanded.nodes,
  };

  const dedupKey = `dedup:${await buildDedupHash(body)}`;
  let shortId = await env.SUB_STORE.get(dedupKey);
  if (!shortId) {
    shortId = await createUniqueShortId(env);
    const ttl = 60 * 60 * 24 * 7;
    await env.SUB_STORE.put(`sub:${shortId}`, JSON.stringify(payload), { expirationTtl: ttl });
    await env.SUB_STORE.put(dedupKey, shortId, { expirationTtl: ttl });
  }

  const urls = buildShareUrls(url.origin, shortId);
  const protectedUrls = attachToken(urls, env.SUB_ACCESS_TOKEN || '');

  return json({
    ok: true,
    storage: 'kv',
    shortId,
    urls: protectedUrls,
    counts: {
      inputNodes: parsedNodes.nodes.length,
      preferredEndpoints: parsedPreferred.endpoints.length,
      outputNodes: expanded.nodes.length,
    },
    preview: summarizeNodes(expanded.nodes, 20),
    warnings: [...parsedNodes.warnings, ...parsedPreferred.warnings, ...expanded.warnings],
  });
}

export async function handleLegacySub(request, env, url) {
  const denial = requireSubAccess(request, env, url);
  if (denial) {
    return denial;
  }

  const shortId = url.pathname.split('/').pop();
  if (!shortId || shortId === 'fixed') {
    return text('not found', 404);
  }

  const raw = await env.SUB_STORE.get(`sub:${shortId}`);
  if (!raw) {
    return text('not found', 404);
  }

  const record = JSON.parse(raw);
  const target = detectTarget(request.headers.get('user-agent') || '', url.searchParams.get('target') || 'raw');
  const rendered = renderSubscription(target, record.nodes || [], url.toString());
  return text(rendered.body, 200, rendered.contentType);
}

function attachToken(urls, accessToken) {
  if (!accessToken) {
    return urls;
  }
  return Object.fromEntries(
    Object.entries(urls).map(([key, value]) => {
      const url = new URL(value);
      url.searchParams.set('token', accessToken);
      return [key, url.toString()];
    }),
  );
}
