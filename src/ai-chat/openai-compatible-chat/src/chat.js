// OpenAI-compatible chat (ai-chat). One streaming run = one model round; the app
// owns the tool loop. Contract: docs/plugin-host-api.md "Chat scripts".
//   openai_core.js  messages, SSE stream, status table, emitter
//   provider.js     presets, parameters per preset, provider blob

load('openai_core.js');
load('provider.js');

var MAX_SENDS = 10;
var ROTATE_STATUSES = [401, 402, 429];
var KEY_RE = /^[\x21-\x7e]{1,500}$/; // header-safe

function readConfig() {
  function get(k) { try { return localConfig.getItem(k); } catch (e) { return null; } }
  return {
    preset: get('preset'),
    apiKeys: get('apiKeys'),
    baseUrl: get('baseUrl'),
    model: get('model'),
    temperature: get('temperature'),
    maxOutputTokens: get('maxOutputTokens'),
    thinking: get('thinking')
  };
}

function cleanKeys(value) {
  var raw = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
  var keys = [];
  for (var i = 0; i < raw.length && keys.length < 20; i++) {
    if (typeof raw[i] !== 'string') continue;
    var k = raw[i].trim();
    if (KEY_RE.test(k) && keys.indexOf(k) < 0) keys.push(k);
  }
  return keys;
}

function pickModel(input, config) {
  var model = typeof input.model === 'string' ? input.model.trim() : '';
  if (model === '' && typeof config.model === 'string') model = config.model.trim();
  if (model === '') aiFail('config');
  if (model.length > 200 || /[\x00-\x1f\x7f]/.test(model)) aiFail('bad_request');
  return model;
}

/** fetch() threw: map the host error name to a code (never keeps the message). */
function fetchFailure(e) {
  var name = e && typeof e.name === 'string' ? e.name : 'Error';
  console.log('chat: fetch failed ' + name);
  if (name === 'InvalidRequestError') aiFail('too_large');   // body over the runtime cap
  if (name === 'BlockedHostError' || name === 'NotConsentedError') aiFail('config'); // address or consent
  aiFail('server');
}

/** Streams one answer. Returns Response.success; throws aiFail on a stream error. */
function answer(res, prov, model) {
  var emitter = makeEmitter();
  var st = readChatStream(res, emitter);
  emitter.end();

  var sawEnd = st.finish !== null || st.sawDone;
  // A stream that ended with neither a finish reason nor [DONE] was cut: the app keeps the streamed text.
  if (!sawEnd && !st.overflow) { console.log('chat: stream ended without a finish'); aiFail('server'); }
  var done = finishCalls(st.calls, sawEnd);
  var calls = done.calls;
  var text = wellFormed(st.text);

  var finish;
  if (st.finish === 'error' || st.finish === 'insufficient_system_resource') aiFail('server');
  if (st.overflow || st.finish === 'length') { finish = 'length'; calls = []; }
  else if (st.finish === 'content_filter' || (st.refusal && calls.length === 0)) { finish = 'blocked'; calls = []; }
  else if (calls.length > 0) finish = 'tool_calls';
  else finish = 'stop';
  if (finish === 'stop' && text === '' && st.rc === '' && st.malformed > 0) aiFail('server');
  if (finish === 'stop' && text === '') aiFail('empty');

  var result = { finish: finish, text: text };
  if (calls.length > 0) result.toolCalls = calls;
  if (st.usage !== null) result.usage = st.usage;
  var blob = makeBlob(prov, model, st, done.extras.slice(0, calls.length));
  if (blob !== undefined) result.provider = blob;
  console.log('chat: finish ' + finish + ' calls ' + calls.length);
  return Response.success(result);
}

function run(input) {
  if (!isObject(input) || input.v !== 1 || !Array.isArray(input.messages)) aiFail('bad_request');
  var config = readConfig();
  var prov = providerFor(config);
  var keys = cleanKeys(config.apiKeys);
  if (keys.length === 0) aiFail('config');
  var model = pickModel(input, config);
  if (isServerToolModel(model)) { console.log('chat: model implies provider-side tools'); aiFail('model_not_found'); }

  var tools = buildTools(input);
  var body = { model: model, messages: buildMessages(input, prov, {}), stream: true, stream_options: { include_usage: true } };
  if (tools.length > 0) {
    body.tools = tools;
    if (input.toolChoice === 'none') body.tool_choice = 'none';
  }
  var options = isObject(input.options) ? input.options : {};
  applyParams(prov, body, model, {
    temperature: typeof config.temperature === 'number' ? config.temperature : undefined,
    maxTokens: typeof options.maxOutputTokens === 'number' ? options.maxOutputTokens
      : (typeof config.maxOutputTokens === 'number' ? config.maxOutputTokens : undefined)
  });
  var json = JSON.stringify(body);
  if (utf8Len(json) > BODY_LIMIT_BYTES) aiFail('too_large');

  // Preset hosts rotate through every key; a custom server gets the first key only.
  var attempts = Math.min(prov.custom ? 1 : keys.length, MAX_SENDS);
  var failures = [];
  for (var i = 0; i < attempts; i++) {
    var res;
    try {
      res = fetch(prov.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream', authorization: 'Bearer ' + keys[i] },
        body: json,
        stream: true
      });
    } catch (e) { fetchFailure(e); }
    var failure = null;
    try {
      if (res.ok) return answer(res, prov, model);
      failure = classifyStatus(res.status, readErrorBody(res), res.header('retry-after'));
      console.log('chat: http ' + res.status + ' -> ' + failure.code);
      if (ROTATE_STATUSES.indexOf(res.status) < 0) aiFail(failure.code, failure.retryAfterSec);
    } finally {
      try { res.close(); } catch (e2) { /* already closed */ }
    }
    failures.push(failure);
  }
  var best = bestFailure(failures);
  aiFail(best.code, best.retryAfterSec);
}

function execute(input) {
  try {
    return run(input);
  } catch (e) {
    if (e && e.aiCode) return aiError(e.aiCode, e.retryAfterSec);
    console.log('chat: unexpected ' + (e && typeof e.name === 'string' ? e.name : 'error'));
    return aiError('server');
  }
}
