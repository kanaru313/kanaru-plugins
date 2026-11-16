// One chat completions call to the DashScope (Qwen) API, trying each API key in turn.
// A key that is refused (bad key, no access) or out of quota passes the turn
// to the next one; any other failure ends the call.

var DASHSCOPE_INTL_ENDPOINT = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';
var DASHSCOPE_CN_ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

var FAILURE_RANK = { auth: 1, quota: 2, rateLimited: 3 };

function getEndpoint(settings) {
  if (settings.customEndpoint) {
    var base = settings.customEndpoint.replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(base)) return base;
    return base + '/chat/completions';
  }
  if (settings.endpointRegion === 'cn') {
    return DASHSCOPE_CN_ENDPOINT;
  }
  return DASHSCOPE_INTL_ENDPOINT;
}

/** The request body; [userJson] is the JSON text of the user message. */
function qwenRequest(systemPrompt, userJson, settings) {
  var model = settings.model || 'qwen-plus';

  var body = {
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userJson },
    ],
    max_tokens: settings.maxOutputTokens,
    response_format: { type: 'json_object' },
  };

  if (settings.temperature !== undefined) {
    body.temperature = settings.temperature;
  }

  return body;
}

/**
 * Sends [request] with each key until one works. Returns `{text}` or `{error, kind, retryAfterSec}`.
 * [budget] `{left}` counts the sends still allowed in this run (the host allows 10, retries included).
 */
function callQwen(request, settings, budget) {
  var endpoint = getEndpoint(settings);
  var body = JSON.stringify(request);
  var best = null;

  for (var k = 0; k < settings.apiKeys.length && budget.left > 0; k++) {
    budget.left--;
    var res = fetch(endpoint, {
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
  return best || { error: 'No usable Qwen / DashScope API key', kind: 'auth' };
}

function readAnswer(res) {
  var data;
  try {
    data = res.json();
  } catch (e) {
    return { error: 'Qwen sent a reply that is not JSON', kind: 'invalidResponse' };
  }
  var choice = data && data.choices && data.choices[0];
  var message = choice && choice.message;
  var text = message && typeof message.content === 'string' ? message.content : '';
  var finish = choice && choice.finish_reason;

  if (finish === 'length') {
    return {
      error: 'Qwen stopped at the output token limit; raise "Max output tokens"',
      kind: 'invalidResponse',
    };
  }
  if (!text) {
    return {
      error: 'Qwen returned an empty answer (' + (finish || 'no text') + ')',
      kind: 'invalidResponse',
    };
  }
  return { text: text };
}

/** Maps an HTTP error to a result; `nextKey` says the next key may work. */
function readFailure(res) {
  var s = res.status;
  var data = null;
  try {
    data = res.json();
  } catch (_) {}

  var detail = '';
  var isQuota = false;
  if (data) {
    var err = data.error || data;
    detail = ': ' + String(err.message || err.code || '');
    if (err.code === 'insufficient_quota' || /quota|balance|arrear/i.test(err.message || '')) {
      isQuota = true;
    }
  }

  var message = 'Qwen HTTP ' + s + detail;
  if (isQuota) return { error: message, kind: 'quota', nextKey: true };
  if (s === 401 || s === 403) return { error: message, kind: 'auth', nextKey: true };
  if (s === 429) return { error: message, kind: 'rateLimited', retryAfterSec: 2, nextKey: true };
  if (s === 400 || s === 413 || s === 414) return { error: message, kind: 'invalidResponse', nextKey: false };
  return { error: message, kind: 'server', nextKey: false };
}
