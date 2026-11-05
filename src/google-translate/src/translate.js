// Entry of the Google Translate lyrics translator (`translate` plugin type).
//
// execute({lines, to, song?}) → Response.success([{text, detected?}]), one
// item per input line, in order.
// Supports:
// 1. Free Google Translate endpoint (translate.googleapis.com / translate.google.com)
//    without requiring an API key.
// 2. Google Cloud Translation API v2 if one or more API keys are provided.
load('languages.js');

var FAILURE_RANK = { auth: 1, quota: 2, rateLimited: 3 };

function execute(input) {
  var lines = input && input.lines;
  if (!Array.isArray(lines)) return Response.error('The app sent no lines to translate');

  var settings = readSettings();
  var target = targetLang(String(input.to || ''));
  if (!target) return Response.error('Google Translate cannot translate into "' + input.to + '"');

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

  var response;
  if (settings.apiKeys && settings.apiKeys.length > 0) {
    response = translateCloud(todoLines, target, settings.apiKeys);
  } else {
    response = translateFree(todoLines, target, settings.serviceHost);
  }

  if (response.error) return response;

  var translations = response.ok;
  for (var k = 0; k < todo.length; k++) {
    out[todo[k]] = translations[k];
  }

  return Response.success(out);
}

/** Translates via the free Google Translate web endpoint. */
function translateFree(lines, targetLangCode, serviceHost) {
  var host = serviceHost || 'translate.googleapis.com';
  var url = 'https://' + host + '/translate_a/t?client=gtx&sl=auto&tl=' + encodeURIComponent(targetLangCode);
  var body = lines.map(function (line) {
    return 'q=' + encodeURIComponent(line);
  }).join('&');

  var res = fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=utf-8',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    body: body,
    timeout: 25000,
  });

  if (!res.ok) return failure(res, 'Google Translate');

  var data;
  try {
    data = res.json();
  } catch (e) {
    return Response.error('Google Translate sent a reply that is not JSON', { kind: 'invalidResponse' });
  }

  if (!Array.isArray(data) || data.length !== lines.length) {
    return Response.error('Google Translate returned ' + (Array.isArray(data) ? data.length : 'no') +
      ' translations for ' + lines.length + ' lines', { kind: 'invalidResponse' });
  }

  var results = [];
  for (var i = 0; i < lines.length; i++) {
    var item = data[i];
    var transText = Array.isArray(item) ? item[0] : (typeof item === 'string' ? item : '');
    var detected = Array.isArray(item) ? item[1] : undefined;
    results.push({
      text: decodeHtml(String(transText || '').trim()),
      detected: detectedTag(detected),
    });
  }
  return Response.success(results);
}

/** Translates via Google Cloud Translation API v2 with automatic key rotation. */
function translateCloud(lines, targetLangCode, apiKeys) {
  var urlBase = 'https://translation.googleapis.com/language/translate/v2?key=';
  var body = JSON.stringify({
    q: lines,
    target: targetLangCode,
    format: 'text',
  });

  var bestFailure = null;

  for (var k = 0; k < apiKeys.length; k++) {
    var key = apiKeys[k];
    var res = fetch(urlBase + encodeURIComponent(key), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: body,
      timeout: 25000,
    });

    if (res.ok) {
      var data;
      try {
        data = res.json();
      } catch (e) {
        return Response.error('Google Cloud Translation sent a reply that is not JSON', { kind: 'invalidResponse' });
      }
      var list = data && data.data && data.data.translations;
      if (!Array.isArray(list) || list.length !== lines.length) {
        return Response.error('Google Cloud Translation returned ' + (Array.isArray(list) ? list.length : 'no') +
          ' translations for ' + lines.length + ' lines', { kind: 'invalidResponse' });
      }
      var results = [];
      for (var i = 0; i < lines.length; i++) {
        var item = list[i];
        results.push({
          text: decodeHtml(String((item && item.translatedText) || '').trim()),
          detected: detectedTag(item && item.detectedSourceLanguage),
        });
      }
      return Response.success(results);
    }

    var fail = failure(res, 'Google Cloud Translation');
    var isKeyError = res.status === 401 || res.status === 403 || res.status === 429 || res.status === 400;
    if (!isKeyError) return fail;
    if (!bestFailure || FAILURE_RANK[fail.kind] > FAILURE_RANK[bestFailure.kind]) {
      bestFailure = fail;
    }
  }

  return bestFailure || Response.error('All Google Cloud Translation API keys failed', { kind: 'auth' });
}

/** Maps HTTP errors to standard host error kinds. */
function failure(res, prefix) {
  var name = prefix || 'Google Translate';
  var detail = '';
  try {
    var data = res.json();
    if (data && data.error) {
      detail = ': ' + String(data.error.message || data.error).slice(0, 300);
    } else if (data && data.message) {
      detail = ': ' + String(data.message).slice(0, 300);
    }
  } catch (e) {}

  var message = name + ' HTTP ' + res.status + detail;
  var s = res.status;
  if (s === 401 || s === 403) return Response.error(message, { kind: 'auth' });
  if (s === 429) {
    var options = { kind: 'rateLimited' };
    var wait = retryAfter(res);
    if (wait !== undefined) options.retryAfterSec = wait;
    return Response.error(message, options);
  }
  if (s === 400 || s === 413 || s === 414) return Response.error(message, { kind: 'invalidResponse' });
  return Response.error(message, { kind: 'server' });
}

/** Seconds from the `Retry-After` header, when it is a plain number. */
function retryAfter(res) {
  var raw = res.header('retry-after');
  var value = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
  return value >= 0 ? Math.ceil(value) : undefined;
}

/** Whether [line] has a letter in any script, repeat marks like "(x2)" aside. */
function hasWords(line) {
  if (typeof line !== 'string') return false;
  return /\p{L}/u.test(line.replace(/[(\[]?\s*[x×]\s*\d+\s*[)\]]?/gi, ''));
}

/** Decodes common HTML entities returned by translation engines. */
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
    serviceHost: readText('serviceHost', 'translate.googleapis.com'),
    apiKeys: readApiKeys(),
    keepSymbols: readBoolean('keepSymbols', true),
  };
}

function readApiKeys() {
  var val = localConfig.getItem('apiKeys');
  if (Array.isArray(val)) {
    var list = [];
    for (var i = 0; i < val.length; i++) {
      var item = typeof val[i] === 'string' ? val[i].trim() : String(val[i] || '').trim();
      if (item && list.indexOf(item) === -1) list.push(item);
    }
    return list;
  }
  var keys = [];
  readText('apiKeys', '').split(/[\s,;]+/).forEach(function (key) {
    if (key && keys.indexOf(key) === -1) keys.push(key);
  });
  return keys;
}

function readText(key, fallback) {
  var value = localConfig.getItem(key);
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function readBoolean(key, fallback) {
  var value = localConfig.getItem(key);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return fallback;
}
