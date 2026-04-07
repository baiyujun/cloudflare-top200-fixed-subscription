import { text } from './http.js';

function readAuthorizationHeader(request) {
  return request.headers.get('authorization') || '';
}

function extractBearerToken(value) {
  const match = String(value || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

export function getAdminTokenFromRequest(request) {
  return (
    extractBearerToken(readAuthorizationHeader(request)) ||
    request.headers.get('x-admin-token')?.trim() ||
    ''
  );
}

export function isAdminAuthorized(request, env) {
  const expected = String(env.ADMIN_TOKEN || '').trim();
  if (!expected) {
    return false;
  }
  return getAdminTokenFromRequest(request) === expected;
}

export function requireAdmin(request, env) {
  if (isAdminAuthorized(request, env)) {
    return null;
  }
  return text('Forbidden: invalid admin token', 403);
}

export function getSubAccessToken(request, url) {
  return (
    url.searchParams.get('token')?.trim() ||
    extractBearerToken(readAuthorizationHeader(request)) ||
    ''
  );
}

export function requireSubAccess(request, env, url) {
  const expected = String(env.SUB_ACCESS_TOKEN || '').trim();
  if (!expected) {
    return null;
  }
  if (getSubAccessToken(request, url) === expected) {
    return null;
  }
  return text('Forbidden: invalid subscription token', 403);
}
