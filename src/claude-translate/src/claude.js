// One messages call to the Anthropic Claude API, trying each API key in turn.
// A key that is refused (bad key, no access) or out of quota passes the turn
// to the next one; any other failure ends the call. Kinds follow the host:
// auth, quota, rateLimited, invalidResponse, server.

var CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';
var ANTHROPIC_VERSION = '2023-06-01';

var LLM_MODEL_INFO = {
  'claude-opus-5': { temperature: false },
  'claude-fable-5-1': { temperature: false },
  'claude-fable-5': { temperature: false },
  'claude-opus-4-8': { temperature: false },
  'claude-opus-4-7': { temperature: false },
  'claude-opus-4-6': { temperature: true },
  'claude-sonnet-5': { temperature: false },
  'claude-sonnet-4-6': { temperature: true },
  'claude-haiku-4-5': { temperature: true },
  'claude-3-7-sonnet-latest': { temperature: true },
  'claude-3-5-sonnet-latest': { temperature: true },
  'claude-3-5-haiku-latest': { temperature: true },
};

/** The request body; [userJson] is the JSON text of the user message. */
function claudeRequest(systemPrompt, userJson, settings) {
  var model = settings.model;
  var info = LLM_MODEL_INFO[model] || { temperature: true };

  var body = {
    model: model,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userJson },
    ],
    max_tokens: settings.maxOutputTokens,
  };

  if (info.temperature && settings.temperature !== undefined) {
    body.temperature = settings.temperature;
  }

  return body;
}

/**
 * Sends [request] with each key until one works. Returns `{text}` or `{error, kind, retryAfterSec}`.
 * [budget] `{left}` counts the sends still allowed in this run (the host allows 10, retries included).
 */
function callClaude(request, settings, budget) {
  var body = JSON.stringify(request);
  var best = null;

  for (var k = 0; k < settings.apiKeys.length && budget.left > 0; k++) {
    budget.left--;
    var res = fetch(CLAUDE_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.apiKeys[k],
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: body,
      timeout: 80000,
    });
    if (res.ok) return readAnswer(res);

    var failure = readFailure(res);
    if (!failure.nextKey) return failure;
    if (!best || FAILURE_RANK[failure.kind] > FAILURE_RANK[best.kind]) best = failure;
  }
  return best || { error: 'No usable Anthropic API key', kind: 'auth' };
}

var FAILURE_RANK = { auth: 1, quota: 2, rateLimited: 3 };

function readAnswer(res) {
  var data;
  try {
    data = res.json();
  } catch (e) {
    return { error: 'Claude sent a reply that is not JSON', kind: 'invalidResponse' };
  }

  var text = '';
  var contents = data && Array.isArray(data.content) ? data.content : [];
  for (var i = 0; i < contents.length; i++) {
    if (contents[i] && contents[i].type === 'text') {
      text += contents[i].text;
    }
  }

  if (data && data.stop_reason === 'max_tokens') {
    return {
      error: 'Claude stopped at the output token limit; raise "Max output tokens"',
      kind: 'invalidResponse',
    };
  }
  if (!text) {
    return {
      error: 'Claude returned an empty answer (' + ((data && data.stop_reason) || 'no text') + ')',
      kind: 'invalidResponse',
    };
  }
  return { text: text };
}

/** Maps an HTTP error to a result; `nextKey` says the next key may work. */
function readFailure(res) {
  var info = {};
  try {
    info = (res.json() || {}).error || {};
  } catch (e) {}

  var message = 'Claude HTTP ' + res.status + (info.message ? ': ' + String(info.message).slice(0, 300) : '');
  var badKey = res.status === 401 || res.status === 403;

  if (res.status === 429) {
    return { error: message, kind: 'rateLimited', retryAfterSec: retryAfter(res), nextKey: true };
  }
  if (res.status === 529) {
    return { error: message, kind: 'server', nextKey: true };
  }
  if (badKey) return { error: message, kind: 'auth', nextKey: true };
  return { error: message, kind: res.status === 400 ? 'invalidResponse' : 'server' };
}

function retryAfter(res) {
  var raw = res.header('retry-after');
  var header = raw === null || raw === '' ? NaN : Number(raw);
  if (header >= 0) return Math.floor(header);
  return undefined;
}
