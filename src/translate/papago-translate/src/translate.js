// Entry of the Naver Papago lyrics translator (`translate` plugin type).
//
// execute({lines, to, song?}) → Response.success([{text, detected?}]), one
// item per input line, in order.
// Uses Naver Papago Translation API (NAVER Cloud Platform or Naver Developers).
load('languages.js');

var NCP_API_URL = 'https://papago.apigw.ntruss.com/nmt/v1/translation';
var DEVELOPERS_API_URL = 'https://openapi.naver.com/v1/papago/n2mt';

function execute(input) {
  var lines = input && input.lines;
  if (!Array.isArray(lines)) return Response.error('The app sent no lines to translate');

  var settings = readSettings();
  var target = targetLang(String(input.to || ''));
  if (!target) return Response.error('Naver Papago cannot translate into "' + input.to + '"');
  if (!settings.clientId || !settings.clientSecret) {
    return Response.error('Configure your Naver Papago Client ID and Client Secret in plugin settings', { kind: 'auth' });
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

  var query = todoLines.join('\n');
  var transRes = callPapago(query, target, settings);
  if (transRes.error) return transRes;

  var transLines = transRes.text.split('\n');
  var detected = transRes.detected;

  // If newline-separated count matches perfectly, map 1:1
  if (transLines.length === todo.length) {
    for (var k = 0; k < todo.length; k++) {
      out[todo[k]] = {
        text: decodeHtml(String(transLines[k] || '').trim()),
        detected: detected,
      };
    }
    return Response.success(out);
  }

  // Fallback: translate line-by-line if multiline output count mismatched
  for (var j = 0; j < todo.length; j++) {
    var singleRes = callPapago(todoLines[j], target, settings);
    if (singleRes.error) return singleRes;
    out[todo[j]] = {
      text: decodeHtml(String(singleRes.text || '').trim()),
      detected: singleRes.detected,
    };
  }

  return Response.success(out);
}

function callPapago(text, target, settings) {
  var isDev = settings.apiType === 'developers';
  var url = isDev ? DEVELOPERS_API_URL : NCP_API_URL;

  var headers = {
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
  };
  if (isDev) {
    headers['X-Naver-Client-Id'] = settings.clientId;
    headers['X-Naver-Client-Secret'] = settings.clientSecret;
  } else {
    headers['X-NCP-APIGW-API-KEY-ID'] = settings.clientId;
    headers['X-NCP-APIGW-API-KEY'] = settings.clientSecret;
  }

  var params = [
    'source=auto',
    'target=' + encodeURIComponent(target),
    'text=' + encodeURIComponent(text),
  ];
  if (target === 'ko' && settings.honorific) {
    params.push('honorific=true');
  }

  var res = fetch(url, {
    method: 'POST',
    headers: headers,
    body: params.join('&'),
    timeout: 25000,
  });

  if (!res.ok) return failure(res);

  var data;
  try {
    data = res.json();
  } catch (e) {
    return Response.error('Naver Papago sent a reply that is not JSON', { kind: 'invalidResponse' });
  }

  var result = data && data.message && data.message.result;
  if (!result || typeof result.translatedText !== 'string') {
    return Response.error('Naver Papago sent an unexpected response structure', { kind: 'invalidResponse' });
  }

  return {
    text: result.translatedText,
    detected: detectedTag(result.srcLangType),
  };
}

function failure(res) {
  var detail = '';
  var isQuota = false;
  try {
    var data = res.json();
    if (data) {
      if (data.error) {
        detail = ': ' + String(data.error.message || data.error.errorCode || '');
        if (data.error.errorCode === '010' || /quota/i.test(data.error.message || '')) isQuota = true;
      } else if (data.errorMessage || data.errorCode) {
        detail = ': ' + String(data.errorMessage || data.errorCode);
        if (/quota/i.test(data.errorMessage || '') || data.errorCode === '010') isQuota = true;
      }
    }
  } catch (_) {}

  var message = 'Naver Papago HTTP ' + res.status + detail;
  var s = res.status;
  if (isQuota) return Response.error(message, { kind: 'quota' });
  if (s === 401 || s === 403) return Response.error(message, { kind: 'auth' });
  if (s === 429) return Response.error(message, { kind: 'rateLimited', retryAfterSec: 2 });
  if (s === 400 || s === 413 || s === 414) return Response.error(message, { kind: 'invalidResponse' });
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
    apiType: readText('apiType', 'ncp'),
    clientId: readText('clientId', ''),
    clientSecret: readText('clientSecret', ''),
    honorific: readBoolean('honorific', false),
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
