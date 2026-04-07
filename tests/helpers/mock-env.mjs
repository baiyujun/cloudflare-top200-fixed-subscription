import { readFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const publicRoot = path.join(projectRoot, 'public');

export class MemoryKV {
  constructor() {
    this.map = new Map();
  }

  async get(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  async put(key, value) {
    this.map.set(key, String(value));
  }
}

export function createMockAssets(rootDir = publicRoot) {
  return {
    async fetch(request) {
      const url = new URL(request.url);
      const filePath = path.join(rootDir, url.pathname.replace(/^\/+/, ''));
      try {
        const body = await readFile(filePath, 'utf8');
        return new Response(body, {
          status: 200,
          headers: {
            'content-type': guessContentType(filePath),
          },
        });
      } catch {
        return new Response('not found', { status: 404 });
      }
    },
  };
}

export function createTestEnv(overrides = {}) {
  return {
    SUB_STORE: new MemoryKV(),
    ASSETS: createMockAssets(),
    SUB_ACCESS_TOKEN: 'sub-access-token-123456',
    ADMIN_TOKEN: 'admin-token-123456',
    UI_TITLE: 'Top200 Test Console',
    ...overrides,
  };
}

export async function callWorker(worker, env, pathName, options = {}) {
  const url = new URL(pathName, 'https://example.test');
  const request = new Request(url.toString(), {
    method: options.method || 'GET',
    headers: options.headers,
    body: options.body,
  });
  return worker.fetch(request, env);
}

function guessContentType(filePath) {
  if (filePath.endsWith('.csv')) {
    return 'text/csv; charset=utf-8';
  }
  if (filePath.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }
  if (filePath.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  if (filePath.endsWith('.js')) {
    return 'application/javascript; charset=utf-8';
  }
  if (filePath.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  return 'text/plain; charset=utf-8';
}
