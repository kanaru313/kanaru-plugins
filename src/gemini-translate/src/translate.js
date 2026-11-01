// Entry of the Gemini lyrics translator (`translate` plugin type).
//
// execute({lines, to, song?}) → Response.success([{text, detected?}])
// with one item per input line, in order. There is no source language: the
// app never knows it, so Gemini detects it per line and `detected` carries it
// back (the app hides lines already in the target language with it). The host has already cut the
// lyrics into chunks no larger than `translate.maxLines` / `maxChars`.
load('prompts.js');
load('gemini.js');

var MODELS = [
  'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-4-argon',
  'gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite',
  'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro',
];
var DEFAULT_MODEL = 'gemini-3.5-flash-lite';
// Shut-down models keep saved settings working through Google's replacements.
var RETIRED_MODELS = { 'gemini-3.7-flash': 'gemini-3.8-flash', 'gemini-3.5-flash': 'gemini-3.6-flash' };

function execute(input) {
  var lines = input && input.lines;
  if (!Array.isArray(lines)) return Response.error('The app sent no lines to translate');
  var to = String(input.to || '');
  if (!LANGUAGE_NAMES[to]) return Response.error('Gemini plugin does not know the language "' + to + '"');

  var settings = readSettings();
  if (settings.apiKeys.length === 0) {
    return Response.error('Add a Gemini API key in the plugin settings', { kind: 'auth' });
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

  // The host allows 10 sends per run, retries included.
  var budget = { left: 10 };
  var first = translateLines(lines, todo, system, settings, input.song, budget);
  if (first.error) return Response.error(first.error, errorOptions(first));
  applyItems(out, first.items);

  // One more call, only for what Gemini skipped or left in the source language.
  var again = todo.filter(function (i) { return needsRetry(out[i], lines[i], to); });
  if (again.length && settings.retryUntranslated && budget.left > 0) {
    var second = translateLines(lines, again, system, settings, input.song, budget);
    if (!second.error) applyItems(out, second.items, true);
  }

  var missing = todo.filter(function (i) { return !out[i]; }).length;
  if (missing) {
    return Response.error('Gemini returned no translation for ' + missing + ' of ' + todo.length + ' lines',
      { kind: 'invalidResponse' });
  }
  return Response.success(out);
}

/** Calls Gemini for the lines at [indexes]; returns `{items}` or an error. */
function translateLines(lines, indexes, system, settings, song, budget) {
  var message = { lines: indexes.map(function (i) { return { i: i, t: String(lines[i]) }; }) };
  if (settings.useSongContext && song) {
    message.song = { title: song.title || undefined, artist: song.artist || undefined, lyrics: song.lyrics || undefined };
  }
  var answer = callGemini(geminiRequest(system, JSON.stringify(message), settings), settings, budget);
  if (answer.error) return answer;

  var parsed;
  try {
    parsed = JSON.parse(stripCodeFence(answer.text));
  } catch (e) {
    return { error: 'Gemini answer is not the expected JSON', kind: 'invalidResponse' };
  }
  if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.lines)) parsed = parsed.lines;
  if (!Array.isArray(parsed)) return { error: 'Gemini answer is not a list of lines', kind: 'invalidResponse' };

  // Keep only items for lines that were asked, first answer wins.
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

/** Writes [items] into [out]; a retry only fills or replaces retried lines. */
function applyItems(out, items, replace) {
  for (var key in items) {
    var i = Number(key);
    if (!out[i] || replace) out[i] = items[key];
  }
}

/**
 * Whether a line deserves the retry call: no translation at all, or an
 * answer equal to the source although Gemini says the line is in another
 * language. Short lines ("Oh yeah") are often right to stay as they are.
 */
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

/** Whether [line] has a letter in any script, repeat marks like "(x2)" aside. */
function hasWords(line) {
  if (typeof line !== 'string') return false;
  return /\p{L}/u.test(line.replace(/[(\[]?\s*[x×]\s*\d+\s*[)\]]?/gi, ''));
}

function stripCodeFence(text) {
  var value = String(text).trim();
  var m = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(value);
  return m ? m[1] : value;
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
    thinking: readText('thinking', 'low'),
    temperature: readNumber('temperature', 0.2, 0, 2),
    maxOutputTokens: Math.round(readNumber('maxOutputTokens', 16384, 256, 65536)),
    safetyFilter: readBoolean('safetyFilter', false),
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
  return readText(key, fallback ? 'true' : 'false') === 'true';
}

function readNumber(key, fallback, min, max) {
  var value = parseFloat(readText(key, String(fallback)));
  if (isNaN(value)) value = fallback;
  return Math.min(max, Math.max(min, value));
}

/** Keys separated by commas, spaces or new lines, duplicates dropped. */
function readApiKeys() {
  var keys = [];
  readText('apiKeys', '').split(/[\s,;]+/).forEach(function (key) {
    if (key && keys.indexOf(key) === -1) keys.push(key);
  });
  return keys;
}

function normalizeModel(model) {
  if (RETIRED_MODELS[model]) return RETIRED_MODELS[model];
  return MODELS.indexOf(model) >= 0 ? model : DEFAULT_MODEL;
}
