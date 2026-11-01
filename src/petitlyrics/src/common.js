// Helpers shared by search.js and lyrics.js. A script reaches this file with
// load('common.js'): every file of src/ runs in one global scope.
//
// PetitLyrics (プチリリ) API client. Communicates with on.petitlyrics.com.
var PETIT_URL = 'https://on.petitlyrics.com/api/GetPetitLyricsData.php';
var PETIT_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
  'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 5.1.1; LM-G820UM Build/LMY48Z)'
};

var PETIT_BASE_PARAMS = {
  sdkVer: '1.3.4',
  userId: '642bbdc6-128a-4b67-a10b-bc09191b0cfe',
  appName: 'HF Player',
  pkgName: 'com.onkyo.jp.musicplayer',
  clientAppId: 'on354007',
  index: '0',
  logFlag: '0',
  verCode: '212',
  verName: '2.7.0',
  terminalType: '0'
};

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

function encodeForm(params) {
  var parts = [];
  for (var k in params) {
    if (Object.prototype.hasOwnProperty.call(params, k) && params[k] !== null && params[k] !== undefined) {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])));
    }
  }
  return parts.join('&');
}

function petitPost(params) {
  var merged = {};
  for (var k in PETIT_BASE_PARAMS) {
    merged[k] = PETIT_BASE_PARAMS[k];
  }
  if (params) {
    for (var k2 in params) {
      merged[k2] = params[k2];
    }
  }

  var body = encodeForm(merged);
  var res = fetch(PETIT_URL, {
    method: 'POST',
    headers: PETIT_HEADERS,
    body: body
  });

  if (res.status === 429) {
    var retryAfter = 60;
    var h = res.header('retry-after');
    if (h) {
      var parsed = parseInt(h, 10);
      if (!isNaN(parsed) && parsed > 0) retryAfter = parsed;
    }
    return { failure: Response.error('rate limited by PetitLyrics', { kind: 'rateLimited', retryAfterSec: retryAfter }) };
  }

  if (res.status !== 200) {
    return { failure: Response.error('HTTP ' + res.status + ' from PetitLyrics', { kind: 'server' }) };
  }

  var xml = res.text('utf-8');
  return { xml: xml };
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

function formatTime(ms) {
  var totalHundredths = Math.floor(ms / 10);
  var cs = totalHundredths % 100;
  var totalSeconds = Math.floor(ms / 1000);
  var sec = totalSeconds % 60;
  var min = Math.floor(totalSeconds / 60);
  var mm = (min < 10 ? '0' : '') + min;
  var ss = (sec < 10 ? '0' : '') + sec;
  var xx = (cs < 10 ? '0' : '') + cs;
  return '[' + mm + ':' + ss + '.' + xx + ']';
}

function parseWsy(wsyXml) {
  var lines = [];
  var lineRegex = /<line>([\s\S]*?)<\/line>/g;
  var match;
  while ((match = lineRegex.exec(wsyXml)) !== null) {
    var lineContent = match[1];
    var strMatch = lineContent.match(/<linestring>([\s\S]*?)<\/linestring>/);
    var timeMatch = lineContent.match(/<starttime>(\d+)<\/starttime>/);
    var text = strMatch ? htmlDecode(strMatch[1]).trim() : '';
    var ms = timeMatch ? parseInt(timeMatch[1], 10) : 0;
    lines.push(formatTime(ms) + (text !== '' ? ' ' + text : ''));
  }
  return lines.join('\n');
}

function decodeLsy(lsyBytes, plainText) {
  var textLines = plainText.replace(/\r\n?/g, '\n').split('\n');
  if (lsyBytes.length < 0xcc) return null;

  var protectionId = lsyBytes[0x1a] | (lsyBytes[0x1a + 1] << 8);
  var protectionKeySwitchFlag = lsyBytes[0x19] !== 0;
  var protectionKey = protectionId;

  if (protectionKeySwitchFlag) {
    var A = 0x3, B = 0xc, C = 0x30, D = 0xc0;
    var E = 0x300, F = 0xc00, G = 0x3000, H = 0xc000;
    protectionKey = (protectionKey & A) |
      ((protectionKey & B) << 2) |
      ((protectionKey & C) >> 2) |
      ((protectionKey & D) << 2) |
      ((protectionKey & E) >> 2) |
      ((protectionKey & F) << 2) |
      ((protectionKey & G) >> 2) |
      (protectionKey & H);
    protectionKey = protectionKey & 0xffff;
  }

  var lineCount = (lsyBytes[0x38] | (lsyBytes[0x39] << 8) | (lsyBytes[0x3a] << 16) | (lsyBytes[0x3b] << 24)) >>> 0;
  var out = [];
  var elapsedTime = 0;
  var textIndex = 0;

  for (var i = 0; i < lineCount; i++) {
    var timeIndex = i * 2 + 0xcc;
    if (timeIndex + 1 >= lsyBytes.length) break;
    var timeRaw = lsyBytes[timeIndex] | (lsyBytes[timeIndex + 1] << 8);
    var timeCs = (timeRaw ^ protectionKey) & 0xffff;
    timeCs = (timeCs % 65536) + 65536 * Math.floor(elapsedTime / 65536);
    if (timeCs < elapsedTime) {
      timeCs += 65536;
    }
    elapsedTime = timeCs;
    var stamp = formatTime(timeCs * 10);
    var line = textIndex < textLines.length ? textLines[textIndex++] : '';
    out.push(stamp + (line !== '' ? ' ' + line : ''));
  }

  return out.join('\n');
}

function decodeLyricsData(typeStr, b64Data, plainTextProvider) {
  if (!b64Data || typeof b64Data !== 'string') return null;

  if (typeStr === '3') {
    var bytes = base64ToBytes(b64Data);
    var wsyXml = decodeUtf8(bytes);
    var lrc = parseWsy(wsyXml);
    return lrc !== '' ? { data: lrc, type: 'lrc' } : null;
  }

  if (typeStr === '2') {
    var lsyBytes = base64ToBytes(b64Data);
    var plainText = typeof plainTextProvider === 'function' ? plainTextProvider() : null;
    if (!plainText) return null;
    var decoded = decodeLsy(lsyBytes, plainText);
    return decoded !== null ? { data: decoded, type: 'lrc' } : null;
  }

  if (typeStr === '1') {
    var plainBytes = base64ToBytes(b64Data);
    var plain = decodeUtf8(plainBytes).trim();
    return plain !== '' ? { data: plain, type: 'txt' } : null;
  }

  return null;
}
