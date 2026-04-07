import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptPayload,
  encryptPayload,
  expandNodes,
  parseNodeLinks,
  parsePreferredEndpoints,
  renderClashSubscription,
  renderRawSubscription,
  renderSurgeSubscription,
} from '../src/core.js';

const vmess =
  'vmess://eyJ2IjoiMiIsInBzIjoiZGVtby12bWVzcyIsImFkZCI6ImVkZ2UuZXhhbXBsZS5jb20iLCJwb3J0IjoiNDQzIiwiaWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJzY3kiOiJhdXRvIiwibmV0Ijoid3MiLCJ0bHMiOiJ0bHMiLCJwYXRoIjoiL3dzIiwiaG9zdCI6ImVkZ2UuZXhhbXBsZS5jb20iLCJzbmkiOiJlZGdlLmV4YW1wbGUuY29tIiwiZnAiOiJjaHJvbWUiLCJhbHBuIjoiaDIsaHR0cC8xLjEifQ==';

const vless =
  'vless://11111111-1111-4111-8111-111111111111@vless.example.com:443?encryption=none&security=tls&type=ws&host=vless.example.com&path=%2Fvless&sni=vless.example.com#demo-vless';

const trojan =
  'trojan://password123@trojan.example.com:443?security=tls&type=ws&host=trojan.example.com&path=%2Ftrojan&sni=trojan.example.com#demo-trojan';

test('parse vmess / vless / trojan and base64 subscription', async () => {
  const direct = parseNodeLinks(`${vmess}\n${vless}\n${trojan}`);
  assert.equal(direct.warnings.length, 0);
  assert.equal(direct.nodes.length, 3);
  assert.equal(direct.nodes[0].type, 'vmess');
  assert.equal(direct.nodes[1].type, 'vless');
  assert.equal(direct.nodes[2].type, 'trojan');

  const mergedBase64 = Buffer.from(`${vless}\n${trojan}`, 'utf8').toString('base64');
  const expanded = parseNodeLinks(mergedBase64);
  assert.equal(expanded.warnings.length, 0);
  assert.equal(expanded.nodes.length, 2);
});

test('render raw / clash / surge subscriptions', async () => {
  const { nodes } = parseNodeLinks(`${vmess}\n${vless}\n${trojan}`);
  const { endpoints } = parsePreferredEndpoints('104.16.1.2#HK\n104.17.2.3:2053#US');
  const expanded = expandNodes(nodes, endpoints, { keepOriginalHost: true, namePrefix: 'CF' });

  assert.equal(expanded.nodes.length, 6);

  const raw = renderRawSubscription(expanded.nodes);
  assert.ok(raw.length > 20);

  const clash = renderClashSubscription(expanded.nodes);
  assert.match(clash, /proxies:/);
  assert.match(clash, /vless\.example\.com/);

  const surge = renderSurgeSubscription(expanded.nodes, 'https://example.test/sub/demo?target=surge');
  assert.match(surge, /\[Proxy]/);
  assert.match(surge, /vmess/);
});

test('encrypt / decrypt payload compatibility', async () => {
  const secret = 'this-is-a-very-secret-key';
  const token = await encryptPayload({ hello: 'world' }, secret);
  const payload = await decryptPayload(token, secret);
  assert.deepEqual(payload, { hello: 'world' });
});
