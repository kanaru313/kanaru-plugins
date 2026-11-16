// Common helpers for Megalobiz plugin.
var MEGALOBIZ_API_BASE = 'https://api.megalobiz.com/api/public/v1';
var USER_AGENT = 'Kanaru (https://github.com/hieu313/kanaru)';

function megalobizGet(path, format) {
  var url = MEGALOBIZ_API_BASE + path;
  var headers = {
    'User-Agent': USER_AGENT,
    'Accept': format === 'text' ? 'text/plain' : 'application/json',
  };

  var apiKey = localConfig.getItem('apiKey');
  if (typeof apiKey === 'string' && apiKey.trim() !== '') {
    headers['Authorization'] = 'Bearer ' + apiKey.trim();
  }

  var res = fetch(url, {
    method: 'GET',
    headers: headers,
    timeout: 15000,
  });

  if (!res.ok) {
    if (res.status === 404) {
      return { notFound: true };
    }
    return { failure: failure(res) };
  }

  if (format === 'text') {
    return { text: res.text() };
  }

  try {
    return { data: res.json() };
  } catch (e) {
    return { failure: Response.error('Megalobiz sent invalid JSON', { kind: 'invalidResponse' }) };
  }
}

function failure(res) {
  var message = 'Megalobiz HTTP ' + res.status;
  var s = res.status;
  if (s === 429) {
    var retry = res.header('retry-after');
    var retrySec = retry && /^\d+$/.test(retry) ? parseInt(retry, 10) : 5;
    return Response.error(message, { kind: 'rateLimited', retryAfterSec: retrySec });
  }
  if (s === 401 || s === 403) {
    return Response.error(message, { kind: 'auth' });
  }
  if (s === 400 || s === 422) {
    return Response.error(message, { kind: 'invalidResponse' });
  }
  return Response.error(message, { kind: 'server' });
}

function cleanLrc(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/^\[(?:re|by):megalobiz\]\s*\n?/gim, '')
    .trim();
}
