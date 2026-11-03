// Entry of the DeepSeek lyrics translator (`translate` plugin type).
//
// execute({lines, to, song?}) → Response.success([{text, detected?}])
load('prompts.js');
load('deepseek.js');

var MODELS = [
  'deepseek-flash', 'deepseek-flash-thinking',
  'deepseek-v4-pro', 'deepseek-v4-pro-thinking',
  'deepseek-chat', 'deepseek-reasoner',
];
var DEFAULT_MODEL = 'deepseek-flash';

function execute(input) {
  var lines = input && input.lines;
  if (!Array.isArray(lines)) return Response.error('The app sent no lines to translate');
  var to = String(input.to || '');
  if (!LANGUAGE_NAMES[to]) return Response.error('DeepSeek plugin does not know the language "' + to + '"');

  var settings = readSettings();
  if (settings.apiKeys.length === 0) {
    return Response.error('Add a DeepSeek API key in the plugin settings', { kind: 'auth' });
  }

  // Blank lines and lines without letters (♪, "...", "(x2)") go back as they are.
  var out = lines.map(function (line) {
    return hasWords(line) ? null : { text: String(line == null ? '' : line) };
  });
  var todo = [];
  for (var i = 0; i < lines.length; i++) if (!out[i]) todo.push(i);
  if (todo.length === 0) return Response.success(out);

  var system = buildSystemPrompt(settings.systemPrompt, to, settings,
    settings.useSongContext ? input.song : null);

  var budget = { left: 10 };
  var first = translateLines(lines, todo, system, settings, input.song, budget);
  if (first.error) return Response.error(first.error, errorOptions(first));
  applyItems(out, first.items);

  var again = todo.filter(function (i) { return needsRetry(out[i], lines[i], to); });
  if (again.length && settings.retryUntranslated && budget.left > 0) {
    var second = translateLines(lines, again, system, settings, input.song, budget);
    if (!second.error) applyItems(out, second.items, true);
  }

  var missing = todo.filter(function (i) { return !out[i]; }).length;
  if (missing) {
    return Response.error('DeepSeek returned no translation for ' + missing + ' of ' + todo.length + ' lines',
      { kind: 'invalidResponse' });
  }
  return Response.success(out);
}

function translateLines(lines, indexes, system, settings, song, budget) {
  var message = { lines: indexes.map(function (i) { return { i: i, t: String(lines[i]) }; }) };
  if (settings.useSongContext && song) {
    message.song = { title: song.title || undefined, artist: song.artist || undefined, lyrics: song.lyrics || undefined };
  }
  var answer = callDeepSeek(deepSeekRequest(system, JSON.stringify(message), settings), settings, budget);
  if (answer.error) return answer;

  var parsed;
  try {
    parsed = JSON.parse(stripCodeFence(answer.text));
  } catch (e) {
    return { error: 'DeepSeek answer is not the expected JSON', kind: 'invalidResponse' };
  }
  if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.lines)) parsed = parsed.lines;
  if (!Array.isArray(parsed)) return { error: 'DeepSeek answer is not a list of lines', kind: 'invalidResponse' };

  var asked = {};
  indexes.forEach(function (i) { asked[i] = true; });
  var items = {};
  parsed.forEach(function (item) {
    if (!item || typeof item.t !== 'string' || !asked[item.i] || items[item.i]) return;
    var text = item.t.trim();
    if (text) items[item.i] = { text: text, detected: typeof item.l === 'string' && item.l ? item.l : undefined };
  });
  return { items: items };
}

function applyItems(out, items, replace) {
  for (var key in items) {
    var i = Number(key);
    if (!out[i] || replace) out[i] = items[key];
  }
}

function needsRetry(item, line, to) {
  if (!item) return true;
  if (item.text !== String(line).trim()) return false;
  if (!item.detected || baseLanguage(item.detected) === baseLanguage(to)) return false;
  var source = String(line).trim();
  var words = source.split(/\s+/).length;
  return words >= 4 || (words === 1 && source.length >= 6 && /[^\x00-\x7F]/.test(source));
}

function baseLanguage(code) {
  return String(code).toLowerCase().split(/[-_]/)[0];
}

function hasWords(line) {
  if (typeof line !== 'string') return false;
  return /\p{L}/u.test(line.replace(/[(\[]?\s*[x×]\s*\d+\s*[)\]]?/gi, ''));
}

function stripCodeFence(text) {
  var value = String(text).trim();
  var m = /^```(?:json)?\s*\n([\s\S]*?)\n?\s*```$/i.exec(value);
  if (m) return m[1].trim();
  var firstBracket = value.indexOf('[');
  var firstBrace = value.indexOf('{');
  var start = -1;
  var end = -1;
  if (firstBracket >= 0 && (firstBrace === -1 || firstBracket < firstBrace)) {
    start = firstBracket;
    end = value.lastIndexOf(']');
  } else if (firstBrace >= 0) {
    start = firstBrace;
    end = value.lastIndexOf('}');
  }
  if (start >= 0 && end > start) return value.slice(start, end + 1);
  return value;
}

function errorOptions(result) {
  var options = {};
  if (result.kind) options.kind = result.kind;
  if (result.retryAfterSec !== undefined) options.retryAfterSec = result.retryAfterSec;
  return options;
}

// ---- settings ---------------------------------------------------------------

function readSettings() {
  return {
    apiKeys: readApiKeys(),
    model: normalizeModel(readText('model', DEFAULT_MODEL)),
    style: readText('style', 'natural'),
    temperature: readNumber('temperature', 0.2, 0, 2),
    maxOutputTokens: Math.round(readNumber('maxOutputTokens', 4096, 256, 8192)),
    retryUntranslated: readBoolean('retryUntranslated', true),
    useSongContext: readBoolean('useSongContext', true),
    customInstruction: readText('customInstruction', '').trim(),
    systemPrompt: readText('systemPrompt', '').trim(),
  };
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

function readNumber(key, fallback, min, max) {
  var value = localConfig.getItem(key);
  var num;
  if (typeof value === 'number') {
    num = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    num = Number(value);
  } else {
    num = fallback;
  }
  if (isNaN(num)) num = fallback;
  return Math.min(max, Math.max(min, num));
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

function normalizeModel(model) {
  return MODELS.indexOf(model) >= 0 ? model : DEFAULT_MODEL;
}
