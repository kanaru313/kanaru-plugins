// Fetch and parse lyrics from Color Coded Lyrics (colorcodedlyrics.com).
load('common.js');

function execute(id) {
  if (typeof id !== 'string' || id.trim().length === 0) {
    return Response.success(null);
  }

  var postId = id.trim();
  var url = CCL_HOST + '/wp-json/wp/v2/posts/' + encodeURIComponent(postId);
  var res = fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json'
    }
  });

  if (res.status === 404) {
    return Response.success(null);
  }

  if (res.status === 429) {
    var retryHeader = res.header('retry-after');
    var retrySec = retryHeader && /^\d+$/.test(retryHeader) ? parseInt(retryHeader, 10) : undefined;
    return Response.error('Color Coded Lyrics rate limited', { kind: 'rateLimited', retryAfterSec: retrySec });
  }

  if (res.status !== 200) {
    return Response.error('Color Coded Lyrics HTTP ' + res.status, { kind: 'server' });
  }

  var post;
  try {
    post = JSON.parse(res.text());
  } catch (e) {
    return Response.error('Invalid JSON from Color Coded Lyrics', { kind: 'invalidResponse' });
  }

  if (!post || !post.content || typeof post.content.rendered !== 'string') {
    return Response.success(null);
  }

  var html = post.content.rendered;
  var sections = extractSections(html);
  if (!sections || sections.length === 0) {
    return Response.success(null);
  }

  var preferred = 'all';
  if (typeof localConfig !== 'undefined' && localConfig && typeof localConfig.getItem === 'function') {
    var cfg = localConfig.getItem('preferredSection');
    if (typeof cfg === 'string' && cfg.trim().length > 0) {
      preferred = cfg.trim();
    }
  }

  var lyricsText = formatSections(sections, preferred);
  if (!lyricsText || lyricsText.trim().length === 0) {
    return Response.success(null);
  }

  return Response.success({
    data: lyricsText,
    type: 'txt'
  });
}
