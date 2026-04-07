import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { bootstrapApp } from '../public/app.js';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('frontend start button triggers fixed Top200 update flow', async () => {
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
        hasNodeLinks: true,
        preferredCount: 0,
        candidateCount: 5955,
        candidateMode: 'hybrid',
        inputNodeCount: 1,
        projectedOutputNodeCount: 0,
        fixedUrls: {
          auto: 'https://example.test/sub/fixed?token=sub-token',
          raw: 'https://example.test/sub/fixed?target=raw&token=sub-token',
          clash: 'https://example.test/sub/fixed?target=clash&token=sub-token',
          surge: 'https://example.test/sub/fixed?target=surge&token=sub-token',
        },
        preferredPreview: [],
        latestRunStatus: {
          state: 'idle',
          message: '等待执行',
          candidateMode: 'hybrid',
          tlsMode: 'tls',
        },
        keepOriginalHost: true,
        namePrefix: 'Default',
        nodeLinks: 'vmess://demo',
      },
    ],
    [
      'POST /api/start',
      {
        ok: true,
        preferredCount: 200,
        status: {
          ok: true,
          uiTitle: 'Top200 Test Console',
          hasNodeLinks: true,
          preferredCount: 200,
          candidateCount: 5955,
          candidateMode: 'hybrid',
          inputNodeCount: 1,
          projectedOutputNodeCount: 200,
          fixedUrls: {
            auto: 'https://example.test/sub/fixed?token=sub-token',
            raw: 'https://example.test/sub/fixed?target=raw&token=sub-token',
            clash: 'https://example.test/sub/fixed?target=clash&token=sub-token',
            surge: 'https://example.test/sub/fixed?target=surge&token=sub-token',
          },
          preferredIps: Array.from({ length: 200 }, (_, index) => `cf-${index + 1}.example.com:443#CF-${index + 1}`),
          latestRunStatus: {
            state: 'success',
            message: 'Top200 优选完成，已更新固定订阅。',
            candidateMode: 'hybrid',
            tlsMode: 'tls',
          },
          keepOriginalHost: true,
          namePrefix: 'Default',
          nodeLinks: 'vmess://demo',
        },
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

  dom.window.document.getElementById('startBtn').click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const startCall = calls.find((entry) => entry.key === 'POST /api/start');
  assert.ok(startCall);
  assert.equal(startCall.headers.authorization, 'Bearer admin-token-123456');
  assert.equal(dom.window.document.getElementById('preferredCount').textContent, '200');
  assert.equal(dom.window.document.getElementById('candidateCount').textContent, '5955');
  assert.match(dom.window.document.getElementById('candidateMode').textContent, /hybrid/);
  assert.match(dom.window.document.getElementById('flashBox').textContent, /已更新成功/);
  assert.match(dom.window.document.getElementById('fixedRawUrl').value, /target=raw/);
});
