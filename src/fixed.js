import {
  buildShareUrls,
  detectTarget,
  expandNodes,
  parseNodeLinks,
  parsePreferredEndpoints,
  renderSubscription,
  summarizeNodes,
} from './core.js';
import { isAdminAuthorized, requireAdmin, requireSubAccess } from './auth.js';
import { json, readJson, text } from './http.js';
import { optimizePreferredIps, TOP200_LIMIT } from './optimizer.js';
import { readFixedRecord, updateFixedRecord } from './storage.js';

export async function handleStatus(request, env, url) {
  const record = await readFixedRecord(env);
  const adminView = isAdminAuthorized(request, env);
  const status = buildFixedStatus(
    record,
    url.origin,
    env.SUB_ACCESS_TOKEN || '',
    adminView,
    env.UI_TITLE || 'Cloudflare Top200 Fixed Subscription',
  );
  return json({ ok: true, ...status });
}

export async function handleSaveBase(request, env, url) {
  const denial = requireAdmin(request, env);
  if (denial) {
    return denial;
  }

  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  let parsedNodes;
  try {
    parsedNodes = parseNodeLinks(body.nodeLinks || '');
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const saved = await updateFixedRecord(env, (record) => ({
    ...record,
    namePrefix: String(body.namePrefix || 'Default').trim() || 'Default',
    nodeLinks: String(body.nodeLinks || '').trim(),
    keepOriginalHost: body.keepOriginalHost !== false,
    latestRunStatus: {
      ...record.latestRunStatus,
      message: record.preferredCount
        ? record.latestRunStatus.message
        : '基础节点已保存，等待本地 CLI 执行 Top200 优选。',
    },
  }));

  return json({
    ok: true,
    saved: true,
    warnings: parsedNodes.warnings,
    inputNodeCount: parsedNodes.nodes.length,
    fixedUrls: buildFixedUrls(url.origin, env.SUB_ACCESS_TOKEN || '', true),
    status: buildFixedStatus(
      saved,
      url.origin,
      env.SUB_ACCESS_TOKEN || '',
      true,
      env.UI_TITLE || 'Cloudflare Top200 Fixed Subscription',
    ),
  });
}

export async function handleUpdatePreferred(request, env, url) {
  const denial = requireAdmin(request, env);
  if (denial) {
    return denial;
  }

  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  let preferred;
  try {
    preferred = normalizePreferredList(body.preferredIps);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const truncated = preferred.slice(0, TOP200_LIMIT);
  const lastOptimizedAt = normalizeTimestamp(body.lastOptimizedAt) || Date.now();
  const source = String(body.source || 'manual-api').trim() || 'manual-api';
  const candidateMode = normalizeCandidateMode(body.candidateMode, source);
  const candidateCount = normalizeCount(body.candidateCount, truncated.length);
  const testedCount = normalizeCount(body.testedCount, truncated.length);
  const successMessage = buildUpdateMessage(source, truncated.length);

  const saved = await updateFixedRecord(env, (record) => ({
    ...record,
    preferredIps: truncated,
    preferredCount: truncated.length,
    candidateCount,
    testedCount,
    candidateMode,
    preferredPreview: summarizePreferred(truncated),
    lastOptimizedAt,
    updatedFrom: source,
    latestRunStatus: {
      state: 'success',
      message: successMessage,
      startedAt: record.latestRunStatus.startedAt,
      finishedAt: new Date(lastOptimizedAt).toISOString(),
      preferredCount: truncated.length,
      candidateCount,
      testedCount,
      candidateMode,
      tlsMode: record.latestRunStatus.tlsMode || 'tls',
    },
  }));

  return json({
    ok: true,
    preferredCount: truncated.length,
    fixedUrls: buildFixedUrls(url.origin, env.SUB_ACCESS_TOKEN || '', true),
    status: buildFixedStatus(
      saved,
      url.origin,
      env.SUB_ACCESS_TOKEN || '',
      true,
      env.UI_TITLE || 'Cloudflare Top200 Fixed Subscription',
    ),
  });
}

export async function handleStart(request, env, url) {
  const denial = requireAdmin(request, env);
  if (denial) {
    return denial;
  }

  const record = await readFixedRecord(env);
  if (!record.nodeLinks) {
    return json({ ok: false, error: '请先通过 /api/save-base 保存基础节点。' }, 400);
  }

  let parsedNodes;
  try {
    parsedNodes = parseNodeLinks(record.nodeLinks);
  } catch (error) {
    return json({ ok: false, error: `固定订阅中的基础节点无效：${error.message}` }, 400);
  }

  await updateFixedRecord(env, (current) => ({
    ...current,
    latestRunStatus: {
      ...current.latestRunStatus,
      state: 'running',
      message: '兼容模式 /api/start 正在执行。主流程已迁移到本地 CLI，请优先使用 subup。',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      preferredCount: current.preferredCount,
      candidateCount: 0,
      testedCount: current.testedCount || 0,
      candidateMode: current.candidateMode || current.latestRunStatus.candidateMode || 'hybrid',
    },
  }));

  try {
    const optimized = await optimizePreferredIps({
      env,
      requestUrl: url,
      baseNodes: parsedNodes.nodes,
    });

    const lastOptimizedAt = Date.now();
    const saved = await updateFixedRecord(env, (current) => ({
      ...current,
      preferredIps: optimized.preferredIps,
      preferredCount: optimized.preferredIps.length,
      candidateCount: optimized.totalCandidates,
      testedCount: optimized.preferredIps.length,
      candidateMode: optimized.candidateMode,
      preferredPreview: optimized.preferredPreview,
      lastOptimizedAt,
      updatedFrom: 'deprecated-web-start',
      latestRunStatus: {
        state: 'success',
        message: '兼容模式 /api/start 已完成更新。主方案已迁移到本地 CLI，请优先使用 subup。',
        startedAt: current.latestRunStatus.startedAt,
        finishedAt: new Date(lastOptimizedAt).toISOString(),
        preferredCount: optimized.preferredIps.length,
        candidateCount: optimized.totalCandidates,
        testedCount: optimized.preferredIps.length,
        candidateMode: optimized.candidateMode,
        tlsMode: optimized.tlsMode,
      },
    }));

    return json({
      ok: true,
      deprecated: true,
      message:
        optimized.preferredIps.length >= TOP200_LIMIT
          ? '兼容模式 /api/start 已更新成功。主方案已迁移到本地 CLI，请改用 subup。'
          : `兼容模式 /api/start 已更新成功，但当前仅找到 ${optimized.preferredIps.length} 条可用优选结果。主方案已迁移到本地 CLI。`,
      preferredCount: optimized.preferredIps.length,
      candidateCount: optimized.totalCandidates,
      testedCount: optimized.preferredIps.length,
      candidateMode: optimized.candidateMode,
      inputNodeCount: parsedNodes.nodes.length,
      projectedOutputNodeCount: parsedNodes.nodes.length * optimized.preferredIps.length,
      fixedUrls: buildFixedUrls(url.origin, env.SUB_ACCESS_TOKEN || '', true),
      preferredPreview: optimized.preferredPreview,
      status: buildFixedStatus(
        saved,
        url.origin,
        env.SUB_ACCESS_TOKEN || '',
        true,
        env.UI_TITLE || 'Cloudflare Top200 Fixed Subscription',
      ),
    });
  } catch (error) {
    const failedAt = new Date().toISOString();
    await updateFixedRecord(env, (current) => ({
      ...current,
      latestRunStatus: {
        ...current.latestRunStatus,
        state: 'error',
        message: `/api/start 兼容模式失败：${error.message}`,
        finishedAt: failedAt,
      },
    }));

    return json({ ok: false, deprecated: true, error: error.message }, 500);
  }
}

export async function handleFixedSub(request, env, url) {
  const denial = requireSubAccess(request, env, url);
  if (denial) {
    return denial;
  }

  const record = await readFixedRecord(env);
  if (!record.nodeLinks) {
    return text('fixed subscription has no base nodes', 404);
  }
  if (!record.preferredIps.length) {
    return text('fixed subscription has no preferred IPs', 404);
  }

  const parsedNodes = parseNodeLinks(record.nodeLinks);
  const parsedPreferred = parsePreferredEndpoints(record.preferredIps.join('\n'));
  const expanded = expandNodes(parsedNodes.nodes, parsedPreferred.endpoints, {
    namePrefix: record.namePrefix || '',
    keepOriginalHost: record.keepOriginalHost !== false,
  });

  const target = detectTarget(request.headers.get('user-agent') || '', url.searchParams.get('target') || 'raw');
  const rendered = renderSubscription(target, expanded.nodes, url.toString());
  return text(rendered.body, 200, rendered.contentType);
}

export function buildFixedUrls(origin, accessToken = '', includeToken = false) {
  const urls = buildShareUrls(origin, 'fixed');
  if (!includeToken || !accessToken) {
    return urls;
  }
  return Object.fromEntries(
    Object.entries(urls).map(([key, value]) => {
      const next = new URL(value);
      next.searchParams.set('token', accessToken);
      return [key, next.toString()];
    }),
  );
}

function buildFixedStatus(record, origin, accessToken, includeSensitive, uiTitle) {
  let inputNodeCount = 0;
  let projectedOutputNodeCount = 0;
  let warnings = [];

  if (record.nodeLinks) {
    try {
      const parsedNodes = parseNodeLinks(record.nodeLinks);
      inputNodeCount = parsedNodes.nodes.length;
      projectedOutputNodeCount = inputNodeCount * (record.preferredCount || 0);
      warnings = parsedNodes.warnings;
    } catch (error) {
      warnings = [error.message];
    }
  }

  const status = {
    uiTitle,
    workflowMode: 'local-cli-first',
    recommendedCommand: 'subup',
    recommendedCommands: {
      unix: 'subup',
      windows: 'subup',
    },
    startEndpointDeprecated: true,
    hasNodeLinks: Boolean(record.nodeLinks),
    preferredCount: record.preferredCount || 0,
    candidateCount: record.candidateCount || record.latestRunStatus?.candidateCount || 0,
    testedCount: record.testedCount || record.latestRunStatus?.testedCount || 0,
    candidateMode: record.candidateMode || record.latestRunStatus?.candidateMode || 'hybrid',
    lastOptimizedAt: record.lastOptimizedAt,
    latestRunStatus: record.latestRunStatus,
    inputNodeCount,
    projectedOutputNodeCount,
    keepOriginalHost: record.keepOriginalHost !== false,
    fixedUrls: buildFixedUrls(origin, accessToken, includeSensitive),
    subAccessProtected: Boolean(accessToken),
    warnings,
    preferredPreview: Array.isArray(record.preferredPreview) ? record.preferredPreview : [],
  };

  if (includeSensitive) {
    return {
      ...status,
      namePrefix: record.namePrefix || 'Default',
      preferredIps: record.preferredIps || [],
      nodeLinks: record.nodeLinks || '',
      latestGeneratedNodesPreview:
        record.nodeLinks && record.preferredIps?.length
          ? previewExpandedNodes(record)
          : [],
    };
  }

  return status;
}

function previewExpandedNodes(record) {
  try {
    const parsedNodes = parseNodeLinks(record.nodeLinks);
    const parsedPreferred = parsePreferredEndpoints((record.preferredIps || []).join('\n'));
    const expanded = expandNodes(parsedNodes.nodes, parsedPreferred.endpoints, {
      namePrefix: record.namePrefix || '',
      keepOriginalHost: record.keepOriginalHost !== false,
    });
    return summarizeNodes(expanded.nodes, 20);
  } catch {
    return [];
  }
}

function normalizePreferredList(input) {
  const text = Array.isArray(input) ? input.join('\n') : String(input || '');
  const { endpoints } = parsePreferredEndpoints(text);
  if (!endpoints.length) {
    throw new Error('preferredIps 不能为空。');
  }
  return endpoints.map((endpoint) => formatPreferred(endpoint));
}

function formatPreferred(endpoint) {
  const port = endpoint.port ? `:${endpoint.port}` : '';
  const label = endpoint.label ? `#${endpoint.label}` : '';
  return `${endpoint.host}${port}${label}`;
}

function summarizePreferred(preferredIps) {
  return preferredIps.slice(0, 20).map((line) => ({ endpoint: line }));
}

function normalizeTimestamp(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeCount(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeCandidateMode(value, source) {
  const explicit = String(value || '').trim().toLowerCase();
  if (explicit) {
    return explicit;
  }
  if (/(termux|cli|local)/.test(String(source || '').toLowerCase())) {
    return 'local-cli';
  }
  return 'manual';
}

function buildUpdateMessage(source, preferredCount) {
  if (/(termux|cli|local)/.test(String(source || '').toLowerCase())) {
    return `本地 CLI 优选完成，已写入 ${preferredCount} 条 preferredIps。`;
  }
  return `已写入 ${preferredCount} 条 preferredIps。`;
}
