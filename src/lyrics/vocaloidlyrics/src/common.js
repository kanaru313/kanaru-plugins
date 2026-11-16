// Common helpers for Vocaloid Lyrics Wiki plugin.
var API_URL = 'https://vocaloidlyrics.miraheze.org/w/api.php';
var USER_AGENT = 'Kanaru (https://github.com/hieu313/kanaru)';

function wikiGet(params) {
  var queryParts = ['format=json'];
  for (var k in params) {
    if (Object.prototype.hasOwnProperty.call(params, k)) {
      queryParts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    }
  }
  var url = API_URL + '?' + queryParts.join('&');
  var res = fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
    timeout: 15000,
  });

  if (!res.ok) {
    return { failure: failure(res) };
  }

  try {
    return { data: res.json() };
  } catch (e) {
    return { failure: Response.error('Vocaloid Lyrics Wiki sent invalid JSON', { kind: 'invalidResponse' }) };
  }
}

function failure(res) {
  var message = 'Vocaloid Lyrics Wiki HTTP ' + res.status;
  if (res.status === 429) {
    return Response.error(message, { kind: 'rateLimited', retryAfterSec: 5 });
  }
  return Response.error(message, { kind: 'server' });
}

function cleanWikitext(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/\{\{ruby\|([^|]+)\|([^}]+)\}\}/gi, '$1 ($2)')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}
