// Shared helpers for Color Coded Lyrics plugin.
// Loaded via load('common.js') into the shared global execution scope.

var CCL_HOST = 'https://colorcodedlyrics.com';
var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

function htmlDecode(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8216;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8230;/g, '…')
    .replace(/&#(\d+);/g, function(_, dec) {
      return String.fromCharCode(dec);
    })
    .replace(/&#x([0-9a-fA-F]+);/g, function(_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });
}

function parsePostTitle(raw) {
  var decoded = htmlDecode(raw || '').trim();
  // Split on em-dash, en-dash, or spaced hyphen
  var parts = decoded.split(/\s+[–—\-]\s+/);
  if (parts.length >= 2) {
    return {
      artist: parts[0].trim(),
      title: parts.slice(1).join(' - ').trim()
    };
  }
  return {
    artist: 'Unknown',
    title: decoded
  };
}

function cleanHtmlSection(chunk) {
  if (!chunk) return '';
  // Convert <br> and <br/> with optional following newline into a single newline
  var s = chunk.replace(/<br\s*\/?>[ \t]*\n?/gi, '\n');
  // Convert </p> into double newline (stanza separation)
  s = s.replace(/<\/p>[ \t]*\n?/gi, '\n\n');
  s = s.replace(/<\/div>[ \t]*\n?/gi, '\n');
  // Remove all other HTML tags
  s = s.replace(/<[^>]+>/g, '');
  // Decode HTML entities
  s = htmlDecode(s);

  var rawLines = s.split('\n');
  var lines = [];
  var lastEmpty = false;
  for (var i = 0; i < rawLines.length; i++) {
    var line = rawLines[i].trim();
    if (line === '') {
      if (!lastEmpty && lines.length > 0) {
        lines.push('');
        lastEmpty = true;
      }
    } else {
      lines.push(line);
      lastEmpty = false;
    }
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.join('\n');
}

function extractSections(html) {
  var sections = [];
  if (!html) return sections;

  // 1. Table format (older posts)
  var tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  var tableMatch;
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    var tbl = tableMatch[1];
    var thMatches = [];
    var thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    var thM;
    while ((thM = thRegex.exec(tbl)) !== null) {
      thMatches.push(thM[1].replace(/<[^>]+>/g, '').trim());
    }

    if (thMatches.length > 0) {
      var isLyricsTable = false;
      for (var k = 0; k < thMatches.length; k++) {
        if (/romaniz|hangul|korean|translat|english|japanese|chinese|kanji/i.test(thMatches[k])) {
          isLyricsTable = true;
          break;
        }
      }

      if (isLyricsTable) {
        var tdMatches = [];
        var tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        var tdM;
        while ((tdM = tdRegex.exec(tbl)) !== null) {
          tdMatches.push(tdM[1]);
        }

        if (tdMatches.length >= thMatches.length) {
          for (var t = 0; t < thMatches.length; t++) {
            var colText = cleanHtmlSection(tdMatches[t]);
            if (colText) {
              sections.push({ name: thMatches[t], text: colText });
            }
          }
          if (sections.length > 0) return sections;
        }
      }
    }
  }

  // 2. Gutenberg block-columns / sequential headers (modern posts)
  var headerRegex = /(?:<strong>(?:<span[^>]*>)?|<th[^>]*>|<h[2-4][^>]*>)\s*(Romanization|Hangul|Korean|Translation|English|Japanese|Chinese|Kanji)\s*(?:<\/span><\/strong>|<\/strong>|<\/th>|<\/h[2-4]>)/gi;
  var matches = [];
  var m;
  while ((m = headerRegex.exec(html)) !== null) {
    matches.push({ name: m[1], index: m.index, matchLen: m[0].length });
  }

  if (matches.length > 0) {
    for (var j = 0; j < matches.length; j++) {
      var name = matches[j].name;
      var start = matches[j].index + matches[j].matchLen;
      var end = (j + 1 < matches.length) ? matches[j + 1].index : html.length;
      var chunk = html.substring(start, end);

      if (j === matches.length - 1) {
        var cutIdx = chunk.search(/<(?:div class="sharedaddy|div id="comments|footer|<div class="wp-block-separator)/i);
        if (cutIdx !== -1) chunk = chunk.substring(0, cutIdx);
      }

      var cleanedText = cleanHtmlSection(chunk);
      if (cleanedText) {
        sections.push({ name: name, text: cleanedText });
      }
    }
    if (sections.length > 0) return sections;
  }

  // 3. Fallback: single-column or plain lyrics body
  var cutStart = html.search(/<hr class="wp-block-separator/i);
  var bodyChunk = cutStart !== -1 ? html.substring(cutStart) : html;
  var cutEnd = bodyChunk.search(/<(?:div class="sharedaddy|div id="comments|footer)/i);
  if (cutEnd !== -1) bodyChunk = bodyChunk.substring(0, cutEnd);
  var fallbackText = cleanHtmlSection(bodyChunk);
  if (fallbackText) {
    sections.push({ name: 'Lyrics', text: fallbackText });
  }

  return sections;
}

function formatSections(sections, preferred) {
  if (!sections || sections.length === 0) return null;
  if (sections.length === 1) return sections[0].text;

  preferred = (preferred || 'all').toLowerCase();
  var i;

  if (preferred === 'rom') {
    for (i = 0; i < sections.length; i++) {
      if (/romaniz/i.test(sections[i].name)) return sections[i].text;
    }
  } else if (preferred === 'original') {
    for (i = 0; i < sections.length; i++) {
      if (/hangul|korean|japanese|chinese|kanji/i.test(sections[i].name)) return sections[i].text;
    }
  } else if (preferred === 'trans') {
    for (i = 0; i < sections.length; i++) {
      if (/translat|english/i.test(sections[i].name)) return sections[i].text;
    }
  }

  // Default 'all': concatenate all sections separated by headings
  var formatted = [];
  for (i = 0; i < sections.length; i++) {
    formatted.push('[' + sections[i].name + ']\n' + sections[i].text);
  }
  return formatted.join('\n\n');
}
