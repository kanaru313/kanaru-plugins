// Gemini chat: one streamGenerateContent call per round, key rotation, codes
// only in errors. The key goes in `x-goog-api-key`, never in the URL.
load('gemini.js');

var MAX_KEYS = 20;
var MAX_SENDS = 10; // the host allows 10 HTTP sends per run
// Host refusals that mean "the address or the consent is not set up".
var CONFIG_FAILURES = { BlockedHostError: 1, NotConsentedError: 1 };

function readKeys() {
  var raw = localConfig.getItem('apiKeys');
  var list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  var keys = [];
  for (var i = 0; i < list.length && keys.length < MAX_KEYS; i++) {
    var k = typeof list[i] === 'string' ? list[i].replace(/^\s+|\s+$/g, '') : '';
    // a key with spaces or control characters cannot be a header value
    if (/^[\x21-\x7e]+$/.test(k) && keys.indexOf(k) < 0) keys.push(k);
  }
  return keys;
}

function readSettings() {
  var t = localConfig.getItem('temperature');
  var m = localConfig.getItem('maxOutputTokens');
  var th = localConfig.getItem('thinking');
  return {
    temperature: typeof t === 'number' ? t : null,
    maxOutputTokens: typeof m === 'number' ? m : null,
    thinking: typeof th === 'string' ? th : 'auto',
  };
}

function run(input) {
  if (!input || typeof input !== 'object' || input.v !== 1) throw new Fail('bad_request');
  var keys = readKeys();
  if (keys.length === 0) throw new Fail('config');
  var model = pickModel(input, localConfig.getItem('model'));
  var bodyText = JSON.stringify(buildBody(input, model, readSettings()));
  if (utf8Bytes(bodyText) > BODY_CAP_BYTES) throw new Fail('too_large'); // no rotation: another key cannot help

  var url = streamUrl(model);
  var emitter = new Emitter();
  var best = null;
  for (var k = 0; k < keys.length && k < MAX_SENDS; k++) {
    var res = fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': keys[k] },
      body: bodyText,
      stream: true,
    });
    var failed = null;
    try {
      if (!res.ok) failed = readHttpFailure(res);
      else {
        emitter.setStatus('thinking'); // a sign of life while the model works
        var state = readStream(res, emitter);
        if (state.failed) failed = state.failed;
        else return finish(state);
      }
    } finally {
      res.close();
    }
    console.log('gemini-chat: ' + failed.code);
    if (!failed.rotate) throw new Fail(failed.code);
    best = worse(best, failed);
  }
  throw new Fail(best.code, best.retryAfterSec);
}

function execute(input) {
  try {
    return run(input);
  } catch (e) {
    if (e instanceof Fail) return failure(e.code, e.retryAfterSec);
    var name = e && e.name;
    // Keys, URL and headers are checked before the send, so the body size is
    // the one reason left for the host to refuse the request.
    if (name === 'InvalidRequestError') return failure('too_large');
    if (CONFIG_FAILURES[name]) return failure('config');
    // Network and stream errors, limits and anything unexpected: never rethrown raw.
    console.log('gemini-chat: unexpected ' + (typeof name === 'string' ? name : 'error'));
    return failure('server');
  }
}
