// Shared helpers for J-Lyric plugin.
// Loaded via load('common.js') into the shared global execution scope.

var JLYRIC_HOST = 'https://j-lyric.net';
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
    .replace(/&#(\d+);/g, function(match, dec) {
      return String.fromCharCode(dec);
    })
    .replace(/&#x([0-9a-fA-F]+);/g, function(match, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });
}

function cleanLyrics(html) {
  if (!html) return '';
  // 1. Remove ruby annotation reading tags <rt>...</rt> so text is clean
  var s = html.replace(/<rt>[\s\S]*?<\/rt>/gi, '');
  // 2. Convert <br> or <br/> into newlines
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // 3. Remove all other remaining HTML tags
  s = s.replace(/<[^>]+>/g, '');
  // 4. Decode HTML entities
  s = htmlDecode(s);
  // 5. Normalize newlines and trim
  var lines = s.split('\n');
  var cleanedLines = [];
  var lastEmpty = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line === '') {
      if (!lastEmpty && cleanedLines.length > 0) {
        cleanedLines.push('');
        lastEmpty = true;
      }
    } else {
      cleanedLines.push(line);
      lastEmpty = false;
    }
  }
  while (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1] === '') {
    cleanedLines.pop();
  }
  return cleanedLines.join('\n');
}
