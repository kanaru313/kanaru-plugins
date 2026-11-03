// One chat completions call to the OpenAI API, trying each API key in turn.
// A key that is refused (bad key, no access) or out of quota passes the turn
// to the next one; any other failure ends the call. Kinds follow the host:
// auth, quota, rateLimited, invalidResponse, server.

var OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

var LLM_MODEL_INFO = {
  'gpt-6-luna': { minEffort: 'none' },
  'gpt-6.1-sol': { minEffort: 'low' },
  'gpt-6-astra': { minEffort: 'low' },
  'gpt-5.5': { minEffort: 'none' },
  'gpt-5.4': { minEffort: 'none' },
  'gpt-5.4-mini': { minEffort: 'none' },
  'gpt-5': { minEffort: 'minimal' },
  'gpt-5-mini': { minEffort: 'minimal' },
  'gpt-4.1': { minEffort: null },
  'gpt-4.1-mini': { minEffort: null },
  'gpt-4o': { minEffort: null },
  'gpt-4o-mini': { minEffort: null },
};

/** The request body; [userJson] is the JSON text of the user message. */
function openAIRequest(systemPrompt, userJson, settings) {
  var model = settings.model;
  var info = LLM_MODEL_INFO[model] || { minEffort: null };
  var role = info.minEffort !== null ? 'developer' : 'system';

  var body = {
    model: model,
    messages: [
      { role: role, content: systemPrompt },
      { role: 'user', content: userJson },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: settings.maxOutputTokens,
  };

  if (info.minEffort !== null) {
    var effort = settings.reasoningEffort;
    if (effort === 'auto') {
      effort = info.minEffort === 'minimal' ? 'low' : info.minEffort;
    }
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
function callOpenAI(request, settings, budget) {
  var body = JSON.stringify(request);
  var best = null;

  for (var k = 0; k < settings.apiKeys.length && budget.left > 0; k++) {
    budget.left--;
    var res = fetch(OPENAI_ENDPOINT, {
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
  return best || { error: 'No usable OpenAI API key', kind: 'auth' };
}

var FAILURE_RANK = { auth: 1, quota: 2, rateLimited: 3 };

function readAnswer(res) {
  var data;
  try {
    data = res.json();
  } catch (e) {
    return { error: 'OpenAI sent a reply that is not JSON', kind: 'invalidResponse' };
  }
  var choice = data && data.choices && data.choices[0];
  var message = choice && choice.message;
  var text = message && typeof message.content === 'string' ? message.content : '';
  var finish = choice && choice.finish_reason;

  if (finish === 'length') {
    return {
      error: 'ChatGPT stopped at the output token limit; raise "Max output tokens"',
      kind: 'invalidResponse',
    };
  }
  if (!text) {
    return {
      error: 'ChatGPT returned an empty answer (' + (finish || 'no text') + ')',
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

  var message = 'ChatGPT HTTP ' + res.status + (info.message ? ': ' + String(info.message).slice(0, 300) : '');
  var badKey = res.status === 401 || res.status === 403;

  if (res.status === 429) {
    var isQuota = info.code === 'insufficient_quota' || /quota/i.test(info.message || '');
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
