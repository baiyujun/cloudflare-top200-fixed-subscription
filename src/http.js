export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...headers,
    },
  });
}

export function text(body, status = 200, contentType = 'text/plain; charset=utf-8', headers = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': contentType,
      ...corsHeaders(),
      ...headers,
    },
  });
}

export function noContent(headers = {}) {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(),
      ...headers,
    },
  });
}

export function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, x-admin-token',
  };
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error('请求体不是合法 JSON。');
  }
}
