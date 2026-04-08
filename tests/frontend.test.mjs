import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { bootstrapApp } from '../public/app.js';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('frontend renders local CLI first status page without triggering /api/start', async () => {
  const dom = new JSDOM(html, {
    url: 'https://example.test/',
    pretendToBeVisual: true,
  });

  const calls = [];
  const responses = new Map([
    [
      'GET /api/status',
      {
        ok: true,
        uiTitle: 'Top200 Test Console',
        workflowMode: 'local-cli-first',
        startEndpointDeprecated: true,
        hasNodeLinks: true,
        preferredCount: 200,
        candidateCount: 5955,
        testedCount: 218,
        candidateMode: 'local-cli',
        inputNodeCount: 1,
        projectedOutputNodeCount: 200,
        fixedUrls: {
          auto: 'https://example.test/sub/fixed?token=sub-token',
          raw: 'https://example.test/sub/fixed?target=raw&token=sub-token',
          clash: 'https://example.test/sub/fixed?target=clash&token=sub-token',
          surge: 'https://example.test/sub/fixed?target=surge&token=sub-token',
        },
        preferredPreview: [],
        latestRunStatus: {
          state: 'success',
          message: '本地 CLI 优选完成，已写入 200 条 preferredIps。',
          testedCount: 218,
          candidateMode: 'local-cli',
          tlsMode: 'tls',
        },
        keepOriginalHost: true,
        namePrefix: 'Default',
        nodeLinks: 'vmess://demo',
      },
    ],
  ]);

  const fetcher = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const key = `${init.method || 'GET'} ${new URL(url, 'https://example.test').pathname}`;
    calls.push({
      key,
      headers: init.headers || {},
    });
    const payload = responses.get(key);
    if (!payload) {
      throw new Error(`Unexpected fetch: ${key}`);
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
    });
  };

  const storage = dom.window.localStorage;
  storage.setItem('cf-top200-admin-token', 'admin-token-123456');

  bootstrapApp({
    document: dom.window.document,
    fetch: fetcher,
    storage,
    location: dom.window.location,
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(dom.window.document.getElementById('preferredCount').textContent, '200');
  assert.equal(dom.window.document.getElementById('testedCount').textContent, '218');
  assert.equal(dom.window.document.getElementById('candidateCount').textContent, '5955');
  assert.match(dom.window.document.getElementById('candidateMode').textContent, /local-cli/);
  assert.equal(dom.window.document.getElementById('startBtn').disabled, true);
  assert.equal(dom.window.document.getElementById('unixRunCmd').value, 'subup');
  assert.equal(dom.window.document.getElementById('windowsRunCmd').value, 'subup');
  assert.match(dom.window.document.getElementById('fixedRawUrl').value, /target=raw/);
  assert.equal(calls.filter((entry) => entry.key === 'POST /api/start').length, 0);
});
