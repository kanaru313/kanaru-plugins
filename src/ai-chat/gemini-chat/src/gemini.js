// Gemini chat helpers: request building, error mapping, stream reading.
// Pure functions plus the emitter; `chat.js` owns the key loop.

var API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
// The runtime refuses bodies over 1 MiB; keep 1 KiB of headroom.
var BODY_CAP_BYTES = 1024 * 1024 - 1024;
var MAX_CALLS = 8;
var BLOB_CAP_BYTES = 256 * 1024;
var SKIP_SIGNATURE = 'skip_thought_signature_validator';
var PROVIDER_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
var MODEL_ID = /^[A-Za-z0-9._:\/@-]{1,120}$/;
var BOUNDARY = /^[A-Za-z0-9]{6,64}$/;
// Models whose name implies provider-side tools are refused.
var PROVIDER_TOOL_MODEL = /search|grounding|deep-research|computer-use|code-exec|url-context/i;

var BLOCKED_FINISH = { SAFETY: 1, PROHIBITED_CONTENT: 1, BLOCKLIST: 1, SPII: 1, RECITATION: 1 };
var BAD_FINISH = { MALFORMED_FUNCTION_CALL: 1, TOO_MANY_TOOL_CALLS: 1, MALFORMED_RESPONSE: 1, MISSING_THOUGHT_SIGNATURE: 1 };

var KINDS = {
  key: 'auth', quota: 'quota', rate_limit: 'rateLimited', config: 'invalidResponse', bad_request: 'invalidResponse',
  model_not_found: 'invalidResponse', context_length: 'invalidResponse', too_large: 'invalidResponse',
  blocked: 'invalidResponse', empty: 'invalidResponse', server: 'server',
};

/** A failure that ends the run with `ai:<code>`. */
function Fail(code, retryAfterSec) {
  this.code = code;
  this.retryAfterSec = retryAfterSec;
}

/** `Response.error` with the code only: never provider text. */
function failure(code, retryAfterSec) {
  var options = { kind: KINDS[code] || 'server' };
  if (code === 'rate_limit' && typeof retryAfterSec === 'number') options.retryAfterSec = retryAfterSec;
  return Response.error('ai:' + code, options);
}

// ------------------------------------------------------------------ text utils

/** Replaces lone surrogates (the host refuses them). */
function wellFormed(s) {
  if (!/[\ud800-\udfff]/.test(s)) return s;
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      var d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        out += s.charAt(i) + s.charAt(i + 1);
        i++;
      } else out += '�';
    } else if (c >= 0xdc00 && c <= 0xdfff) out += '�';
    else out += s.charAt(i);
  }
  return out;
}

/** UTF-8 byte length (no TextEncoder in the host). */
function utf8Bytes(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

// -------------------------------------------------------------------- request

function isGemma(model) {
  return /^gemma-/.test(model);
}

/**
 * Same family rules as gemini-translate. `auto` leaves the model's default.
 * Gemini 2.5 takes a token budget (Pro cannot go to 0; High keeps the default),
 * Gemini 3+ a thinkingLevel (Gemini 4 refuses `minimal`), Gemma 4 only
 * turns thinking on (`high`) or off.
 */
function thinkingConfig(model, level) {
  if (level !== 'low' && level !== 'high') return null;
  if (/^gemini-2\./.test(model)) {
    if (level === 'high') return null;
    return /^gemini-2\.5-pro/.test(model) ? { thinkingBudget: 128 } : { thinkingBudget: 0 };
  }
  if (isGemma(model)) return { thinkingLevel: level === 'high' ? 'high' : 'minimal' };
  return { thinkingLevel: level };
}

function wantsPlaceholder(model) {
  return !/^gemini-2\./.test(model) && !isGemma(model);
}

/**
 * The stored real signatures of one assistant message, by kind and order (not by
 * part position, which the app decides): `{text: sig|null, calls: {ordinal: sig}}`.
 * Blob: `{v: 2, text?: sig, calls: [[callOrdinal, sig], ...]}`; other shapes are ignored.
 */
function readBlob(blob) {
  var out = { text: null, calls: {} };
  if (!blob || typeof blob !== 'object' || blob.v !== 2) return out;
  if (typeof blob.text === 'string' && blob.text) out.text = blob.text;
  if (!Array.isArray(blob.calls)) return out;
  for (var i = 0; i < blob.calls.length; i++) {
    var e = blob.calls[i];
    if (Array.isArray(e) && e.length === 2 && typeof e[0] === 'number' && e[0] >= 0 && e[0] % 1 === 0 &&
        typeof e[1] === 'string' && e[1]) out.calls[e[0]] = e[1];
  }
  return out;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function fenced(part, boundary) {
  if (!BOUNDARY.test(String(boundary))) throw new Fail('bad_request');
  if (typeof part.source !== 'string' || !/^[a-z_]{1,32}$/.test(part.source)) throw new Fail('bad_request');
  var source = part.source;
  var text = String(part.text === undefined || part.text === null ? '' : part.text);
  // A closing tag with this boundary inside the data cannot end the fence.
  text = text.split('</data-' + boundary).join('< /data-' + boundary);
  return '<data-' + boundary + ' source="' + source + '">' + text + '</data-' + boundary + '>';
}

function userParts(parts, boundary) {
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (!isPlainObject(p)) throw new Fail('bad_request');
    if (p.type === 'text') {
      if (typeof p.text === 'string' && p.text) out.push({ text: p.text });
    } else if (p.type === 'data') out.push({ text: fenced(p, boundary) });
    else if (p.type !== 'image') throw new Fail('bad_request'); // image parts are dropped
  }
  return out;
}

/**
 * Text parts are merged into one (at the place of the first); the stored text
 * signature goes on it and the n-th stored call signature on the n-th call,
 * whatever order the app keeps the parts in.
 */
function modelParts(msg, model) {
  var sigs = readBlob(msg.provider);
  var placeholder = wantsPlaceholder(model);
  var out = [];
  var textAt = -1;
  var text = '';
  var ordinal = 0;
  for (var i = 0; i < msg.parts.length; i++) {
    var p = msg.parts[i];
    if (!isPlainObject(p)) throw new Fail('bad_request');
    if (p.type === 'text') {
      if (typeof p.text === 'string' && p.text) {
        if (textAt < 0) {
          textAt = out.length;
          out.push(null);
        }
        text += p.text;
      }
    } else if (p.type === 'tool_call') {
      var call = { name: String(p.name), args: isPlainObject(p.args) ? p.args : {} };
      if (typeof p.providerId === 'string' && PROVIDER_ID.test(p.providerId)) call.id = p.providerId;
      var cp = { functionCall: call };
      if (sigs.calls[ordinal]) cp.thoughtSignature = sigs.calls[ordinal];
      else if (ordinal === 0 && placeholder) cp.thoughtSignature = SKIP_SIGNATURE;
      ordinal++;
      out.push(cp);
    } else if (p.type !== 'data' && p.type !== 'image') throw new Fail('bad_request');
  }
  if (textAt >= 0) {
    out[textAt] = { text: text };
    if (sigs.text) out[textAt].thoughtSignature = sigs.text;
  }
  return out;
}

function resultParts(parts) {
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (!isPlainObject(p) || p.type !== 'tool_result') throw new Fail('bad_request');
    var texts = [];
    var content = Array.isArray(p.content) ? p.content : [];
    for (var j = 0; j < content.length; j++) {
      if (content[j] && content[j].type === 'text' && typeof content[j].text === 'string') texts.push(content[j].text);
    }
    var text = texts.join('\n');
    var fr = { name: String(p.name), response: p.isError === true ? { error: text } : { result: text } };
    if (typeof p.providerId === 'string' && PROVIDER_ID.test(p.providerId)) fr.id = p.providerId;
    out.push({ functionResponse: fr });
  }
  return out;
}

function buildContents(input, model) {
  if (!Array.isArray(input.messages)) throw new Fail('bad_request');
  var contents = [];
  function push(role, parts) {
    if (parts.length === 0) return;
    var last = contents[contents.length - 1];
    if (last && last.role === role) last.parts = last.parts.concat(parts);
    else contents.push({ role: role, parts: parts });
  }
  for (var i = 0; i < input.messages.length; i++) {
    var msg = input.messages[i];
    if (!isPlainObject(msg) || !Array.isArray(msg.parts)) throw new Fail('bad_request');
    if (msg.role === 'user') push('user', userParts(msg.parts, input.boundary));
    else if (msg.role === 'assistant') push('model', modelParts(msg, model));
    else if (msg.role === 'tool') push('user', resultParts(msg.parts));
    else throw new Fail('bad_request');
  }
  if (contents.length === 0) throw new Fail('bad_request');
  return contents;
}

function positiveInt(v) {
  return typeof v === 'number' && isFinite(v) && v >= 1 && v % 1 === 0 ? v : null;
}

/** The model id from the input or the settings, checked for the URL and the tool ban. */
function pickModel(input, configModel) {
  var raw = typeof input.model === 'string' && input.model ? input.model : configModel;
  if (typeof raw !== 'string' || !raw) throw new Fail('config');
  var model = raw.replace(/^models\//, '');
  if (!MODEL_ID.test(model)) throw new Fail('bad_request');
  if (PROVIDER_TOOL_MODEL.test(model)) throw new Fail('model_not_found');
  return model;
}

/**
 * The request body. `config` is `{temperature, maxOutputTokens, thinking}`
 * read from the settings (null when unset).
 */
function buildBody(input, model, config) {
  var body = { contents: buildContents(input, model) };
  if (typeof input.system === 'string' && input.system) body.systemInstruction = { parts: [{ text: input.system }] };

  var tools = Array.isArray(input.tools) ? input.tools : [];
  if (tools.length > 0) {
    var decls = [];
    for (var i = 0; i < tools.length; i++) {
      var t = tools[i];
      if (!isPlainObject(t) || typeof t.name !== 'string' || !t.name) throw new Fail('bad_request');
      var d = { name: t.name };
      if (typeof t.description === 'string' && t.description) d.description = t.description;
      // Sent as is: the contract's schema subset is plain JSON Schema.
      d.parametersJsonSchema = isPlainObject(t.parameters) ? t.parameters : { type: 'object', properties: {} };
      decls.push(d);
    }
    body.tools = [{ functionDeclarations: decls }];
    if (input.toolChoice === 'none') body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
  }

  var gen = {};
  var options = isPlainObject(input.options) ? input.options : {};
  var maxOut = positiveInt(options.maxOutputTokens) || positiveInt(config.maxOutputTokens);
  if (maxOut) gen.maxOutputTokens = maxOut;
  if (typeof config.temperature === 'number' && isFinite(config.temperature) &&
      config.temperature >= 0 && config.temperature <= 2) gen.temperature = config.temperature;
  var thinking = thinkingConfig(model, config.thinking);
  if (thinking) gen.thinkingConfig = thinking;
  for (var k in gen) {
    body.generationConfig = gen;
    break;
  }
  return body;
}

function streamUrl(model) {
  return API_BASE + encodeURIComponent(model) + ':streamGenerateContent?alt=sse';
}

// ------------------------------------------------------------- error mapping

var CONTEXT_TEXT = /token count|exceeds the maximum number of tokens|context (length|window)/i;
var RANK = { key: 1, quota: 2, rate_limit: 3 };

function retryDelaySec(headerValue, info) {
  var header = headerValue === null || headerValue === undefined || headerValue === '' ? NaN : Number(headerValue);
  if (header >= 0) return Math.floor(header);
  var details = Array.isArray(info.details) ? info.details : [];
  for (var i = 0; i < details.length; i++) {
    var m = /^(\d+(?:\.\d+)?)s$/.exec(String(details[i] && details[i].retryDelay || ''));
    if (m) return Math.ceil(Number(m[1]));
  }
  return undefined;
}

/**
 * Maps an HTTP status (or an in-stream error code) and Google's error object to
 * `{code, retryAfterSec, rotate}`. Only key / quota / rate_limit rotate.
 */
function classify(status, info, retryHeader) {
  var hay = String(info.message || '') + ' ' + String(info.status || '') + ' ' + JSON.stringify(info.details || []);
  if (hay.length > 4000) hay = hay.slice(0, 4000);
  var code;
  if (status === 429) {
    code = /PerDay|per day/i.test(hay) ? 'quota' : 'rate_limit';
  } else if (status === 400) {
    if (/API_KEY_INVALID|API key not valid|API key expired/i.test(hay)) code = 'key';
    else if (CONTEXT_TEXT.test(hay)) code = 'context_length';
    else code = 'bad_request';
  } else if (status === 401 || status === 403) code = 'key';
  else if (status === 404) code = 'model_not_found';
  else if (status === 413) code = 'too_large';
  else if (status >= 500) code = 'server';
  else if (status >= 400) code = 'bad_request';
  else code = 'server';
  var out = { code: code, rotate: code === 'key' || code === 'quota' || code === 'rate_limit' };
  if (code === 'rate_limit') out.retryAfterSec = retryDelaySec(retryHeader, info);
  return out;
}

/** The failure of a non-2xx answer. Reads the body; the caller closes the stream. */
function readHttpFailure(res) {
  var info = {};
  try {
    var parsed = JSON.parse(res.text());
    if (parsed && isPlainObject(parsed.error)) info = parsed.error;
  } catch (e) {
    // an unreadable body still has a status
  }
  return classify(res.status, info, res.header('retry-after'));
}

/** Of two failures, the one worth showing when every key failed. */
function worse(a, b) {
  if (!a) return b;
  var ra = RANK[a.code] || 0;
  var rb = RANK[b.code] || 0;
  if (rb !== ra) return rb > ra ? b : a;
  // two waits: report the longest, so the user does not retry too early
  if (a.code === 'rate_limit' && (b.retryAfterSec || 0) > (a.retryAfterSec || 0)) return b;
  return a;
}

// ------------------------------------------------------------------- emitting

/** Coalesces text deltas: one emit per 50 ms or 256 characters. */
function Emitter() {
  this.buf = '';
  this.last = 0;
  this.status = '';
}
Emitter.prototype.setStatus = function (s) {
  if (this.status === s || (s === 'thinking' && this.status === 'generating')) return;
  this.status = s;
  emit({ t: 'status', s: s });
};
Emitter.prototype.text = function (delta) {
  this.setStatus('generating');
  this.buf += delta;
  var now = Date.now();
  if (this.buf.length >= 256 || now - this.last >= 50) this.flush();
};
Emitter.prototype.flush = function () {
  var buf = this.buf;
  this.buf = '';
  if (!buf) return;
  this.last = Date.now();
  var CHUNK = 1024; // far under the 64 KiB emit cap even with escaped controls
  for (var i = 0; i < buf.length; ) {
    var end = Math.min(buf.length, i + CHUNK);
    var c = buf.charCodeAt(end - 1);
    if (end < buf.length && c >= 0xd800 && c <= 0xdbff) end--; // keep a pair whole
    emit({ t: 'text', d: buf.slice(i, end) });
    i = end;
  }
};

// -------------------------------------------------------------- stream reading

function consumeEvent(ev, state, emitter) {
  if (ev.promptFeedback && ev.promptFeedback.blockReason) state.blockReason = String(ev.promptFeedback.blockReason);
  var u = ev.usageMetadata;
  if (u && typeof u === 'object') {
    state.usage = u;
    if (u.thoughtsTokenCount > 0) emitter.setStatus('thinking');
  }
  var cand = Array.isArray(ev.candidates) ? ev.candidates[0] : null;
  if (!cand || typeof cand !== 'object') return;
  var parts = cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (!isPlainObject(p)) continue;
    if (p.thought === true) { // thinking never reaches the text, the emits or the blob
      emitter.setStatus('thinking');
      continue;
    }
    var sig = typeof p.thoughtSignature === 'string' && p.thoughtSignature ? p.thoughtSignature : null;
    if (isPlainObject(p.functionCall)) {
      state.calls.push({ call: p.functionCall, sig: sig });
    } else {
      if (typeof p.text === 'string' && p.text) {
        var d = wellFormed(p.text);
        state.text += d;
        emitter.text(d);
      }
      if (sig) state.textSig = sig;
    }
  }
  if (typeof cand.finishReason === 'string' && cand.finishReason) state.finishReason = cand.finishReason;
}

/**
 * Reads the whole SSE body. Returns the state, or `{failed: classification}`
 * for an error event (`rotate` only while nothing was shown to the user).
 */
function readStream(res, emitter) {
  var state = { text: '', calls: [], textSig: null, finishReason: null, blockReason: null, usage: null };
  var line;
  while (true) {
    try {
      line = res.readLine();
    } catch (e) {
      // A cut after the finish reason keeps the finished answer.
      if (state.finishReason) break;
      throw e;
    }
    if (line === null) break;
    if (line.indexOf('data:') !== 0) continue;
    var payload = line.slice(5).replace(/^\s+|\s+$/g, '');
    if (!payload || payload === '[DONE]') continue;
    var ev;
    try {
      ev = JSON.parse(payload);
    } catch (e) {
      throw new Fail('server');
    }
    if (!isPlainObject(ev)) continue;
    if (ev.error) {
      var info = isPlainObject(ev.error) ? ev.error : {};
      var f = classify(typeof info.code === 'number' ? info.code : 500, info, null);
      if (state.text || state.calls.length) f.rotate = false;
      return { failed: f };
    }
    consumeEvent(ev, state, emitter);
  }
  emitter.flush();
  return state;
}

// --------------------------------------------------------------------- result

function count(n) {
  return typeof n === 'number' && isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** The final `Response` for a fully read answer. */
function finish(state) {
  var finishReason = state.finishReason;
  var text = state.text;
  if (state.blockReason || (finishReason && BLOCKED_FINISH[finishReason])) return result('blocked', state);
  // A stream that ended without a finish reason was cut: the app keeps the streamed text.
  if (!finishReason) return failure('server');
  if (finishReason && BAD_FINISH[finishReason]) return failure('bad_request');
  if (finishReason === 'MAX_TOKENS') return result('length', state);
  if (state.calls.length > 0) return result('tool_calls', state);
  if (!text) return failure('empty'); // includes UNEXPECTED_TOOL_CALL without text
  return result('stop', state);
}

function result(kind, state) {
  var out = { finish: kind, text: state.text };
  var calls = [];
  if (kind === 'tool_calls') {
    out.toolCalls = [];
    for (var i = 0; i < state.calls.length && i < MAX_CALLS; i++) {
      var fc = state.calls[i].call;
      var name = String(fc.name === undefined || fc.name === null ? '' : fc.name).slice(0, 64);
      if (!name) return failure('bad_request');
      var tc = { name: name, args: isPlainObject(fc.args) ? fc.args : fc.args === undefined ? {} : JSON.stringify(fc.args) };
      if (typeof fc.id === 'string' && PROVIDER_ID.test(fc.id)) tc.providerId = fc.id;
      out.toolCalls.push(tc);
      if (state.calls[i].sig) calls.push([i, state.calls[i].sig]);
    }
  }
  var u = state.usage;
  if (u) out.usage = { input: count(u.promptTokenCount), output: count(u.candidatesTokenCount) + count(u.thoughtsTokenCount) };
  var textSig = state.text && state.textSig ? state.textSig : null;
  if (textSig || calls.length > 0) {
    var blob = { v: 2, calls: calls };
    if (textSig) blob.text = textSig;
    if (utf8Bytes(JSON.stringify(blob)) <= BLOB_CAP_BYTES) out.provider = blob;
  }
  return Response.success(out);
}
