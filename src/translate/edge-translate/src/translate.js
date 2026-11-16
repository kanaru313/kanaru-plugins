// Entry of the Edge lyrics translator (`translate` plugin type).
//
// execute({lines, to, song?}) → Response.success([{text, detected?}]), one
// item per input line, in order.
// Uses Microsoft Edge Translation service without requiring an API key.
load('languages.js');

var TRANSLATE_URL = 'https://edge.microsoft.com/translate/translatetext';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

function requestHeaders() {
  return {
    'accept': '*/*',
    'content-type': 'application/json',
    'origin': 'https://play.google.com',
    'referer': 'https://play.google.com/',
    'sec-mesh-client-arch': 'x86_64',
    'sec-mesh-client-edge-channel': 'stable',
    'sec-mesh-client-edge-version': '151.0.4129.72',
    'sec-mesh-client-os': 'Windows',
    'sec-mesh-client-os-version': '10.0.26200',
    'sec-mesh-client-webview': '0',
    'user-agent': UA,
  };
}

function execute(input) {
  var lines = input && input.lines;
  if (!Array.isArray(lines)) return Response.error('The app sent no lines to translate');

  var settings = readSettings();
  var target = targetLang(String(input.to || ''));
  if (!target) return Response.error('Edge Translate cannot translate into "' + input.to + '"');

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

  var url = TRANSLATE_URL + '?to=' + encodeURIComponent(target) + '&isEnterpriseClient=false';
  var res = fetch(url, {
    method: 'POST',
    headers: requestHeaders(),
    body: JSON.stringify(todoLines),
    timeout: 25000,
  });

  if (!res.ok) return failure(res);

  var data;
  try {
    data = res.json();
  } catch (e) {
    return Response.error('Edge Translate sent a reply that is not JSON', { kind: 'invalidResponse' });
  }

  if (!Array.isArray(data) || data.length !== todo.length) {
    return Response.error('Edge Translate returned ' + (Array.isArray(data) ? data.length : 'no') +
      ' translations for ' + todo.length + ' lines', { kind: 'invalidResponse' });
  }

  for (var k = 0; k < todo.length; k++) {
    var item = data[k];
    var transText = item && item.translations && item.translations[0] ? item.translations[0].text : '';
    var detected = item && item.detectedLanguage ? item.detectedLanguage.language : undefined;
    out[todo[k]] = {
      text: decodeHtml(String(transText || '').trim()),
      detected: detectedTag(detected),
    };
  }

  return Response.success(out);
}

function failure(res) {
  var detail = '';
  try {
    var data = res.json();
    if (data && (data.error || data.message)) {
      detail = ': ' + String(data.error.message || data.error || data.message).slice(0, 300);
    }
  } catch (_) {}

  var message = 'Edge Translate HTTP ' + res.status + detail;
  var s = res.status;
  if (s === 401 || s === 403) return Response.error(message, { kind: 'auth' });
  if (s === 429) return Response.error(message, { kind: 'rateLimited' });
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
    keepSymbols: readBoolean('keepSymbols', true),
  };
}

function readBoolean(key, fallback) {
  var value = localConfig.getItem(key);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return fallback;
}
