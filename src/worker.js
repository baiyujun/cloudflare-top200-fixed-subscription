import { handleStatus, handleSaveBase, handleStart, handleUpdatePreferred, handleFixedSub } from './fixed.js';
import { noContent, text } from './http.js';
import { handleLegacyGenerate, handleLegacySub } from './legacy.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return noContent();
    }

    if (request.method === 'GET' && url.pathname === '/api/status') {
      return handleStatus(request, env, url);
    }

    if (request.method === 'POST' && url.pathname === '/api/save-base') {
      return handleSaveBase(request, env, url);
    }

    if (request.method === 'POST' && url.pathname === '/api/update-preferred') {
      return handleUpdatePreferred(request, env, url);
    }

    if (request.method === 'POST' && url.pathname === '/api/start') {
      return handleStart(request, env, url);
    }

    if (request.method === 'POST' && url.pathname === '/api/generate') {
      return handleLegacyGenerate(request, env, url);
    }

    if (request.method === 'GET' && url.pathname === '/sub/fixed') {
      return handleFixedSub(request, env, url);
    }

    if (request.method === 'GET' && url.pathname.startsWith('/sub/')) {
      return handleLegacySub(request, env, url);
    }

    if (!env.ASSETS?.fetch) {
      return text('ASSETS binding is missing', 500);
    }

    return env.ASSETS.fetch(request);
  },
};
