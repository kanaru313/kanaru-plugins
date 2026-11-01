// One generateContent call to the Gemini API, trying each API key in turn.
// A key that is refused (bad key, no access) or out of quota passes the turn
// to the next one; any other failure ends the call. Kinds follow the host:
// auth, quota, rateLimited, invalidResponse, server.

var GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

// Gemini answers this shape, so the model cannot drift from "one item per line".
var LINES_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      i: { type: 'INTEGER' },
      t: { type: 'STRING' },
      l: { type: 'STRING' },
    },
    required: ['i', 't', 'l'],
  },
};

var HARM_CATEGORIES = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
];

/** The request body; [userJson] is the JSON text of the user message. */
function geminiRequest(systemPrompt, userJson, settings) {
  var generationConfig = {
    temperature: settings.temperature,
    maxOutputTokens: settings.maxOutputTokens,
    responseMimeType: 'application/json',
    responseSchema: LINES_SCHEMA,
  };
  var thinking = thinkingConfig(settings.model, settings.thinking);
  if (thinking) generationConfig.thinkingConfig = thinking;

  var request = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userJson }] }],
    generationConfig: generationConfig,
  };
  // Love songs and breakup songs trip the default filters easily; the user
  // turns them back on in the settings.
  if (!settings.safetyFilter) {
    request.safetySettings = HARM_CATEGORIES.map(function (category) {
      return { category: category, threshold: 'BLOCK_NONE' };
    });
  }
  return request;
}

/**
 * `low` asks for as little thinking as the model allows, so a chunk fits the
 * plugin's time limit; `auto` leaves the model's default. Gemini 2.5 takes a
 * token budget (Pro cannot go to 0), later models a level.
 */
function thinkingConfig(model, level) {
  if (level !== 'low') return null;
  if (/^gemini-2\.5-pro/.test(model)) return { thinkingBudget: 128 };
  if (/^gemini-2\./.test(model)) return { thinkingBudget: 0 };
  return { thinkingLevel: 'low' };
}

/**
 * Sends [request] with each key until one works. Returns `{text}` (the
 * model's answer, thoughts left out) or `{error, kind, retryAfterSec}`.
 * [budget] `{left}` counts the sends still allowed in this run (the host
 * allows 10, retries included); rotation stops when it is used up.
 * Network failures are not caught: the host reports them itself.
 */
function callGemini(request, settings, budget) {
  var url = GEMINI_BASE + encodeURIComponent(settings.model) + ':generateContent';
  var body = JSON.stringify(request);
  var best = null;

  for (var k = 0; k < settings.apiKeys.length && budget.left > 0; k++) {
    budget.left--;
    var res = fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': settings.apiKeys[k] },
      body: body,
      timeout: 80000,
    });
    if (res.ok) return readAnswer(res);

    var failure = readFailure(res);
    if (!failure.nextKey) return failure;
    if (!best || FAILURE_RANK[failure.kind] > FAILURE_RANK[best.kind]) best = failure;
  }
  return best || { error: 'No usable Gemini API key', kind: 'auth' };
}

// Which key failure to report when every key failed: waiting helps most for
// rateLimited, then quota (a day), then auth (the user must act).
var FAILURE_RANK = { auth: 1, quota: 2, rateLimited: 3 };

function readAnswer(res) {
  var data;
  try {
    data = res.json();
  } catch (e) {
    return { error: 'Gemini sent a reply that is not JSON', kind: 'invalidResponse' };
  }
  var candidate = data && data.candidates && data.candidates[0];
  var text = '';
  var parts = (candidate && candidate.content && candidate.content.parts) || [];
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] && parts[i].text && !parts[i].thought) text += parts[i].text;
  }
  var finish = candidate && candidate.finishReason;
  if (finish === 'MAX_TOKENS') {
    return { error: 'Gemini stopped at the output token limit; raise "Max output tokens"', kind: 'invalidResponse' };
  }
  if (!text) {
    var reason = (data && data.promptFeedback && data.promptFeedback.blockReason) || finish || 'empty answer';
    return { error: 'Gemini did not translate: ' + reason, kind: 'invalidResponse' };
  }
  return { text: text };
}

/** Maps an HTTP error to a result; `nextKey` says the next key may work. */
function readFailure(res) {
  var info = {};
  try {
    info = (res.json() || {}).error || {};
  } catch (e) {}
  var message = 'Gemini HTTP ' + res.status + (info.message ? ': ' + String(info.message).slice(0, 300) : '');
  var reasons = JSON.stringify(info.details || []);
  var badKey = res.status === 401 || res.status === 403 ||
    (res.status === 400 && /API_KEY_INVALID|API key not valid/.test(reasons + (info.message || '')));

  if (res.status === 429) {
    // A per-day (or per-project daily) quota will not come back in a minute.
    var daily = /PerDay|per day/i.test(reasons) || /PerDay|per day/i.test(info.message || '');
    if (daily) return { error: message, kind: 'quota', nextKey: true };
    return { error: message, kind: 'rateLimited', retryAfterSec: retryAfter(res, info), nextKey: true };
  }
  if (badKey) return { error: message, kind: 'auth', nextKey: true };
  return { error: message, kind: res.status === 400 ? 'invalidResponse' : 'server' };
}

/** Seconds to wait, from `Retry-After` or Gemini's RetryInfo ("37s"). */
function retryAfter(res, info) {
  var raw = res.header('retry-after');
  var header = raw === null || raw === '' ? NaN : Number(raw);
  if (header >= 0) return Math.floor(header);
  var details = info.details || [];
  for (var i = 0; i < details.length; i++) {
    var m = /^(\d+(?:\.\d+)?)s$/.exec(String(details[i] && details[i].retryDelay || ''));
    if (m) return Math.ceil(Number(m[1]));
  }
  return undefined;
}
