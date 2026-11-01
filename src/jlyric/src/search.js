// Search tracks on J-Lyric.net.
load('common.js');

function searchJLyric(title, artist) {
  var url = JLYRIC_HOST + '/search.php?';
  var params = [];
  if (title) {
    params.push('kt=' + encodeURIComponent(title) + '&ct=2');
  }
  if (artist) {
    params.push('ka=' + encodeURIComponent(artist) + '&ca=2');
  }
  url += params.join('&');

  var res = fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });

  if (res.status === 429) {
    var retryHeader = res.header('retry-after');
    var retrySec = retryHeader && /^\d+$/.test(retryHeader) ? parseInt(retryHeader, 10) : undefined;
    return { failure: Response.error('J-Lyric rate limit', { kind: 'rateLimited', retryAfterSec: retrySec }) };
  }

  if (res.status !== 200) {
    return { failure: Response.error('J-Lyric HTTP ' + res.status, { kind: 'server' }) };
  }

  var html = res.text();
  var regex = /<p class="mid"><a href="(\/artist\/[^/]+\/l[0-9a-f]+\.html)"[^>]*>([\s\S]*?)<\/a><\/p>\s*<p class="sml">歌：(?:<a[^>]*>)?([\s\S]*?)(?:<\/a>)?<\/p>/g;
  var items = [];
  var seen = {};
  var m;

  while ((m = regex.exec(html)) !== null) {
    var path = m[1];
    var rawTitle = m[2];
    var rawArtist = m[3];

    var t = htmlDecode(rawTitle.replace(/<[^>]+>/g, '')).trim();
    var a = htmlDecode(rawArtist.replace(/<[^>]+>/g, '')).trim();

    if (!path || !t) continue;
    if (seen[path]) continue;
    seen[path] = true;

    items.push({
      id: path,
      title: t,
      artist: a || 'Unknown'
    });
    if (items.length >= 20) break;
  }

  return { items: items };
}

function execute(input) {
  var title = '';
  var artist = '';

  if (input && typeof input.text === 'string' && input.text.trim().length > 0) {
    var text = input.text.trim();
    // 1. Try search by entire text as title
    var r1 = searchJLyric(text, '');
    if (r1.failure) return r1.failure;
    if (r1.items && r1.items.length > 0) {
      return Response.success(r1.items);
    }

    // 2. If no result and text has spaces (e.g. "YOASOBI アイドル"), try splitting artist & title
    var parts = text.split(/\s+/);
    if (parts.length >= 2) {
      var r2 = searchJLyric(parts.slice(1).join(' '), parts[0]);
      if (r2.items && r2.items.length > 0) {
        return Response.success(r2.items);
      }
      var r3 = searchJLyric(parts[0], parts.slice(1).join(' '));
      if (r3.items && r3.items.length > 0) {
        return Response.success(r3.items);
      }
    }
    return Response.success([]);
  }

  if (input) {
    if (typeof input.title === 'string') title = input.title.trim();
    if (typeof input.artist === 'string') artist = input.artist.trim();
  }

  if (!title) {
    return Response.success([]);
  }

  // Primary search: title + artist
  if (artist) {
    var resBoth = searchJLyric(title, artist);
    if (resBoth.failure) return resBoth.failure;
    if (resBoth.items && resBoth.items.length > 0) {
      return Response.success(resBoth.items);
    }
  }

  // Fallback: title alone
  var resTitle = searchJLyric(title, '');
  if (resTitle.failure) return resTitle.failure;
  return Response.success(resTitle.items || []);
}
