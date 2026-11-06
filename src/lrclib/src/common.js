// Common helpers for LRCLIB plugin.
var LRCLIB_API_BASE = 'https://lrclib.net/api';
var USER_AGENT = 'Kanaru (https://github.com/hieu313/kanaru)';

function lrclibGet(path) {
  var url = LRCLIB_API_BASE + path;
  var res = fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
    timeout: 15000,
  });

  if (!res.ok) {
    if (res.status === 404) {
      return { notFound: true };
    }
    return { failure: failure(res) };
  }

  try {
    return { data: res.json() };
  } catch (e) {
    return { failure: Response.error('LRCLIB sent invalid JSON', { kind: 'invalidResponse' }) };
  }
}

function failure(res) {
  var message = 'LRCLIB HTTP ' + res.status;
  var s = res.status;
  if (s === 429) {
    var retry = res.header('retry-after');
    var retrySec = retry && /^\d+$/.test(retry) ? parseInt(retry, 10) : 2;
    return Response.error(message, { kind: 'rateLimited', retryAfterSec: retrySec });
  }
  if (s === 400 || s === 422) {
    return Response.error(message, { kind: 'invalidResponse' });
  }
  return Response.error(message, { kind: 'server' });
}
