// Fetch and parse plain text lyrics from J-Lyric.net song page.
load('common.js');

function execute(id) {
  if (typeof id !== 'string' || id.trim().length === 0) {
    return Response.success(null);
  }

  var path = id.trim();
  if (path.charAt(0) !== '/') {
    path = '/' + path;
  }

  var url = JLYRIC_HOST + path;
  var res = fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });

  if (res.status === 404) {
    return Response.success(null);
  }

  if (res.status === 429) {
    var retryHeader = res.header('retry-after');
    var retrySec = retryHeader && /^\d+$/.test(retryHeader) ? parseInt(retryHeader, 10) : undefined;
    return Response.error('J-Lyric rate limit', { kind: 'rateLimited', retryAfterSec: retrySec });
  }

  if (res.status !== 200) {
    return Response.error('J-Lyric HTTP ' + res.status, { kind: 'server' });
  }

  var html = res.text();
  var match = html.match(/<p id="Lyric"[^>]*>([\s\S]*?)<\/p>/i);
  if (!match || !match[1]) {
    return Response.success(null);
  }

  var lyrics = cleanLyrics(match[1]);
  if (!lyrics) {
    return Response.success(null);
  }

  return Response.success({
    data: lyrics,
    type: 'txt'
  });
}
