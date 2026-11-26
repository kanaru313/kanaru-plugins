// OpenAI chat-completions core for the ai-chat contract (docs/plugin-host-api.md
// "Chat scripts"): neutral messages -> request body, SSE stream -> result,
// HTTP status -> ai:<code>. Provider quirks live in provider.js; the run loop
// (keys, rotation, fetch) lives in chat.js. ES5/ES6 only, no dependencies.
//
// Privacy rules kept here: errors carry a code only; console lines hold codes,
// statuses and counts, never keys, message text or provider bodies.

var BODY_LIMIT_BYTES = 1048576 - 1024; // runtime refuses bodies over 1 MiB
var BLOB_LIMIT_BYTES = 262144 - 2048;  // provider blob: 256 KiB per message
var MAX_TOOL_CALLS = 8;
var MAX_TEXT_CHARS = 500000;           // keeps the 2 MiB result cap safe
var MAX_REASONING_CHARS = 400000;
var MAX_ARG_CHARS = 200000;
var EMIT_MIN_CHARS = 256;
var EMIT_MIN_MS = 50;
var EMIT_SLICE_CHARS = 1024;
var HEARTBEAT_MS = 10000;
var PROVIDER_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
var DATA_SOURCE_RE = /^[a-z_]{1,32}$/;
var BOUNDARY_RE = /^[A-Za-z0-9]{4,64}$/;

var ERROR_KIND = {
  key: 'auth', quota: 'quota', rate_limit: 'rateLimited', config: 'invalidResponse',
  bad_request: 'invalidResponse', model_not_found: 'invalidResponse', context_length: 'invalidResponse',
  too_large: 'invalidResponse', blocked: 'invalidResponse', empty: 'invalidResponse', server: 'server'
};

// ------------------------------------------------------------------ errors
/** Throws a plugin error that execute() turns into Response.error('ai:<code>'). */
function aiFail(code, retryAfterSec) {
  var e = { aiCode: code };
  if (retryAfterSec !== undefined) e.retryAfterSec = retryAfterSec;
  throw e;
}

function aiError(code, retryAfterSec) {
  var options = { kind: ERROR_KIND[code] || 'server' };
  if (code === 'rate_limit' && typeof retryAfterSec === 'number' && retryAfterSec >= 0) {
    options.retryAfterSec = Math.floor(retryAfterSec);
  }
  return Response.error('ai:' + code, options);
}

// ------------------------------------------------------------------- utils
/** UTF-8 length of a string, counting a surrogate pair as 4 bytes. */
function utf8Len(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length &&
             s.charCodeAt(i + 1) >= 0xDC00 && s.charCodeAt(i + 1) <= 0xDFFF) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** Replaces lone surrogates with U+FFFD (the host refuses them). */
function wellFormed(s) {
  if (!/[\ud800-\udfff]/.test(s)) return s; // nothing to repair: skip the per-character rebuild
  var out = '', changed = false;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      var d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (d >= 0xDC00 && d <= 0xDFFF) { out += s.charAt(i) + s.charAt(i + 1); i++; } else { out += '�'; changed = true; }
    } else if (c >= 0xDC00 && c <= 0xDFFF) { out += '�'; changed = true; }
    else out += s.charAt(i);
  }
  return changed ? out : s;
}

function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

// ---------------------------------------------------------------- messages
function renderDataPart(part, boundary) {
  var source = typeof part.source === 'string' ? part.source : '';
  if (!DATA_SOURCE_RE.test(source)) aiFail('bad_request');
  if (!BOUNDARY_RE.test(boundary)) aiFail('bad_request');
  var close = '</data-' + boundary;
  // The app already breaks "<data"; a closing tag with this very boundary
  // cannot be guessed, but is neutralised anyway.
  var text = String(part.text === undefined || part.text === null ? '' : part.text).split(close).join('<\\/data-' + boundary);
  return '<data-' + boundary + ' source="' + source + '">' + text + '</data-' + boundary + '>';
}

/** Text of a message's parts: text and fenced data parts, in order; images dropped. */
function partsText(parts, boundary) {
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (!isObject(p)) continue;
    if (p.type === 'text' && typeof p.text === 'string') out.push(p.text);
    else if (p.type === 'data') out.push(renderDataPart(p, boundary));
  }
  return out.join('\n\n');
}

function callId(part) {
  if (typeof part.providerId === 'string' && PROVIDER_ID_RE.test(part.providerId)) return part.providerId;
  return String(part.id);
}

function toolResultText(part) {
  var out = [];
  var content = Array.isArray(part.content) ? part.content : [];
  for (var i = 0; i < content.length; i++) {
    if (isObject(content[i]) && content[i].type === 'text' && typeof content[i].text === 'string') out.push(content[i].text);
  }
  var text = out.join('\n');
  return text === '' ? '(empty result)' : text;
}

function toolCallArguments(args) {
  if (typeof args === 'string') return args; // raw text an earlier round could not parse
  try { return JSON.stringify(args === undefined || args === null ? {} : args); } catch (e) { return '{}'; }
}

/**
 * Neutral input -> chat-completions messages. `prov.echo(message, blob, calls)`
 * adds the provider fields kept in an assistant turn's blob.
 */
function buildMessages(input, prov, state) {
  var out = [];
  if (typeof input.system === 'string' && input.system !== '') out.push({ role: 'system', content: input.system });
  var boundary = typeof input.boundary === 'string' ? input.boundary : '';
  var messages = input.messages;
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    if (!isObject(m) || !Array.isArray(m.parts)) aiFail('bad_request');
    if (m.role === 'user') {
      var text = partsText(m.parts, boundary);
      if (text !== '') out.push({ role: 'user', content: text });
    } else if (m.role === 'assistant') {
      var calls = [];
      for (var j = 0; j < m.parts.length; j++) {
        var p = m.parts[j];
        if (isObject(p) && p.type === 'tool_call' && typeof p.name === 'string') calls.push(p);
      }
      var msg = { role: 'assistant', content: null };
      var body = partsText(m.parts, boundary);
      if (body !== '') msg.content = body;
      if (calls.length > 0) {
        msg.tool_calls = [];
        for (var k = 0; k < calls.length; k++) {
          msg.tool_calls.push({ id: callId(calls[k]), type: 'function',
            'function': { name: calls[k].name, arguments: toolCallArguments(calls[k].args) } });
        }
      }
      if (isObject(m.provider)) prov.echo(msg, m.provider, state);
      if (msg.content === null && !msg.tool_calls) continue;
      out.push(msg);
    } else if (m.role === 'tool') {
      for (var t = 0; t < m.parts.length; t++) {
        var r = m.parts[t];
        if (isObject(r) && r.type === 'tool_result') {
          out.push({ role: 'tool', tool_call_id: callId(r), content: (r.isError === true ? 'Error: ' : '') + toolResultText(r) });
        }
      }
    } else {
      aiFail('bad_request');
    }
  }
  return out;
}

function buildTools(input) {
  var tools = [];
  var list = Array.isArray(input.tools) ? input.tools : [];
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    if (!isObject(t) || typeof t.name !== 'string') continue;
    tools.push({ type: 'function', 'function': {
      name: t.name,
      description: typeof t.description === 'string' ? t.description : '',
      parameters: isObject(t.parameters) ? t.parameters : { type: 'object', properties: {} }
    } });
  }
  return tools;
}

// ----------------------------------------------------------------- emitter
/** Coalesces text deltas: one emit per 50 ms or 256 characters, never splits a surrogate pair. */
function makeEmitter() {
  var buf = '', last = 0, lastStatus = 0, thinking = false, generating = false, emitted = false;

  function slice(max) {
    var cut = Math.min(max, buf.length);
    var c = buf.charCodeAt(cut - 1);
    if (c >= 0xD800 && c <= 0xDBFF) cut = cut - 1; // keep a pair whole (its low half comes later)
    if (cut <= 0) return '';
    var s = buf.slice(0, cut);
    buf = buf.slice(cut);
    return s;
  }
  function flush(force) {
    var now = Date.now();
    while (buf.length > 0 && (force || buf.length >= EMIT_MIN_CHARS || now - last >= EMIT_MIN_MS)) {
      var s = slice(EMIT_SLICE_CHARS);
      if (s === '') break;
      emit({ t: 'text', d: s });
      emitted = true;
      last = now;
      if (!force && buf.length < EMIT_MIN_CHARS) break;
    }
  }
  return {
    text: function (delta) {
      if (delta === '') return;
      if (!generating) { generating = true; emit({ t: 'status', s: 'generating' }); lastStatus = Date.now(); }
      buf += delta;
      flush(false);
    },
    /** A status heartbeat while the model reasons or waits (keeps the idle timer fed). */
    thinking: function () {
      if (emitted || generating) return;
      var now = Date.now();
      if (!thinking || now - lastStatus >= HEARTBEAT_MS) {
        thinking = true;
        lastStatus = now;
        emit({ t: 'status', s: 'thinking' });
      }
    },
    end: function () {
      flush(true);
      buf = ''; // a trailing lone high surrogate has no partner any more
    }
  };
}

// --------------------------------------------------------------- tool calls
function emptyCalls() { return { slots: [], byIndex: {} }; }

/** Assembles streamed tool_call deltas by `index` (a repeated index with a new id starts a new call). */
function addToolDeltas(calls, deltas) {
  for (var i = 0; i < deltas.length; i++) {
    var tc = deltas[i];
    if (!isObject(tc)) continue;
    var fn = isObject(tc['function']) ? tc['function'] : {};
    var id = typeof tc.id === 'string' ? tc.id : '';
    var key = typeof tc.index === 'number' ? String(tc.index) : null;
    var slot = key !== null && calls.byIndex.hasOwnProperty(key) ? calls.byIndex[key] : null;
    if (slot === null && key === null) {
      // No index (some compat layers): follow the id, else the latest call.
      for (var s = 0; s < calls.slots.length; s++) if (id !== '' && calls.slots[s].id === id) slot = calls.slots[s];
      if (slot === null && id === '' && calls.slots.length > 0) slot = calls.slots[calls.slots.length - 1];
    }
    if (slot !== null && id !== '' && slot.id !== '' && slot.id !== id) slot = null;
    if (slot === null) {
      slot = { id: '', name: '', args: '', extra: null };
      calls.slots.push(slot);
    }
    if (key !== null) calls.byIndex[key] = slot;
    if (id !== '' && slot.id === '') slot.id = id;
    if (typeof fn.name === 'string' && fn.name !== '' && slot.name === '') slot.name = fn.name;
    if (typeof fn.arguments === 'string' && slot.args.length < MAX_ARG_CHARS) slot.args += fn.arguments;
    if (isObject(tc.extra_content)) slot.extra = tc.extra_content;
  }
}

/**
 * Finished calls. With `complete` (the provider closed the turn) arguments that
 * do not parse are returned raw; without it (stream cut) such a call is dropped.
 * Returns {calls: [{providerId, name, args}], extras: [extra_content|null], dropped}.
 */
function finishCalls(calls, complete) {
  var out = [], extras = [], dropped = 0;
  for (var i = 0; i < calls.slots.length; i++) {
    var s = calls.slots[i];
    if (s.name === '') { dropped++; continue; }
    var args, parsed = true;
    if (s.args.trim() === '') args = {};
    else {
      try { args = JSON.parse(s.args); } catch (e) { parsed = false; }
      if (parsed && !isObject(args)) parsed = false;
      if (!parsed) args = s.args;
    }
    if (!parsed && !complete) { dropped++; continue; }
    if (out.length >= MAX_TOOL_CALLS) { dropped++; continue; }
    var call = { name: s.name.slice(0, 64), args: args };
    if (PROVIDER_ID_RE.test(s.id)) call.providerId = s.id;
    out.push(call);
    extras.push(s.extra);
  }
  return { calls: out, extras: extras, dropped: dropped };
}

// ------------------------------------------------------------------ stream
/**
 * Reads one SSE chat-completions stream. Returns the state; throws aiFail for a
 * provider error inside the stream. The caller closes the response.
 */
function readChatStream(res, emitter) {
  var st = { text: '', rc: '', rd: [], calls: emptyCalls(), finish: null, usage: null,
             sawDone: false, ended: false, malformed: 0, refusal: false, overflow: false };

  // A high surrogate at the end of a delta waits for its low half in the next one.
  var held = '';
  function addText(raw, last) {
    var piece = held + raw;
    held = '';
    if (!last && piece !== '') {
      var c = piece.charCodeAt(piece.length - 1);
      if (c >= 0xD800 && c <= 0xDBFF) { held = piece.charAt(piece.length - 1); piece = piece.slice(0, -1); }
    }
    piece = wellFormed(piece); // emit() throws on a lone surrogate
    if (piece === '') return;
    if (st.text.length + piece.length > MAX_TEXT_CHARS) { st.overflow = true; }
    else { st.text += piece; emitter.text(piece); }
  }

  function handle(chunk) {
    if (chunk.error !== undefined && chunk.error !== null) { console.log('chat: provider error in stream'); aiFail('server'); }
    if (isObject(chunk.usage) && Number.isInteger(chunk.usage.prompt_tokens) && Number.isInteger(chunk.usage.completion_tokens)) {
      st.usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens };
    }
    var choice = Array.isArray(chunk.choices) && chunk.choices.length > 0 ? chunk.choices[0] : null;
    if (!isObject(choice)) return;
    var d = isObject(choice.delta) ? choice.delta : {};
    if (typeof d.reasoning_content === 'string' && d.reasoning_content !== '') {
      if (st.rc.length < MAX_REASONING_CHARS) st.rc += d.reasoning_content;
      emitter.thinking();
    } else if (typeof d.reasoning === 'string' && d.reasoning !== '') {
      emitter.thinking();
    }
    if (Array.isArray(d.reasoning_details) && st.rd.length < 2000) {
      for (var r = 0; r < d.reasoning_details.length; r++) st.rd.push(d.reasoning_details[r]);
      emitter.thinking();
    }
    var piece = typeof d.content === 'string' ? d.content : '';
    if (typeof d.refusal === 'string' && d.refusal !== '') { piece += d.refusal; st.refusal = true; }
    if (piece !== '') addText(piece, false);
    if (Array.isArray(d.tool_calls)) addToolDeltas(st.calls, d.tool_calls);
    if (typeof choice.finish_reason === 'string' && choice.finish_reason !== '') st.finish = choice.finish_reason;
  }

  function dispatch(payload) {
    if (payload === '[DONE]') { st.sawDone = true; return true; }
    var chunk;
    try { chunk = JSON.parse(payload); } catch (e) { st.malformed++; return false; }
    if (!isObject(chunk)) { st.malformed++; return false; }
    handle(chunk);
    return st.overflow;
  }

  try {
    for (;;) {
      var line = res.readLine();
      if (line === null) { st.ended = true; break; }
      if (line === '') continue;
      if (line.charAt(0) === ':') { emitter.thinking(); continue; } // keep-alive comment
      if (line.indexOf('data:') !== 0) continue;                    // event:, id:, retry:
      var payload = line.slice(5);
      if (payload.charAt(0) === ' ') payload = payload.slice(1);
      if (dispatch(payload)) break;
    }
  } catch (e) {
    // A server that finished its answer but keeps the socket open ends in an idle error: fine.
    if (e && e.aiCode) throw e;
    if (st.finish === null && !st.sawDone) { console.log('chat: stream error ' + (e && e.name ? e.name : 'error')); aiFail('server'); }
  }
  if (held !== '') addText('', true); // a high surrogate that never got its partner
  return st;
}

// ------------------------------------------------------------------ errors
function readErrorBody(res) {
  try {
    var t = res.text();
    return typeof t === 'string' ? t.slice(0, 8000) : '';
  } catch (e) { return ''; }
}

/** {code, type, message} (lower-case, for matching only) of an OpenAI-style error body. */
function errorInfo(body) {
  var info = { code: '', type: '', message: '' };
  var j;
  try { j = JSON.parse(body); } catch (e) { return info; }
  if (Array.isArray(j) && j.length > 0) j = j[0];
  if (isObject(j) && j.error !== undefined) j = j.error;
  if (typeof j === 'string') { info.message = j.toLowerCase(); return info; }
  if (!isObject(j)) return info;
  if (typeof j.code === 'string' || typeof j.code === 'number') info.code = String(j.code).toLowerCase();
  if (typeof j.type === 'string') info.type = j.type.toLowerCase();
  if (typeof j.message === 'string') info.message = j.message.toLowerCase();
  return info;
}

var QUOTA_CODES = ['insufficient_quota', 'credit_balance_exhausted', 'billing_hard_limit_reached', 'organization_usage_limit_exceeded'];

/** HTTP status (+ body for matching only) -> {code, retryAfterSec?}. */
function classifyStatus(status, body, retryAfterHeader) {
  var info = errorInfo(body);
  if (status === 401 || status === 403) return { code: 'key' };
  if (status === 402) return { code: 'quota' };
  if (status === 429) {
    if (QUOTA_CODES.indexOf(info.code) >= 0 || QUOTA_CODES.indexOf(info.type) >= 0) return { code: 'quota' };
    var out = { code: 'rate_limit' };
    if (typeof retryAfterHeader === 'string' && /^\s*\d{1,7}\s*$/.test(retryAfterHeader)) out.retryAfterSec = parseInt(retryAfterHeader, 10);
    return out;
  }
  if (status === 404) return { code: 'model_not_found' };
  if (status === 413) return { code: 'too_large' };
  if (status === 400 || status === 422) {
    if (/api[ _-]?key/.test(info.message) || /api[ _-]?key/.test(info.code)) return { code: 'key' };
    if (info.code === 'context_length_exceeded' || /context.length|maximum context|too many tokens/.test(info.message)) return { code: 'context_length' };
    return { code: 'bad_request' };
  }
  if (status >= 500 || status === 408) return { code: 'server' };
  if (status >= 300 && status < 400) return { code: 'config' };
  return { code: 'bad_request' };
}

/** The most useful of several rotated failures: wait > top-up > key. */
function bestFailure(failures) {
  var order = ['rate_limit', 'quota', 'key'];
  for (var o = 0; o < order.length; o++) {
    var best = null;
    for (var i = 0; i < failures.length; i++) {
      var f = failures[i];
      if (f.code !== order[o]) continue;
      // among waits, the longest: retrying earlier would fail again
      if (best === null || (order[o] === 'rate_limit' && (f.retryAfterSec || 0) > (best.retryAfterSec || 0))) best = f;
    }
    if (best !== null) return best;
  }
  return failures[failures.length - 1];
}
