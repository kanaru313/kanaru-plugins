// Common helpers for Hợp Âm Chuẩn (hopamchuan.com) lyrics & chord plugin.
var BASE_URL = 'https://hopamchuan.com';
var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function hopamGet(path, queryParams) {
  var url = BASE_URL + path;
  if (queryParams) {
    var parts = [];
    for (var k in queryParams) {
      if (Object.prototype.hasOwnProperty.call(queryParams, k)) {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(queryParams[k]));
      }
    }
    if (parts.length > 0) {
      url += (url.indexOf('?') === -1 ? '?' : '&') + parts.join('&');
    }
  }

  var res = fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'vi,en;q=0.9',
    },
    timeout: 15000,
  });

  if (!res.ok) {
    return { failure: failure(res) };
  }

  return { data: res.text() };
}

function failure(res) {
  var message = 'Hợp Âm Chuẩn HTTP ' + res.status;
  if (res.status === 429) {
    return Response.error(message, { kind: 'rateLimited', retryAfterSec: 5 });
  }
  return Response.error(message, { kind: 'server' });
}

function decodeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, function (_, dec) {
      return String.fromCharCode(parseInt(dec, 10));
    })
    .replace(/&#x([0-9a-f]+);/gi, function (_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });
}

function parseLyricLine(lineHtml, showChords) {
  if (typeof lineHtml !== 'string') return '';
  var s = lineHtml;
  if (showChords) {
    s = s.replace(/<span\s+class=["']hopamchuan_chord_inline["'][^>]*>[\s\S]*?<span\s+class=["']hopamchuan_chord["']>([^<]+)<\/span>[\s\S]*?<\/span>/gi, '[$1]');
  } else {
    s = s.replace(/<span\s+class=["']hopamchuan_chord_inline["'][^>]*>[\s\S]*?<span\s+class=["']hopamchuan_chord["']>([^<]+)<\/span>[\s\S]*?<\/span>/gi, '');
    s = s.replace(/<span\s+class=["']hopamchuan_chord_inline["'][^>]*>[\s\S]*?<\/span>/gi, '');
  }
  s = s.replace(/<[^>]+>/g, '');
  s = decodeHtml(s);
  s = s.replace(/\s+/g, ' ');
  return s.trim();
}

function extractLyricsFromHtml(html, showChords) {
  if (typeof html !== 'string') return null;
  var startIdx = html.indexOf('id="song-lyric"');
  if (startIdx === -1) return null;

  var endIdx = html.indexOf('id="song-leftover-space"', startIdx);
  if (endIdx === -1) {
    endIdx = html.indexOf('id="chord-list-show-all"', startIdx);
  }
  var section = endIdx !== -1 ? html.slice(startIdx, endIdx) : html.slice(startIdx, startIdx + 50000);

  var lineRegex = /<div\s+class=["'][^"']*chord_lyric_line[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  var lines = [];
  var match;
  while ((match = lineRegex.exec(section)) !== null) {
    var rawLine = match[1];
    var isBlank = /class=["'][^"']*empty_line[^"']*["']/i.test(match[0]) || rawLine.trim() === '&nbsp;';
    if (isBlank) {
      lines.push('');
    } else {
      var formatted = parseLyricLine(rawLine, showChords);
      lines.push(formatted);
    }
  }

  // Trim trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  // Trim leading empty lines
  while (lines.length > 0 && lines[0] === '') {
    lines.shift();
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

function parseSearchResults(html) {
  if (typeof html !== 'string') return [];
  var itemRegex = /<div[^>]*class=["'][^"']*song-item(?:\s|["'])[\s\S]*?<\/div>\s*<\/div>/gi;
  var items = [];
  var match;

  while ((match = itemRegex.exec(html)) !== null) {
    var raw = match[0];
    var linkMatch = raw.match(/href=["'](?:https?:\/\/hopamchuan\.com)?\/song\/(\d+\/[^"'\/?#]+)[^"']*["'][^>]*class=["']song-title["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    var songId = linkMatch[1];
    var title = decodeHtml(linkMatch[2].replace(/<[^>]+>/g, '').trim());

    var artists = [];
    var singersBlockMatch = raw.match(/<span[^>]*class=["']song-singers["'][^>]*>([\s\S]*?)<\/span>/i);
    if (singersBlockMatch) {
      var artistRegex = /<a[^>]*class=["']author-item["'][^>]*>([\s\S]*?)<\/a>/gi;
      var artMatch;
      while ((artMatch = artistRegex.exec(singersBlockMatch[1])) !== null) {
        var a = decodeHtml(artMatch[1].replace(/<[^>]+>/g, '').trim());
        if (a) artists.push(a);
      }
      if (artists.length === 0) {
        var fallback = decodeHtml(singersBlockMatch[1].replace(/<[^>]+>/g, '').replace(/^[\s\-–—:]+/, '').trim());
        if (fallback) artists.push(fallback);
      }
    }

    items.push({
      id: songId,
      title: title,
      artist: artists.length > 0 ? artists.join(', ') : 'Hợp Âm Chuẩn',
      name: title,
      artists: artists,
    });
  }

  return items;
}
