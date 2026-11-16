// Entry of the Baidu lyrics translator (`translate` plugin type).
//
// execute({lines, to, song?}) → Response.success([{text, detected?}]), one
// item per input line, in order.
// Uses Baidu Translation Open API (https://fanyi-api.baidu.com).
load('crypto.js');
load('languages.js');

var BAIDU_API_URL = 'https://fanyi-api.baidu.com/api/trans/vip/translate';

function execute(input) {
  var lines = input && input.lines;
  if (!Array.isArray(lines)) return Response.error('The app sent no lines to translate');

  var settings = readSettings();
  var target = targetLang(String(input.to || ''));
  if (!target) return Response.error('Baidu Translate cannot translate into "' + input.to + '"');
  if (!settings.appId || !settings.appSecret) {
    return Response.error('Configure your Baidu App ID and Secret Key in plugin settings', { kind: 'auth' });
  }

  // Blank lines and symbol lines without letters (♪, "...", "(x2)") go back as they are.
  var out = lines.map(function (line) {
    return (settings.keepSymbols && !hasWords(line)) ? { text: String(line == null ? '' : line) } : null;
  });

  var todo = [];
  for (var i = 0; i < lines.length; i++) {
    if (!out[i]) todo.push(i);
  }
  if (todo.length === 0) return Response.success(out);

  var todoLines = todo.map(function (idx) {
    return String(lines[idx] == null ? '' : lines[idx]);
  });

  var salt = String(Date.now() || new Date().getTime());
  var query = todoLines.join('\n');
  var signStr = settings.appId + query + salt + settings.appSecret;
  var sign = '';
  if (typeof CryptoJS !== 'undefined' && CryptoJS.MD5) {
    sign = CryptoJS.MD5(signStr).toString();
  } else {
    return Response.error('MD5 cryptographic engine unavailable', { kind: 'server' });
  }

  var params = [
    'q=' + encodeURIComponent(query),
    'from=auto',
    'to=' + encodeURIComponent(target),
    'appid=' + encodeURIComponent(settings.appId),
    'salt=' + encodeURIComponent(salt),
    'sign=' + encodeURIComponent(sign),
  ].join('&');

  var res = fetch(BAIDU_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
    body: params,
    timeout: 25000,
  });

  if (!res.ok) return failure(res);

  var data;
  try {
    data = res.json();
  } catch (e) {
    return Response.error('Baidu Translate sent a reply that is not JSON', { kind: 'invalidResponse' });
  }

  if (data && data.error_code && String(data.error_code) !== '52000') {
    return baiduError(data);
  }

  var transList = data && data.trans_result;
  if (!Array.isArray(transList) || transList.length !== todo.length) {
    return Response.error('Baidu Translate returned ' + (Array.isArray(transList) ? transList.length : 'no') +
      ' translations for ' + todo.length + ' lines', { kind: 'invalidResponse' });
  }

  var detected = detectedTag(data.from);
  for (var k = 0; k < todo.length; k++) {
    var item = transList[k];
    out[todo[k]] = {
      text: decodeHtml(String((item && item.dst) || '').trim()),
      detected: detected,
    };
  }

  return Response.success(out);
}

function baiduError(data) {
  var code = String(data.error_code);
  var msg = String(data.error_msg || ('error ' + code));
  var message = 'Baidu Translate ' + code + ': ' + msg;

  if (code === '52003' || code === '54001' || code === '58000') {
    return Response.error(message, { kind: 'auth' });
  }
  if (code === '54003') {
    return Response.error(message, { kind: 'rateLimited', retryAfterSec: 2 });
  }
  if (code === '54004') {
    return Response.error(message, { kind: 'quota' });
  }
  if (code === '54000' || code === '58001') {
    return Response.error(message, { kind: 'invalidResponse' });
  }
  return Response.error(message, { kind: 'server' });
}

function failure(res) {
  var message = 'Baidu Translate HTTP ' + res.status;
  var s = res.status;
  if (s === 401 || s === 403) return Response.error(message, { kind: 'auth' });
  if (s === 429) return Response.error(message, { kind: 'rateLimited' });
  return Response.error(message, { kind: 'server' });
}

function hasWords(line) {
  if (typeof line !== 'string') return false;
  return /\p{L}/u.test(line.replace(/[(\[]?\s*[x×]\s*\d+\s*[)\]]?/gi, ''));
}

function decodeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ');
}

function readSettings() {
  return {
    appId: readText('appId', ''),
    appSecret: readText('appSecret', ''),
    keepSymbols: readBoolean('keepSymbols', true),
  };
}

function readText(key, fallback) {
  var value = localConfig.getItem(key);
  return value === null || value === undefined || value === '' ? fallback : String(value).trim();
}

function readBoolean(key, fallback) {
  var value = localConfig.getItem(key);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return fallback;
}
