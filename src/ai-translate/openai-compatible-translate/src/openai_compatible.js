// Client for any OpenAI-compatible chat completions API.
// Works with DeepSeek, OpenRouter, Groq, Together, Mistral, Google Gemini OpenAI layer, etc.

var DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
var DEFAULT_MODEL = 'deepseek-chat';

function normalizeBaseUrl(url) {
  var value = String(url === undefined || url === null ? '' : url)
    .replace(/\s+/g, '')
    .replace(/\/+$/, '');
  if (!value) return DEFAULT_BASE_URL;

  // Pasting the full chat path is common; remove it.
  value = value.replace(/\/chat\/completions$/i, '').replace(/\/+$/, '');
  if (!value) return DEFAULT_BASE_URL;

  // Google's compatibility layer is at .../v1beta/openai (no /v1 after it)
  if (/\/openai$/i.test(value)) return value;

  var versioned = value.match(/^(.*)\/v1$/i);
  if (versioned) return versioned[1] + '/v1';
  return value + '/v1';
}

function chatEndpoint(baseUrl) {
  return normalizeBaseUrl(baseUrl) + '/chat/completions';
}

function isReasoningModel(model) {
  return /(reasoner|reasoning|thinking|(^|[-_/])o[134](-|$))/i.test(String(model || ''));
}

function isDeepSeek(baseUrl) {
  return /(^|\.)deepseek\.com(:|\/|$)/i.test(normalizeBaseUrl(baseUrl));
}

function openAICompatibleRequest(systemPrompt, userJson, settings) {
  var model = String(settings.model || DEFAULT_MODEL).trim();
  var baseUrl = settings.baseUrl;
  var reasoning = isReasoningModel(model);

  var body = {
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userJson },
    ],
    response_format: { type: 'json_object' },
    max_tokens: settings.maxOutputTokens,
  };

  if (isDeepSeek(baseUrl) && !reasoning) {
    body.thinking = { type: 'disabled' };
  }

  if (!reasoning && settings.temperature !== undefined) {
    body.temperature = settings.temperature;
  }

  return body;
}

function callOpenAICompatible(request, settings, budget) {
  var url = chatEndpoint(settings.baseUrl);
  var body = JSON.stringify(request);
  var best = null;

  for (var k = 0; k < settings.apiKeys.length && budget.left > 0; k++) {
    budget.left--;
    var res = fetch(url, {
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
  return best || { error: 'No usable API key', kind: 'auth' };
}

var FAILURE_RANK = { auth: 1, quota: 2, rateLimited: 3 };

function readAnswer(res) {
  var data;
  try {
    data = res.json();
  } catch (e) {
    return { error: 'API sent a reply that is not JSON', kind: 'invalidResponse' };
  }
  var choice = data && data.choices && data.choices[0];
  var message = choice && choice.message;
  var text = message && typeof message.content === 'string' ? message.content : '';
  var finish = choice && choice.finish_reason;

  if (finish === 'length') {
    return {
      error: 'Model stopped at the output token limit; raise "Max output tokens"',
      kind: 'invalidResponse',
    };
  }
  if (!text) {
    return {
      error: 'Model returned an empty answer (' + (finish || 'no text') + ')',
      kind: 'invalidResponse',
    };
  }
  return { text: text };
}

function readFailure(res) {
  var info = {};
  try {
    info = (res.json() || {}).error || {};
  } catch (e) {}

  var message = 'HTTP ' + res.status + (info.message ? ': ' + String(info.message).slice(0, 300) : '');
  var badKey = res.status === 401 || res.status === 403;

  if (res.status === 402) {
    return { error: message, kind: 'quota', nextKey: true };
  }
  if (res.status === 429) {
    var isQuota = info.code === 'insufficient_quota' || /balance|quota|credit/i.test(info.message || '');
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
