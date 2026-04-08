const STORAGE_KEY = 'cf-top200-admin-token';

export function buildAuthHeaders(token) {
  const headers = {};
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

export function bootstrapApp(options = {}) {
  const doc = options.document || document;
  const fetcher = options.fetch || fetch.bind(globalThis);
  const storage = options.storage || window.localStorage;
  const locationLike = options.location || window.location;

  const elements = {
    uiTitle: doc.getElementById('uiTitle'),
    flashBox: doc.getElementById('flashBox'),
    refreshBtn: doc.getElementById('refreshBtn'),
    startBtn: doc.getElementById('startBtn'),
    runState: doc.getElementById('runState'),
    runMessage: doc.getElementById('runMessage'),
    preferredCount: doc.getElementById('preferredCount'),
    inputNodeCount: doc.getElementById('inputNodeCount'),
    candidateCount: doc.getElementById('candidateCount'),
    candidateMode: doc.getElementById('candidateMode'),
    testedCount: doc.getElementById('testedCount'),
    projectedOutput: doc.getElementById('projectedOutput'),
    lastOptimizedAt: doc.getElementById('lastOptimizedAt'),
    tlsMode: doc.getElementById('tlsMode'),
    fixedAutoUrl: doc.getElementById('fixedAutoUrl'),
    fixedRawUrl: doc.getElementById('fixedRawUrl'),
    fixedClashUrl: doc.getElementById('fixedClashUrl'),
    fixedSurgeUrl: doc.getElementById('fixedSurgeUrl'),
    subTokenHint: doc.getElementById('subTokenHint'),
    previewMeta: doc.getElementById('previewMeta'),
    preferredList: doc.getElementById('preferredList'),
    tokenForm: doc.getElementById('tokenForm'),
    adminToken: doc.getElementById('adminToken'),
    clearTokenBtn: doc.getElementById('clearTokenBtn'),
    baseForm: doc.getElementById('baseForm'),
    namePrefix: doc.getElementById('namePrefix'),
    nodeLinks: doc.getElementById('nodeLinks'),
    keepOriginalHost: doc.getElementById('keepOriginalHost'),
    saveBaseBtn: doc.getElementById('saveBaseBtn'),
  };

  const state = {
    token: storage.getItem(STORAGE_KEY) || '',
    busy: false,
    status: null,
  };

  if (elements.adminToken) {
    elements.adminToken.value = state.token;
  }

  elements.refreshBtn?.addEventListener('click', () => loadStatus({ silent: true }));
  elements.clearTokenBtn?.addEventListener('click', handleClearToken);
  elements.tokenForm?.addEventListener('submit', handleSaveToken);
  elements.baseForm?.addEventListener('submit', handleSaveBase);
  doc.addEventListener('click', handleCopyClick);

  loadStatus({ silent: true });

  return {
    loadStatus,
    handleSaveBase,
    handleSaveToken,
    getState: () => ({ ...state }),
  };

  async function loadStatus({ silent = false } = {}) {
    try {
      const response = await fetcher('/api/status', {
        headers: buildAuthHeaders(state.token),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '状态读取失败');
      }

      state.status = data;
      renderStatus(data);
      if (!silent) {
        flash('状态已刷新。', 'info');
      }
      return data;
    } catch (error) {
      if (!silent) {
        flash(error.message || '状态读取失败', 'error');
      }
      throw error;
    }
  }

  async function handleSaveBase(event) {
    event.preventDefault();
    if (!state.token) {
      flash('请先填写并保存 ADMIN_TOKEN。', 'error');
      return;
    }

    const payload = {
      namePrefix: elements.namePrefix.value.trim() || 'Default',
      nodeLinks: elements.nodeLinks.value.trim(),
      keepOriginalHost: elements.keepOriginalHost.checked,
    };

    if (!payload.nodeLinks) {
      flash('基础节点不能为空。', 'error');
      return;
    }

    setBusy(elements.saveBaseBtn, true, '保存中...');
    try {
      const response = await fetcher('/api/save-base', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...buildAuthHeaders(state.token),
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '保存基础节点失败');
      }
      renderStatus(data.status);
      flash('基础节点已保存。', 'success');
    } catch (error) {
      flash(error.message || '保存基础节点失败', 'error');
    } finally {
      setBusy(elements.saveBaseBtn, false, '保存基础节点');
    }
  }

  function handleSaveToken(event) {
    event.preventDefault();
    const nextToken = elements.adminToken.value.trim();
    storage.setItem(STORAGE_KEY, nextToken);
    state.token = nextToken;
    flash(nextToken ? 'ADMIN_TOKEN 已保存到当前浏览器。' : 'ADMIN_TOKEN 已清空。', 'success');
    loadStatus({ silent: true }).catch(() => {});
  }

  function handleClearToken() {
    storage.removeItem(STORAGE_KEY);
    state.token = '';
    elements.adminToken.value = '';
    flash('ADMIN_TOKEN 已清除。', 'info');
    loadStatus({ silent: true }).catch(() => {});
  }

  async function handleCopyClick(event) {
    const button = event.target.closest('[data-copy]');
    if (!button) {
      return;
    }
    const input = doc.getElementById(button.dataset.copy);
    if (!input?.value) {
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(input.value);
      } else {
        input.select();
        doc.execCommand('copy');
      }
      flash('链接已复制。', 'success');
    } catch {
      flash('复制失败，请手动复制。', 'error');
    }
  }

  function renderStatus(data) {
    elements.uiTitle.textContent = data.uiTitle || 'Cloudflare Top200 Fixed Subscription';
    doc.title = data.uiTitle || doc.title;
    elements.runState.textContent = data.latestRunStatus?.state || 'idle';
    elements.runMessage.textContent = data.latestRunStatus?.message || '尚未执行。';
    elements.preferredCount.textContent = String(data.preferredCount || 0);
    elements.inputNodeCount.textContent = String(data.inputNodeCount || 0);
    elements.candidateCount.textContent = String(data.candidateCount || 0);
    elements.testedCount.textContent = String(data.testedCount || data.latestRunStatus?.testedCount || 0);
    elements.candidateMode.textContent = `运行模式：${data.candidateMode || data.latestRunStatus?.candidateMode || 'hybrid'}`;
    elements.projectedOutput.textContent = `预计输出节点 ${data.projectedOutputNodeCount || 0}`;
    elements.lastOptimizedAt.textContent = formatTime(data.lastOptimizedAt);
    elements.tlsMode.textContent = `优选模式：${data.latestRunStatus?.tlsMode || 'tls'}`;

    elements.fixedAutoUrl.value = data.fixedUrls?.auto || new URL('/sub/fixed', locationLike.origin).toString();
    elements.fixedRawUrl.value = data.fixedUrls?.raw || '';
    elements.fixedClashUrl.value = data.fixedUrls?.clash || '';
    elements.fixedSurgeUrl.value = data.fixedUrls?.surge || '';
    elements.subTokenHint.textContent = data.subAccessProtected
      ? '当前已启用 SUB_ACCESS_TOKEN，页面在管理员模式下会显示带 token 的完整固定订阅链接。'
      : '当前未启用 SUB_ACCESS_TOKEN，固定订阅链接可直接导入客户端。';

    if (typeof data.namePrefix === 'string') {
      elements.namePrefix.value = data.namePrefix;
    }
    if (typeof data.nodeLinks === 'string') {
      elements.nodeLinks.value = data.nodeLinks;
    }
    if (typeof data.keepOriginalHost === 'boolean') {
      elements.keepOriginalHost.checked = data.keepOriginalHost;
    }

    const preferredIps = Array.isArray(data.preferredIps) ? data.preferredIps : [];
    const previewSource = preferredIps.length
      ? preferredIps
      : Array.isArray(data.preferredPreview)
        ? data.preferredPreview.map((item) => item.endpoint || '')
        : [];

    elements.preferredList.innerHTML = previewSource
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join('');
    elements.previewMeta.textContent = preferredIps.length
      ? `当前固定订阅已保存 ${preferredIps.length} 条 Top200 preferredIps，本次候选池总数 ${data.candidateCount || 0}，测速成功数 ${data.testedCount || 0}。`
      : '暂无 Top200 结果。请先运行 bootstrap 安装命令，然后在本地设备执行 subup。';
  }

  function flash(message, type = 'info') {
    elements.flashBox.textContent = message;
    elements.flashBox.dataset.tone = type;
    elements.flashBox.classList.remove('hidden');
  }
}

function setBusy(button, busy, text) {
  if (!button) {
    return;
  }
  button.disabled = busy;
  button.textContent = text;
}

function formatTime(timestamp) {
  if (!timestamp) {
    return '未执行';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '未执行';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  bootstrapApp();
}
