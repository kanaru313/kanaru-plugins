// Common helpers for Kuwo Music plugin.
var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function kuwoGet(url, headers) {
  var reqHeaders = {
    'User-Agent': USER_AGENT,
    'Referer': 'https://www.kuwo.cn/',
    'Accept': 'application/json, text/plain, */*',
  };
  if (headers) {
    for (var k in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, k)) {
        reqHeaders[k] = headers[k];
      }
    }
  }

  var res = fetch(url, {
    method: 'GET',
    headers: reqHeaders,
    timeout: 15000,
  });

  if (!res.ok) {
    return { failure: failure(res) };
  }

  try {
    return { data: res.json() };
  } catch (e) {
    return { failure: Response.error('Kuwo Music sent invalid JSON', { kind: 'invalidResponse' }) };
  }
}

function failure(res) {
  var message = 'Kuwo Music HTTP ' + res.status;
  if (res.status === 429) {
    return Response.error(message, { kind: 'rateLimited', retryAfterSec: 5 });
  }
  return Response.error(message, { kind: 'server' });
}

function formatLrcTime(sec) {
  var total = parseFloat(sec) || 0;
  var m = Math.floor(total / 60);
  var s = total % 60;
  var mStr = (m < 10 ? '0' : '') + m;
  var sStr = (s < 10 ? '0' : '') + s.toFixed(2);
  return '[' + mStr + ':' + sStr + ']';
}

function decodeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&#(\d+);/g, function (match, dec) {
      return String.fromCharCode(dec);
    })
    .replace(/&#x([0-9a-f]+);/gi, function (match, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    })
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

var CREDIT_PREFIXES = [
  '作词', '作曲', '词', '曲', '编曲', '制作人', '合声', '混音', '母带',
  '吉他', '贝斯', '鼓', '键盘', '弦乐', '录音', '监制',
  'Written by', 'Composed by', 'Arranged by', 'Produced by',
];

function isCredit(line) {
  var trimmed = line.trim();
  for (var i = 0; i < CREDIT_PREFIXES.length; i++) {
    var p = CREDIT_PREFIXES[i];
    if (trimmed.indexOf(p + '：') === 0 || trimmed.indexOf(p + ':') === 0 || trimmed.indexOf(p + ' ') === 0) {
      return true;
    }
  }
  return false;
}
