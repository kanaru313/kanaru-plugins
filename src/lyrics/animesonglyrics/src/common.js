// Common helpers for Anime Song Lyrics plugin.
var BASE_URL = 'https://www.animesonglyrics.com';
var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function animeGet(path) {
  var url = path.indexOf('http') === 0 ? path : BASE_URL + path;
  var res = fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    timeout: 15000,
  });

  if (!res.ok) {
    if (res.status === 404) return { notFound: true };
    return { failure: failure(res) };
  }

  return { text: res.text() };
}

function failure(res) {
  var message = 'Anime Song Lyrics HTTP ' + res.status;
  if (res.status === 429) {
    return Response.error(message, { kind: 'rateLimited', retryAfterSec: 5 });
  }
  return Response.error(message, { kind: 'server' });
}

function cleanHtml(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
