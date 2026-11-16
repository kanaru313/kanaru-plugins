// Helpers shared by search.js and lyrics.js for NhacCuaTui.
// Every file of src/ runs in one global scope when loaded via load('common.js').

var NCT_API = 'https://graph.nhaccuatui.com';
var NCT_LRC_PREFIX = 'https://lyric.nct.vn/';
var DEFAULT_DECRYPT_KEY = 'Lyr1cjust4nct';

function invalidResponse(why) {
  return Response.error(why, { kind: 'invalidResponse' });
}

// GET NCT_API + path with queries.
function nctGet(path, queries) {
  var res = fetch(NCT_API + path, {
    queries: queries,
    headers: {
      'x-nct-appid': '6',
    },
  });

  if (res.status === 429 || res.status === 503) {
    var header = (res.header('retry-after') || '').trim();
    return {
      failure: Response.error('NhacCuaTui asked to slow down', {
        kind: 'rateLimited',
        retryAfterSec: /^\d+$/.test(header) ? parseInt(header, 10) : undefined,
      }),
    };
  }
  if (res.status !== 200) {
    return { failure: Response.error('HTTP ' + res.status, { kind: 'server' }) };
  }

  var json;
  try {
    json = res.json();
  } catch (e) {
    return { failure: invalidResponse('the answer is not valid JSON') };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { failure: invalidResponse('the answer is not a JSON object') };
  }

  // NCT returns code 224 when data does not exist (not a server failure).
  if (json.code === 224) {
    return { empty: true };
  }
  if (json.code !== 0) {
    var msg = typeof json.msg === 'string' && json.msg.trim() !== '' ? ': ' + json.msg.trim() : '';
    return { failure: Response.error('NhacCuaTui error ' + json.code + msg, { kind: 'server' }) };
  }
  return { data: json.data && typeof json.data === 'object' ? json.data : {} };
}

// Decrypts NCT's RC4-encrypted hex string into a UTF-8 string.
function decryptNctLyric(hexStr, keyStr) {
  if (typeof hexStr !== 'string' || typeof keyStr !== 'string') return null;
  var cleanHex = hexStr.trim();
  if (cleanHex.length % 2 !== 0) return null;

  var ciphertext = [];
  for (var r = 0; r < cleanHex.length; r += 2) {
    ciphertext.push(parseInt(cleanHex.substr(r, 2), 16));
  }
  var key = [];
  for (var k = 0; k < keyStr.length; k++) {
    key.push(keyStr.charCodeAt(k));
  }
  var s = new Array(256);
  for (var a = 0; a < 256; a++) s[a] = a;
  var j = 0;
  for (var a = 0; a < 256; a++) {
    j = (s[a] + key[a % key.length] + j) & 255;
    var tmp = s[a];
    s[a] = s[j];
    s[j] = tmp;
  }
  var i = 0;
  j = 0;
  var bytes = new Array(ciphertext.length);
  for (var o = 0; o < ciphertext.length; o++) {
    i = (i + 1) & 255;
    j = (s[i] + j) & 255;
    var tmp2 = s[i];
    s[i] = s[j];
    s[j] = tmp2;
    var t = (s[i] + s[j]) & 255;
    bytes[o] = ciphertext[o] ^ s[t];
  }
  return decodeUtf8(bytes);
}

function decodeUtf8(bytes) {
  var out = '', i = 0;
  while (i < bytes.length) {
    var c = bytes[i++];
    if (c < 0x80) {
      out += String.fromCharCode(c);
    } else if (c > 0xbf && c < 0xe0) {
      out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
    } else if (c > 0xdf && c < 0xf0) {
      out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    } else {
      var cp = (((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)) - 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}
