// Helpers shared by search.js and lyrics.js. A script reaches this file with
// load('common.js'): every file of src/ runs in one global scope.
//
// Kugou Music (酷狗音乐) desktop lyrics API client. Communicates with lyrics.kugou.com.
var KUGOU_SEARCH_URL = 'https://lyrics.kugou.com/search';
var KUGOU_DOWNLOAD_URL = 'https://lyrics.kugou.com/download';

var KUGOU_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

var PURE_MUSIC = /^(此歌曲为(?:没有填词的)?)?纯音乐[，,\s]*请(您)?欣赏[。.!！]?$/;
var TIME_TAG = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g;
var META_LINE = /^\[[a-z0-9_#$]+:.*\]$/i;

var CREDIT_ROOTS = [
  '作词', '作詞', '作曲', '编曲', '編曲', '制作', '监制', '混音', '母带',
  '录音', '錄音', '和声', '和聲', '和音', '吉他', '贝斯', '貝斯', '鼓手',
  '弦乐', '弦樂', '键盘', '鍵盤', '钢琴', '鋼琴', '配唱', '出品', '发行',
  '發行', '企划', '企劃', '统筹', '統籌', '策划', '策劃', '演唱', '原唱', '翻唱'
];

var CREDIT = new RegExp(
  '^\\s*(?:(?:written|composed|arranged|arranger|produced|producer|lyrics?|mixed|mastered|recorded|vocals?|guitars?|bass|drums?)\\s*(?:by)?|(?:' +
  CREDIT_ROOTS.join('|') + ')[\u3400-\u9fff]{0,6}|词|曲)\\s*[:：]', 'i');

function invalidResponse(why) {
  return Response.error(why, { kind: 'invalidResponse' });
}

function htmlDecode(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#58;/g, ':')
    .replace(/&#32;/g, ' ')
    .replace(/&#40;/g, '(')
    .replace(/&#41;/g, ')')
    .replace(/&#(\d+);/g, function(match, dec) {
      return String.fromCharCode(dec);
    })
    .replace(/&amp;/g, '&');
}

function kugouGet(url, queries) {
  var res = fetch(url, {
    headers: KUGOU_HEADERS,
    queries: queries
  });

  if (res.status === 429) {
    var retryAfter = 60;
    var h = res.header('retry-after');
    if (h) {
      var parsed = parseInt(h, 10);
      if (!isNaN(parsed) && parsed > 0) retryAfter = parsed;
    }
    return { failure: Response.error('rate limited by Kugou Music', { kind: 'rateLimited', retryAfterSec: retryAfter }) };
  }

  if (res.status !== 200) {
    return { failure: Response.error('HTTP ' + res.status + ' from Kugou Music', { kind: 'server' }) };
  }

  var data;
  try {
    data = res.json();
  } catch (e) {
    return { failure: invalidResponse('bad JSON response from Kugou Music') };
  }

  return { data: data };
}

function base64ToBytes(b64) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var lookup = [];
  for (var c = 0; c < 256; c++) lookup[c] = 0;
  for (var i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;

  var len = b64.length;
  while (len > 0 && b64.charAt(len - 1) === '=') len--;

  var bytes = [];
  var u = 0, bits = 0;
  for (var j = 0; j < len; j++) {
    var code = b64.charCodeAt(j);
    if (code <= 32) continue;
    var val = lookup[code];
    u = (u << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((u >>> bits) & 0xff);
    }
  }
  return bytes;
}

function decodeUtf8(bytes) {
  var out = '';
  var i = 0;
  while (i < bytes.length) {
    var c1 = bytes[i++];
    if (c1 < 0x80) {
      out += String.fromCharCode(c1);
    } else if (c1 > 0xbf && c1 < 0xe0) {
      var c2 = bytes[i++];
      out += String.fromCharCode(((c1 & 0x1f) << 6) | (c2 & 0x3f));
    } else if (c1 > 0xdf && c1 < 0xf0) {
      var c2 = bytes[i++];
      var c3 = bytes[i++];
      out += String.fromCharCode(((c1 & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f));
    } else {
      var c2 = bytes[i++];
      var c3 = bytes[i++];
      var c4 = bytes[i++];
      var cp = (((c1 & 0x07) << 18) | ((c2 & 0x3f) << 12) | ((c3 & 0x3f) << 6) | (c4 & 0x3f)) - 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}

function base64ToString(b64) {
  if (!b64 || typeof b64 !== 'string') return '';
  return decodeUtf8(base64ToBytes(b64.trim()));
}

function content(line) {
  return line.replace(TIME_TAG, '').trim().normalize('NFC');
}

function realLines(text) {
  var out = [];
  var all = text.split(/\r?\n/);
  for (var i = 0; i < all.length; i++) {
    var c = content(all[i]);
    if (c !== '' && !META_LINE.test(c) && !CREDIT.test(c)) {
      out.push(c);
    }
  }
  return out;
}

function stripCredits(text) {
  var all = text.split(/\r?\n/);
  var start = 0;
  for (var i = 0; i < all.length; i++) {
    var c = content(all[i]);
    if (CREDIT.test(c)) start = i + 1;
    else if (c !== '' && !META_LINE.test(c)) break;
  }
  var end = all.length;
  while (end > start) {
    var rawLine = all[end - 1].trim();
    var d = content(rawLine);
    if (rawLine === '' || CREDIT.test(d)) end--;
    else break;
  }
  if (start === 0 && end === all.length) return text;
  return all.slice(start, end).join('\n');
}
