// One chat completions call to the xAI Grok API, trying each API key in turn.
// A key that is refused (bad key, no access) or out of quota passes the turn
// to the next one; any other failure ends the call. Kinds follow the host:
// auth, quota, rateLimited, invalidResponse, server.

var GROK_ENDPOINT = 'https://api.x.ai/v1/chat/completions';

var LLM_MODEL_INFO = {
  'grok-4.20-0309-non-reasoning': { effort: false },
  'grok-4.20-0309-reasoning': { effort: false },
  'grok-4.3': { effort: false },
  'grok-4.5': { effort: true },
  'grok-4.6': { effort: true },
  'grok-4.7': { effort: true },
  'grok-2-latest': { effort: false },
  'grok-beta': { effort: false },
};

/** The request body; [userJson] is the JSON text of the user message. */
function grokRequest(systemPrompt, userJson, settings) {
  var model = settings.model;
  var info = LLM_MODEL_INFO[model] || { effort: false };

  var body = {
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userJson },
    ],
    response_format: { type: 'json_object' },
    max_tokens: settings.maxOutputTokens,
  };

  if (info.effort) {
    var effort = settings.reasoningEffort;
    if (effort && effort !== 'auto') {
      body.reasoning_effort = effort;
    }
  } else if (settings.temperature !== undefined) {
    body.temperature = settings.temperature;
  }

  return body;
}

/**
 * Sends [request] with each key until one works. Returns `{text}` or `{error, kind, retryAfterSec}`.
 * [budget] `{left}` counts the sends still allowed in this run (the host allows 10, retries included).
 */
function callGrok(request, settings, budget) {
  var body = JSON.stringify(request);
  var best = null;

  for (var k = 0; k < settings.apiKeys.length && budget.left > 0; k++) {
    budget.left--;
    var res = fetch(GROK_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + settings.apiKeys[k],
      },
      body: body,
      timeout: 80000,
    });
    if (res.ok) return readAnswer(res);

    var failure = readFailure(res);
    if (!failure.nextKey) return failure;
    if (!best || FAILURE_RANK[failure.kind] > FAILURE_RANK[best.kind]) best = failure;
  }
  return best || { error: 'No usable xAI Grok API key', kind: 'auth' };
}

var FAILURE_RANK = { auth: 1, quota: 2, rateLimited: 3 };

function readAnswer(res) {
  var data;
  try {
    data = res.json();
  } catch (e) {
    return { error: 'Grok sent a reply that is not JSON', kind: 'invalidResponse' };
  }
  var choice = data && data.choices && data.choices[0];
  var message = choice && choice.message;
  var text = message && typeof message.content === 'string' ? message.content : '';
  var finish = choice && choice.finish_reason;

  if (finish === 'length') {
    return {
      error: 'Grok stopped at the output token limit; raise "Max output tokens"',
      kind: 'invalidResponse',
    };
  }
  if (!text) {
    return {
      error: 'Grok returned an empty answer (' + (finish || 'no text') + ')',
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

  var message = 'Grok HTTP ' + res.status + (info.message ? ': ' + String(info.message).slice(0, 300) : '');
  var badKey = res.status === 401 || res.status === 403;

  if (res.status === 429) {
    var isQuota = info.code === 'insufficient_quota' || /quota|credits/i.test(info.message || '');
    if (isQuota) return { error: message, kind: 'quota', nextKey: true };
    return { error: message, kind: 'rateLimited', retryAfterSec: retryAfter(res), nextKey: true };
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
