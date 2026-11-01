// Entry of the DeepL lyrics translator (`translate` plugin type).
//
// execute({lines, to, song?}) → Response.success([{text, detected?}]), one
// item per input line, in order. DeepL detects the source language per line.
// One POST per chunk (the host cuts chunks to `translate.maxLines`/`maxChars`,
// inside DeepL's 50 texts and 128 KiB per request).
load('languages.js');

var FREE_HOST = 'api-free.deepl.com';
var PRO_HOST = 'api.deepl.com';

function execute(input) {
  var lines = input && input.lines;
  if (!Array.isArray(lines)) return Response.error('The app sent no lines to translate');
  var settings = readSettings();
  var target = targetLang(String(input.to || ''), settings);
  if (!target) return Response.error('DeepL cannot translate into "' + input.to + '"');
  if (!settings.apiKey) return Response.error('Add a DeepL API key in the plugin settings', { kind: 'auth' });

  // Blank lines and lines without letters (♪, "...", "(x2)") go back as they are.
  var out = lines.map(function (line) {
    return hasWords(line) ? null : { text: String(line == null ? '' : line) };
  });
  var todo = [];
  for (var i = 0; i < lines.length; i++) if (!out[i]) todo.push(i);
  if (todo.length === 0) return Response.success(out);

  var body = { text: todo.map(function (i) { return String(lines[i]); }), target_lang: target };
  if (settings.formality !== 'default') body.formality = settings.formality;
  var context = settings.useSongContext ? songContext(input.song) : '';
  if (context) body.context = context;

  var host = /:fx$/.test(settings.apiKey) ? FREE_HOST : PRO_HOST;
  var res = fetch('https://' + host + '/v2/translate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'DeepL-Auth-Key ' + settings.apiKey,
    },
    body: JSON.stringify(body),
    timeout: 25000,
  });
  if (!res.ok) return failure(res);

  var data;
  try {
    data = res.json();
  } catch (e) {
    return Response.error('DeepL sent a reply that is not JSON', { kind: 'invalidResponse' });
  }
  var translations = data && data.translations;
  if (!Array.isArray(translations) || translations.length !== todo.length) {
    return Response.error('DeepL returned ' + (Array.isArray(translations) ? translations.length : 'no') +
      ' translations for ' + todo.length + ' lines', { kind: 'invalidResponse' });
  }
  for (var k = 0; k < todo.length; k++) {
    var t = translations[k];
    if (!t || typeof t.text !== 'string') {
      return Response.error('DeepL returned a translation without text', { kind: 'invalidResponse' });
    }
    out[todo[k]] = { text: t.text.trim(), detected: detectedTag(t.detected_source_language) };
  }
  return Response.success(out);
}

/** Maps a DeepL HTTP error to the host's error kinds. */
function failure(res) {
  var detail = '';
  try {
    var data = res.json();
    detail = data && data.message ? ': ' + String(data.message).slice(0, 300) : '';
  } catch (e) {}
  var message = 'DeepL HTTP ' + res.status + detail;
  var s = res.status;
  if (s === 403 || s === 401) return Response.error(message, { kind: 'auth' });
  if (s === 456) return Response.error(message, { kind: 'quota' });
  if (s === 429 || s === 529) {
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

/** `context` text for DeepL (not translated, not billed), or '' without a song. */
function songContext(song) {
  if (!song) return '';
  var title = String(song.title || '').trim();
  var artist = String(song.artist || '').trim();
  if (!title && !artist) return '';
  var text = 'Song lyrics' + (title ? ': "' + title + '"' : '') + (artist ? ' by ' + artist : '');
  return text.slice(0, 500);
}

/** Whether [line] has a letter in any script, repeat marks like "(x2)" aside. */
function hasWords(line) {
  if (typeof line !== 'string') return false;
  return /\p{L}/u.test(line.replace(/[(\[]?\s*[x×]\s*\d+\s*[)\]]?/gi, ''));
}

function readSettings() {
  return {
    apiKey: readText('apiKey', '').trim(),
    formality: readText('formality', 'default'),
    useSongContext: readText('useSongContext', 'true') === 'true',
    englishVariant: readText('englishVariant', 'en-US'),
    portugueseVariant: readText('portugueseVariant', 'pt-BR'),
  };
}

function readText(key, fallback) {
  var value = localConfig.getItem(key);
  return value === null || value === undefined || value === '' ? fallback : String(value);
}
