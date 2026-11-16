// Search tracks on Color Coded Lyrics (colorcodedlyrics.com).
load('common.js');

function fetchPosts(params) {
  var url = CCL_HOST + '/wp-json/wp/v2/posts?' + params;
  var res = fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json'
    }
  });

  if (res.status === 429) {
    var retryHeader = res.header('retry-after');
    var retrySec = retryHeader && /^\d+$/.test(retryHeader) ? parseInt(retryHeader, 10) : undefined;
    return { failure: Response.error('Color Coded Lyrics rate limited', { kind: 'rateLimited', retryAfterSec: retrySec }) };
  }

  if (res.status !== 200) {
    return { failure: Response.error('Color Coded Lyrics HTTP ' + res.status, { kind: 'server' }) };
  }

  try {
    var posts = JSON.parse(res.text());
    return { ok: true, posts: Array.isArray(posts) ? posts : [] };
  } catch (e) {
    return { failure: Response.error('Invalid JSON from Color Coded Lyrics', { kind: 'invalidResponse' }) };
  }
}

function toCandidates(posts) {
  var items = [];
  var seen = {};

  for (var i = 0; i < posts.length; i++) {
    var post = posts[i];
    if (!post || !post.id || !post.title || !post.title.rendered) continue;

    var rawTitle = post.title.rendered;
    // Filter out index, profile, and discography posts
    if (/lyrics index|profile\b|discography|tracklist/i.test(rawTitle)) {
      continue;
    }

    var idStr = String(post.id);
    if (seen[idStr]) continue;
    seen[idStr] = true;

    var parsed = parsePostTitle(rawTitle);
    if (!parsed.title) continue;

    items.push({
      id: idStr,
      title: parsed.title,
      artist: parsed.artist || 'Unknown'
    });

    if (items.length >= 20) break;
  }

  return items;
}

function cleanQuery(str) {
  if (!str) return '';
  return str
    .replace(/\s*\([^)]*(?:feat|ft|remaster|live|ver|version|ost|soundtrack)[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*(?:feat|ft|remaster|live|ver|version|ost|soundtrack)[^\]]*\]/gi, '')
    .trim();
}

function toSlug(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/['"’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function execute(input) {
  var allItems = [];
  var seen = {};

  function addItems(newItems) {
    for (var i = 0; i < newItems.length; i++) {
      var item = newItems[i];
      if (!seen[item.id]) {
        seen[item.id] = true;
        allItems.push(item);
      }
      if (allItems.length >= 20) break;
    }
  }

  // 1. Manual search via input.text
  if (input && typeof input.text === 'string' && input.text.trim().length > 0) {
    var queryText = input.text.trim();

    var rText = fetchPosts('search=' + encodeURIComponent(queryText) + '&per_page=15');
    if (rText.failure) return rText.failure;
    if (rText.posts && rText.posts.length > 0) {
      addItems(toCandidates(rText.posts));
    }

    if (allItems.length === 0) {
      var textSlug = toSlug(queryText);
      if (textSlug) {
        var rSlug = fetchPosts('slug=' + encodeURIComponent(textSlug));
        if (rSlug.posts && rSlug.posts.length > 0) {
          addItems(toCandidates(rSlug.posts));
        }
      }
    }

    return Response.success(allItems);
  }

  // 2. Automatic lookup via input.title and input.artist
  var title = '';
  var artist = '';
  if (input) {
    if (typeof input.title === 'string') title = input.title.trim();
    if (typeof input.artist === 'string') artist = input.artist.trim();
  }

  if (!title && !artist) {
    return Response.success([]);
  }

  var cTitle = cleanQuery(title) || title;
  var cArtist = cleanQuery(artist) || artist;

  // Step A: Search title + artist
  if (cTitle && cArtist) {
    var rBoth = fetchPosts('search=' + encodeURIComponent(cTitle + ' ' + cArtist) + '&per_page=15');
    if (rBoth.failure) return rBoth.failure;
    if (rBoth.posts && rBoth.posts.length > 0) {
      addItems(toCandidates(rBoth.posts));
    }
  }

  // Step B: Search title alone if needed
  if (allItems.length === 0 && cTitle) {
    var rTitle = fetchPosts('search=' + encodeURIComponent(cTitle) + '&per_page=15');
    if (rTitle.failure && allItems.length === 0) return rTitle.failure;
    if (rTitle.posts && rTitle.posts.length > 0) {
      addItems(toCandidates(rTitle.posts));
    }
  }

  // Step C: Try slug lookup (e.g. "twice-tt")
  if (allItems.length === 0 && cTitle) {
    var slugPair = toSlug(cArtist + ' ' + cTitle);
    if (slugPair) {
      var rPairSlug = fetchPosts('slug=' + encodeURIComponent(slugPair));
      if (rPairSlug.posts && rPairSlug.posts.length > 0) {
        addItems(toCandidates(rPairSlug.posts));
      }
    }

    if (allItems.length === 0) {
      var slugTitle = toSlug(cTitle);
      if (slugTitle) {
        var rTitleSlug = fetchPosts('slug=' + encodeURIComponent(slugTitle));
        if (rTitleSlug.posts && rTitleSlug.posts.length > 0) {
          addItems(toCandidates(rTitleSlug.posts));
        }
      }
    }
  }

  return Response.success(allItems);
}
