// QuickJS-faithful harness for `ai-chat` plugins (phases 2 and 3 `require` it).
//
//   node tools/chat_harness.js --self-test     -> prints `ok`
//
// The plugin runs in `vm.createContext` with ONLY the Kanaru host globals
// (Response, fetch, sleep, emit, console/Log, localConfig, localStorage, load,
// plus JSON, Math and a Date whose clock is injectable). `TextEncoder`,
// `Buffer`, `require`, `process`, `setTimeout`, `URL` ... are undefined, and
// `eval` / `Function` throw (codeGeneration off). `crypto.js` defines a small
// CryptoJS (MD5, SHA1/256/512, HmacSHA256; enc Hex / Base64 / Utf8 only on
// `toString`). Known differences from QuickJS: no `Html`, promise jobs run once
// node's stack unwinds, a wall-time overrun is reported after the run (it cannot
// interrupt), stack/heap limits are not modelled.
//
// ---------------------------------------------------------------- API
//   const { createChatHarness, sse, contractProblems, LIMITS } = require('./chat_harness');
//
//   const h = createChatHarness(pluginDir, {
//     config: { apiKeys: ['sk-test-123456'], baseUrl: 'https://x.example.com/v1', model: 'm' },
//                                  // what localConfig.getItem(key) returns (typed values)
//     keys: [...],                 // secrets to scan for; default: manifest chat.keyField value(s)
//     authHeader: 'authorization', // the ONLY header allowed to carry a key ('x-goog-api-key' for Gemini)
//     idleSec: 90,                 // stream read idle timeout (clamped 1..90)
//     bodyCapBytes: 1 MiB,         // request body cap (Buffer.byteLength, outside the context)
//     wallMs: 300000,              // stream run wall time (reported after the run)
//     scanEmitInput: true,         // false: do not flag input fragments in emits (live runs)
//     startMs, clock, sleep, transport  // live mode only (see run_chat_live.js)
//   });
//   h.enqueue(spec, ...)           // FIFO fixtures, one per fetch; or h.setHandler(req => spec)
//   const r = h.execute(input);    // fresh engine per call (like the app)
//
// Fixture spec (one fetch answer):
//   { status: 200, headers: {'retry-after': '7'},
//     sse: sse([{...}, {...}, '[DONE]']),    // text split into one chunk per event
//     eventDelayMs: 0,                       // clock advance before each sse chunk
//     chunks: ['raw', {text, delayMs, throw:{name,message}}],  // explicit chunks
//     body: 'text' | {json},                 // one chunk (error bodies, non-stream)
//     hang: true,                            // after the chunks the next read idles out
//     delayMs: 0,                            // clock advance before the headers
//     throw: {name:'NetworkError'|'InvalidRequestError'|..., message, retryAfterSec} }
//   sse(events, {eol:'\n'}) -> 'data: <json>\n\n' per event; a string event is sent as is
//   ('[DONE]').
//
// Result `r`:
//   status      'ok' | 'scriptError' | 'outputTooLarge' | 'timeout'
//   output      parsed Response.success data (or null)      outputBytes
//   error       {message, kind, retryAfterSec} | null  (Response.error, or thrown -> invalidResponse)
//   jsError     {name, message} | null (the script threw)
//   emits       [{t (ms since start), bytes, text (raw JSON), value}]
//   emitStats   {count, bytes, textEmits, shortFastPairs, rateWaits, rateWaitMs}
//   requests    [{n, t, method, url, headers (key masked), body (parsed), bodyBytes, stream, status, error}]
//   sends       HTTP sends used            streams {opened, notClosed}
//   logs        console lines (cut like the host)       elapsedMs, maxSilenceMs
//   violations  [{kind, where, detail}] -- URL judging (judgePluginUrl rules: https, host in manifest
//               hosts or the user's `format: url` value, no userinfo / port / IP literal), key in
//               URL / body / non-auth header (request is refused, never sent), key prefix (first 6)
//               or >=16-char fragment of the input in errors / emits / console, idle silence
//               > idleTimeoutSec, input > 768 KiB, wall time. `detail` never holds a key.
//   unusedFixtures   fixtures left in the queue
//   contractProblems chat contract check of result + emits (see contractProblems())
//
// Limits modelled (host_prelude.js + plugin-host-api.md): 10 sends (TooManyRequestsError),
// 2 streams open-or-dead-not-closed (TooManyStreamsError), body cap (InvalidRequestError),
// emit <= 64 KiB (RangeError), <= 8 MiB total, lone surrogate (TypeError), emit rate 100/s
// after a burst of 50 (waits, reported), readLine <= 1 MiB (RangeError), stream text() <= 4 MiB,
// idle read -> NetworkError (stream dead until close()).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

const KiB = 1024;
const MiB = 1024 * 1024;
const LIMITS = Object.freeze({
  maxSends: 10, maxOpenStreams: 2, emitEventBytes: 64 * KiB, emitTotalBytes: 8 * MiB,
  emitBurst: 50, emitPerSec: 100, bodyBytes: MiB, lineChars: MiB, streamTextBytes: 4 * MiB,
  streamBodyBytes: 16 * MiB, outputBytes: 2 * MiB, errorChars: 1000, logLineChars: 500,
  logLines: 50, inputBytes: 768 * KiB, providerBytes: 256 * KiB, wallMs: 300000, storageBytes: 64 * KiB,
});
const DROPPED_HEADERS = new Set(['accept-encoding', 'host', 'connection', 'content-length',
  'transfer-encoding', 'te', 'upgrade', 'keep-alive', 'trailer', 'expect']);
const ERROR_KINDS = ['rateLimited', 'invalidResponse', 'server', 'auth', 'quota'];
const AI_CODES = {
  key: 'auth', quota: 'quota', rate_limit: 'rateLimited', config: 'invalidResponse',
  bad_request: 'invalidResponse', model_not_found: 'invalidResponse', context_length: 'invalidResponse',
  too_large: 'invalidResponse', blocked: 'invalidResponse', empty: 'invalidResponse', server: 'server',
};
const FRAGMENT = 16;

// ------------------------------------------------------------ in-context prelude
// Evaluated inside the plugin's context (source taken from this function), so
// errors and objects belong to the plugin's realm like in QuickJS.
function preludeFn(n) {
  'use strict';
  var Str = String, Num = Number, Err = Error, stringify = JSON.stringify, parse = JSON.parse;
  var freeze = Object.freeze, defineProperty = Object.defineProperty;
  var call = Function.prototype.call;
  var join = call.bind(Array.prototype.join);
  var lower = call.bind(String.prototype.toLowerCase);
  var wellFormed = call.bind(String.prototype.toWellFormed);
  var hasOwn = call.bind(Object.prototype.hasOwnProperty);
  var RealDate = Date;

  function strict(v) {
    var s = Str(v);
    if (wellFormed(s) !== s) throw new TypeError('strings passed to the host must be well-formed Unicode (no lone surrogates)');
    return s;
  }
  function makeError(name, message) {
    var e = new Err(message);
    defineProperty(e, 'name', { value: name, writable: true, configurable: true, enumerable: false });
    return e;
  }
  function raise(v) {
    var e = v.error === 'RangeError' ? new RangeError(v.message)
      : v.error === 'TypeError' ? new TypeError(v.message) : makeError(v.error, v.message);
    if (v.retryAfterSec !== undefined) e.retryAfterSec = v.retryAfterSec;
    throw e;
  }
  function define(name, value) {
    defineProperty(globalThis, name, { value: value, writable: true, configurable: true, enumerable: false });
  }
  function isErr(v) { return v !== null && typeof v === 'object' && typeof v.error === 'string'; }
  function makeHeaders(flat) {
    var o = {};
    for (var i = 0; i + 1 < flat.length; i += 2) {
      defineProperty(o, flat[i], { value: flat[i + 1], writable: true, configurable: true, enumerable: true });
    }
    return o;
  }
  function common(r) {
    var headers = makeHeaders(r.headers);
    return {
      status: r.status, ok: r.status >= 200 && r.status <= 299, url: r.url, headers: freeze(headers),
      header: function header(name) {
        var key = lower(Str(name));
        return hasOwn(headers, key) ? headers[key] : null;
      },
    };
  }
  function pull(id, mode) {
    var v = n.streamRead(id, mode);
    if (isErr(v)) raise(v);
    return v;
  }
  function makeResponse(r) {
    var id = r.id, text_, b64_;
    function readText() {
      if (text_ === undefined) {
        if (b64_ !== undefined) throw makeError('Error', 'the body was already read as base64');
        text_ = pull(id, 2);
      }
      return text_;
    }
    var o = common(r);
    o.text = function text() { return readText(); };
    o.json = function json() { return parse(readText()); };
    o.base64 = function base64() {
      if (b64_ === undefined) {
        if (text_ !== undefined) throw makeError('Error', 'the body was already read as text');
        var v = n.bodyBase64(id);
        if (isErr(v)) raise(v);
        b64_ = v;
      }
      return b64_;
    };
    return freeze(o);
  }
  function makeStream(r) {
    var id = r.id, o = common(r);
    o.readLine = function readLine() { return pull(id, 0); };
    o.read = function read() { return pull(id, 1); };
    o.text = function text() { return pull(id, 2); };
    o.close = function close() { n.streamClose(id); };
    return freeze(o);
  }

  define('fetch', function fetch(url, options) {
    var r = n.fetch(strict(url), options);
    if (r.error !== undefined) raise(r);
    return r.stream === true ? makeStream(r) : makeResponse(r);
  });
  define('sleep', function sleep(ms) { n.sleep(Num(ms)); });
  define('load', function load(name) {
    var r = n.load(strict(name));
    if (r !== undefined) raise(r);
  });
  define('Response', freeze({
    success: function success(data) { return n.success(data); },
    error: function error(message, options) { return n.error(message, options); },
  }));

  var replacerThrew = false;
  var wellFormedReplacer = function (key, value) {
    if (wellFormed(key) !== key || (typeof value === 'string' && wellFormed(value) !== value)) {
      replacerThrew = true;
      throw new TypeError('strings passed to the host must be well-formed Unicode (no lone surrogates)');
    }
    return value;
  };
  define('emit', function emit(value) {
    var text;
    replacerThrew = false;
    try { text = stringify(value, wellFormedReplacer); } catch (e) {
      if (replacerThrew) { replacerThrew = false; throw e; }
      throw new TypeError('emit: the value must be JSON-serialisable');
    }
    if (typeof text !== 'string') throw new TypeError('emit: the value must be JSON-serialisable');
    var v = n.emit(text);
    if (v !== undefined) raise(v);
  });

  define('localConfig', freeze({
    getItem: function getItem(key) {
      var t = n.configGet(strict(key));
      return t === undefined || t === null ? null : parse(t);
    },
  }));

  // Chat runs have no persistent storage: an in-run map that is thrown away.
  var store = {}, used = 0;
  define('localStorage', freeze({
    getItem: function getItem(k) { k = strict(k); return hasOwn(store, k) ? store[k] : null; },
    setItem: function setItem(k, v) {
      k = strict(k); v = strict(v);
      var next = used - (hasOwn(store, k) ? k.length + store[k].length : 0) + k.length + v.length;
      if (next > n.storageBytes) throw makeError('QuotaExceededError', 'localStorage is full (64 KiB for keys and values)');
      store[k] = v; used = next;
    },
    removeItem: function removeItem(k) {
      k = strict(k);
      if (hasOwn(store, k)) { used -= k.length + store[k].length; delete store[k]; }
    },
    clear: function clear() { store = {}; used = 0; },
  }));

  function format(a) {
    if (typeof a === 'string') return a;
    if (a !== null && typeof a === 'object' && !(a instanceof Err)) {
      try { var s = stringify(a); if (typeof s === 'string') return s; } catch (e) { /* fall through */ }
    }
    try { return Str(a); } catch (e) { return '[unprintable value]'; }
  }
  function logger() {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts[i] = format(arguments[i]);
    n.log(wellFormed(join(parts, ' ')));
  }
  define('console', { log: logger, info: logger, warn: logger, error: logger, debug: logger });
  define('Log', { log: logger });

  // Date reads the harness clock (virtual in fixture runs).
  function KDate() {
    if (!new.target) return new RealDate(n.now()).toString();
    if (arguments.length === 0) return new RealDate(n.now());
    return Reflect.construct(RealDate, Array.prototype.slice.call(arguments));
  }
  KDate.prototype = RealDate.prototype;
  KDate.now = function now() { return n.now(); };
  KDate.parse = RealDate.parse;
  KDate.UTC = RealDate.UTC;
  define('Date', KDate);
}

// Small CryptoJS stand-in, installed by load('crypto.js').
function cryptoStubFn(n) {
  'use strict';
  function word(hex) {
    return {
      toString: function toString(enc) { return n.encode(hex, enc && enc.__enc); },
    };
  }
  function hash(alg) { return function (m) { return word(n.hash(alg, String(m))); }; }
  globalThis.CryptoJS = {
    MD5: hash('md5'), SHA1: hash('sha1'), SHA256: hash('sha256'), SHA512: hash('sha512'),
    HmacSHA256: function (m, k) { return word(n.hmac('sha256', String(m), String(k))); },
    enc: { Hex: { __enc: 'hex' }, Base64: { __enc: 'base64' }, Utf8: { __enc: 'utf8' } },
  };
}

// ------------------------------------------------------------------ URL judging
function hostMatches(pattern, host) {
  if (!pattern.startsWith('*.')) return pattern === host;
  const dot = host.indexOf('.');
  return dot > 0 && host.slice(dot + 1) === pattern.slice(2) && /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(host.slice(0, dot));
}

// The host's address_class.dart `isLocalHostName` list (runtime rule, not the stricter manifest list).
const LOCAL_SUFFIXES = ['.local', '.lan', '.home.arpa', '.internal', '.localdomain', '.localhost'];

/**
 * Splits a URL like Dart's Uri.tryParse does for the host rules: scheme and `//`
 * are required (`https:host` has no authority), a numeric top label is just a
 * name (WHATWG `new URL` would call it an IPv4 address). null = not a URL.
 * port: '' when absent, else the digits.
 */
function parseUrl(text) {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^\/?#]*)/.exec(String(text));
  if (!m) return null;
  let auth = m[2];
  let username = '';
  const at = auth.lastIndexOf('@');
  if (at >= 0) { username = auth.slice(0, at); auth = auth.slice(at + 1); }
  let hostname = auth;
  let port = '';
  const pm = /^(.*):(\d*)$/.exec(auth);
  if (pm && !/^\[[^\]]*$/.test(pm[1])) { hostname = pm[1]; port = pm[2]; }
  else if (/:/.test(auth) && !/^\[.*\]$/.test(auth)) return null;
  if (!hostname) return null;
  return { protocol: m[1].toLowerCase() + ':', username, password: '', hostname: hostname.toLowerCase(), port };
}

function portOk(u) { return u.port === '' || (Number(u.port) >= 1 && Number(u.port) <= 65535); }

/** Like the host's `_isPublicHttpsName`: https, no user info, no IP literal, a public-looking name, a usable port. */
function isPublicHttpsName(u) {
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) return false; // also IPv6 and single labels
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false; // IPv4 literal
  if (LOCAL_SUFFIXES.some((s) => host.endsWith(s))) return false;
  return portOk(u);
}

/**
 * Like judgePluginUrl: not a URL -> InvalidRequestError; every URL the rules
 * refuse (not https, user info, IP literal, localhost / local name, bad port,
 * host not listed) -> BlockedHostError. Returns null when allowed, else {error, reason}.
 */
function judgeUrl(urlText, manifestHosts, userUrls) {
  const u = parseUrl(urlText);
  if (!u) return { error: 'InvalidRequestError', reason: 'not a URL' };
  if (u.protocol !== 'https:') return { error: 'BlockedHostError', reason: 'not https' };
  if (u.username || u.password) return { error: 'BlockedHostError', reason: 'user info in URL' };
  if (!isPublicHttpsName(u)) return { error: 'BlockedHostError', reason: 'not a public host name (IP literal, localhost, local name, port)' };
  const host = u.hostname;
  const user = userUrls.find((x) => isPublicHttpsName(x) && x.hostname === host && x.port === u.port);
  if (user) return null;
  if (u.port) return { error: 'BlockedHostError', reason: 'port not allowed' };
  if (!manifestHosts.some((p) => hostMatches(String(p).toLowerCase(), host))) {
    return { error: 'BlockedHostError', reason: 'host not in manifest hosts' };
  }
  return null;
}

// ------------------------------------------------------------------ SSE helper
function sse(events, opts) {
  const eol = (opts && opts.eol) || '\n';
  return events.map((e) => 'data: ' + (typeof e === 'string' ? e : JSON.stringify(e)) + eol + eol).join('');
}

// ----------------------------------------------------------- fixture transport
// Transport interface (sync): open(req) -> {id, status, headers}, read(id, idleMs) -> string|null
// (throws {name, message}), close(id). Live mode passes its own.
function toChunks(spec) {
  if (spec.chunks) return spec.chunks.map((c) => (typeof c === 'string' ? { text: c, delayMs: 0 } : c));
  if (spec.sse !== undefined) {
    return spec.sse.split(/(?<=\n\n)/).filter(Boolean).map((text) => ({ text, delayMs: spec.eventDelayMs || 0 }));
  }
  if (spec.body === undefined || spec.body === '') return [];
  return [{ text: typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body), delayMs: 0 }];
}

function makeFixtureTransport(h, clock) {
  const open = new Map();
  let next = 1;
  return {
    open(req) {
      const spec = h._handler ? h._handler(req) : h._queue.shift();
      if (!spec) throw { name: 'NetworkError', message: 'no fixture for request #' + req.n };
      clock.advance(spec.delayMs || 0);
      if (spec.throw) throw spec.throw;
      const id = next++;
      open.set(id, { chunks: toChunks(spec), i: 0, hang: !!spec.hang });
      const headers = {};
      for (const [k, v] of Object.entries(spec.headers || {})) headers[k.toLowerCase()] = String(v);
      if (spec.sse !== undefined && !headers['content-type']) headers['content-type'] = 'text/event-stream';
      return { id, status: spec.status === undefined ? 200 : spec.status, headers };
    },
    read(id, idleMs) {
      const st = open.get(id);
      if (!st) return null;
      if (st.i >= st.chunks.length) {
        if (!st.hang) return null;
        clock.advance(idleMs);
        throw { name: 'NetworkError', message: 'stream idle timeout' };
      }
      const c = st.chunks[st.i];
      if ((c.delayMs || 0) > idleMs) {
        clock.advance(idleMs);
        throw { name: 'NetworkError', message: 'stream idle timeout' };
      }
      clock.advance(c.delayMs || 0);
      st.i++;
      if (c.throw) throw c.throw;
      return c.text;
    },
    close(id) { open.delete(id); },
  };
}

// ------------------------------------------------------------------- harness
function readManifest(pluginDir) {
  return JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8'));
}

function createChatHarness(pluginDir, opts = {}) {
  const manifest = readManifest(pluginDir);
  const meta = manifest.metadata || {};
  const chatBlock = manifest.chat || {};
  const entry = manifest.script && manifest.script.chat;
  if (!entry) throw new Error('plugin.json has no script.chat');
  const config = opts.config || {};
  const authHeader = String(opts.authHeader || 'authorization').toLowerCase();
  const idleMs = Math.min(90, Math.max(1, opts.idleSec === undefined ? 90 : opts.idleSec)) * 1000;
  const bodyCap = opts.bodyCapBytes === undefined ? LIMITS.bodyBytes : opts.bodyCapBytes;
  const wallMs = opts.wallMs === undefined ? LIMITS.wallMs : opts.wallMs;
  const emitIdleMs = Math.min(90, Math.max(1, chatBlock.idleTimeoutSec || 90)) * 1000;
  const scanEmitInput = opts.scanEmitInput !== false;

  let virtual = opts.startMs === undefined ? 1700000000000 : opts.startMs;
  const clock = opts.clock || { now: () => virtual, advance: (ms) => { virtual += ms; } };
  const sleepFn = opts.sleep || ((ms) => clock.advance(ms));

  const keyValue = config[chatBlock.keyField];
  const keys = (opts.keys || (Array.isArray(keyValue) ? keyValue : keyValue ? [keyValue] : []))
    .map(String).filter((k) => k.length > 0);
  const needles = [];
  keys.forEach((k, i) => {
    needles.push({ i, s: k });
    if (k.length >= 8) needles.push({ i, s: k.slice(0, 6) });
  });
  const userUrls = [];
  for (const [key, def] of Object.entries(manifest.config || {})) {
    if (def && def.format === 'url' && typeof config[key] === 'string') {
      { const pu = parseUrl(config[key]); if (pu) userUrls.push(pu); /* not a URL: not allowed */ }
    }
  }

  const h = { manifest, _queue: [], _handler: null };
  h.enqueue = (...specs) => { h._queue.push(...specs); return h; };
  h.setHandler = (fn) => { h._handler = fn; return h; };
  const transport = opts.transport || makeFixtureTransport(h, clock);

  const mask = (s) => needles.reduce((acc, nd) => acc.split(nd.s).join('«key#' + nd.i + '»'), String(s));
  const leaksKey = (s) => needles.find((nd) => s.includes(nd.s));

  h.execute = function execute(input) {
    const t0 = clock.now();
    const run = {
      sends: 0, requests: [], emits: [], logs: [], violations: [], streams: new Map(), nextStream: 1,
      loaded: new Set([entry]), branded: new WeakSet(), emitBytes: 0, tokens: LIMITS.emitBurst, tokenAt: t0,
      lastActivity: t0, maxSilence: 0, stats: { count: 0, bytes: 0, textEmits: 0, shortFastPairs: 0, rateWaits: 0, rateWaitMs: 0 },
      opened: 0, rawLogs: [],
    };
    const violate = (kind, where, detail) => run.violations.push({ kind, where, detail: detail || '' });

    // ---- fragments of the input that must not come back out
    let grams = null;
    const buildGrams = () => {
      grams = new Set();
      const add = (s) => {
        if (typeof s !== 'string' || s.length < FRAGMENT) return;
        for (let i = 0; i + FRAGMENT <= s.length; i++) grams.add(s.slice(i, i + FRAGMENT));
      };
      add(input && input.system);
      for (const m of (input && input.messages) || []) {
        for (const p of m.parts || []) {
          add(p.text);
          for (const c of p.content || []) add(c.text);
        }
      }
      for (const t of (input && input.tools) || []) add(t.description);
    };
    const scanOutput = (text, where, { checkInput = true } = {}) => {
      const k = leaksKey(text);
      if (k) violate('key-in-' + where, where, 'key#' + k.i);
      if (!checkInput) return;
      if (!grams) buildGrams();
      for (let i = 0; i + FRAGMENT <= text.length; i++) {
        if (grams.has(text.slice(i, i + FRAGMENT))) { violate('input-in-' + where, where, 'fragment of ' + FRAGMENT + '+ chars at ' + i); return; }
      }
    };

    const inputText = JSON.stringify(input);
    if (Buffer.byteLength(inputText) > LIMITS.inputBytes) violate('limit', 'input', 'input over 768 KiB');

    const ctx = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
    const named = (error, message, extra) => Object.assign({ error, message }, extra || {});
    const runFile = (name, code) => new vm.Script(code, { filename: name }).runInContext(ctx);

    const natives = {
      now: () => clock.now(),
      sleep: (ms) => { sleepFn(Number.isFinite(ms) && ms > 0 ? ms : 0); },
      storageBytes: LIMITS.storageBytes,
      configGet: (key) => (Object.prototype.hasOwnProperty.call(config, key) && config[key] !== undefined ? JSON.stringify(config[key]) : null),
      success: (data) => { const r = { ok: true, data: data === undefined ? null : data }; run.branded.add(r); return r; },
      error: (message, options) => {
        const r = { ok: false, message: String(message).slice(0, LIMITS.errorChars), kind: 'server' };
        if (options && typeof options === 'object') {
          if (ERROR_KINDS.includes(options.kind)) r.kind = options.kind;
          if (typeof options.retryAfterSec === 'number' && Number.isFinite(options.retryAfterSec) && options.retryAfterSec >= 0) {
            r.retryAfterSec = Math.floor(options.retryAfterSec);
          }
        }
        run.branded.add(r);
        return r;
      },
      log: (line) => {
        run.rawLogs.push(line);
        if (run.logs.length < LIMITS.logLines) run.logs.push(line.slice(0, LIMITS.logLineChars));
      },
      load: (name) => {
        if (!/^[A-Za-z0-9_.-]+\.js$/.test(name)) return named('Error', 'load: bad file name');
        if (run.loaded.has(name)) return undefined;
        run.loaded.add(name);
        if (name === 'crypto.js') {
          vm.runInContext('(' + cryptoStubFn + ')', ctx)({
            hash: (alg, s) => nodeCrypto.createHash(alg).update(s, 'utf8').digest('hex'),
            hmac: (alg, s, k) => nodeCrypto.createHmac(alg, k).update(s, 'utf8').digest('hex'),
            encode: (hex, enc) => (enc === 'base64' ? Buffer.from(hex, 'hex').toString('base64') : enc === 'utf8' ? Buffer.from(hex, 'hex').toString('utf8') : hex),
          });
          return undefined;
        }
        const file = path.join(pluginDir, 'src', name);
        if (!fs.existsSync(file)) return named('Error', 'load: file not in the package');
        runFile(name, fs.readFileSync(file, 'utf8'));
        return undefined;
      },
      emit: (text) => {
        const bytes = Buffer.byteLength(text);
        if (bytes > LIMITS.emitEventBytes) return named('RangeError', 'emit: event over 64 KiB');
        if (run.emitBytes + bytes > LIMITS.emitTotalBytes) return named('RangeError', 'emit: run total over 8 MiB');
        let now = clock.now();
        run.tokens = Math.min(LIMITS.emitBurst, run.tokens + (now - run.tokenAt) * LIMITS.emitPerSec / 1000);
        if (run.tokens < 1) {
          const wait = Math.ceil((1 - run.tokens) * 1000 / LIMITS.emitPerSec);
          sleepFn(wait);
          run.stats.rateWaits++;
          run.stats.rateWaitMs += wait;
          run.tokens += wait * LIMITS.emitPerSec / 1000;
          now = clock.now();
        }
        run.tokens -= 1;
        run.tokenAt = now;
        run.emitBytes += bytes;
        run.maxSilence = Math.max(run.maxSilence, now - run.lastActivity);
        run.lastActivity = now;
        const value = JSON.parse(text);
        run.emits.push({ t: now - t0, bytes, text, value });
        run.stats.count++;
        run.stats.bytes += bytes;
        return undefined;
      },
      fetch: (url, options) => nativeFetch(url, options || {}),
      streamRead: (id, mode) => nativeRead(id, mode),
      streamClose: (id) => {
        const s = run.streams.get(id);
        if (!s || s.closed) return;
        s.closed = true;
        transport.close(s.tid);
      },
      bodyBase64: (id) => {
        const v = nativeRead(id, 2);
        return typeof v === 'string' ? Buffer.from(v, 'utf8').toString('base64') : v;
      },
    };

    // ---- fetch
    function nativeFetch(url, options) {
      const method = options.method === undefined ? 'GET' : String(options.method).toUpperCase();
      if (method !== 'GET' && method !== 'POST') return named('TypeError', 'fetch: method must be GET or POST');
      const headers = {};
      for (const [name, value] of Object.entries(options.headers || {})) {
        const lname = name.toLowerCase();
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n\0]/.test(String(value))) {
          return named('InvalidRequestError', 'fetch: invalid header');
        }
        if (DROPPED_HEADERS.has(lname) || lname.startsWith('proxy-')) continue;
        headers[lname] = String(value);
      }
      let body;
      if (options.body !== undefined && options.body !== null) {
        if (typeof options.body === 'string') body = options.body;
        else {
          try { body = JSON.stringify(options.body); } catch (e) { return named('TypeError', 'fetch: body is not JSON-serialisable'); }
          if (!headers['content-type']) headers['content-type'] = 'application/json';
        }
      }
      const bodyBytes = body === undefined ? 0 : Buffer.byteLength(body, 'utf8');
      if (bodyBytes > bodyCap) return named('InvalidRequestError', 'fetch: request body too large');
      let full = url;
      if (options.queries && typeof options.queries === 'object') {
        const qs = Object.entries(options.queries).filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v))).join('&');
        if (qs) full += (full.includes('?') ? '&' : '?') + qs;
      }
      if (run.sends >= LIMITS.maxSends) return named('TooManyRequestsError', 'fetch: 10 HTTP sends used');
      const stream = options.stream === true;
      const record = {
        n: run.requests.length + 1, t: clock.now() - t0, method, url: mask(full),
        headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, mask(v)])),
        body: undefined, bodyBytes, stream,
      };
      if (body !== undefined) { try { record.body = JSON.parse(mask(body)); } catch (e) { record.body = mask(body); } }
      run.requests.push(record);

      const bad = judgeUrl(full, meta.hosts || [], userUrls);
      if (bad) { violate('url', 'request#' + record.n, bad.reason); return named(bad.error, 'fetch: URL refused'); }
      let leak = leaksKey(full);
      if (leak) violate('key-in-url', 'request#' + record.n, 'key#' + leak.i);
      for (const [k, v] of Object.entries(headers)) {
        if (k === authHeader) continue;
        if ((leak = leaksKey(v))) { violate('key-in-header', 'request#' + record.n, k + ' key#' + leak.i); }
      }
      if (body !== undefined && (leak = leaksKey(body))) violate('key-in-body', 'request#' + record.n, 'key#' + leak.i);
      if (run.violations.some((v) => v.where === 'request#' + record.n && v.kind.startsWith('key-in-'))) {
        return named('InvalidRequestError', 'fetch: request refused by the harness (key outside the auth header)');
      }
      if (stream) {
        const openCount = [...run.streams.values()].filter((s) => s.stream && !s.closed).length;
        if (openCount >= LIMITS.maxOpenStreams) return named('TooManyStreamsError', 'fetch: 2 streams already open');
      }
      run.sends++;
      let res;
      try {
        res = transport.open({ n: record.n, method, url: full, headers, body, stream, timeoutMs: options.timeout });
        record.status = res.status;
      } catch (e) {
        record.error = e.name || 'NetworkError';
        return named(e.name || 'NetworkError', 'fetch: ' + (e.name || 'NetworkError'), e.retryAfterSec !== undefined ? { retryAfterSec: e.retryAfterSec } : {});
      }
      const id = run.nextStream++;
      run.opened++;
      run.streams.set(id, { tid: res.id, stream, buf: '', ended: false, dead: false, closed: false, total: 0, first: true, textBytes: 0 });
      const flat = [];
      for (const [k, v] of Object.entries(res.headers || {})) flat.push(k.toLowerCase(), String(v));
      return { id, status: res.status, url: full, headers: flat, stream };
    }

    // ---- stream reads
    function pull(s) {
      const chunk = transport.read(s.tid, idleMs);
      if (chunk === null || chunk === undefined) { s.ended = true; return ''; }
      s.total += Buffer.byteLength(chunk, 'utf8');
      if (s.total > LIMITS.streamBodyBytes) throw { name: 'InvalidResponseError', message: 'stream body over 16 MiB' };
      let text = chunk;
      if (s.first) { s.first = false; if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); }
      s.buf += text;
      return text;
    }
    function nativeRead(id, mode) {
      const s = run.streams.get(id);
      if (!s || s.closed || s.dead) return null;
      try {
        if (mode === 0) return readLine(s);
        if (mode === 1) {
          for (;;) {
            if (s.buf !== '') { const out = s.buf; s.buf = ''; return out; }
            if (s.ended) return null;
            pull(s);
          }
        }
        while (!s.ended) {
          pull(s);
          if (Buffer.byteLength(s.buf, 'utf8') > LIMITS.streamTextBytes) throw { name: 'RangeError', message: 'stream text() over 4 MiB' };
        }
        const out = s.buf; s.buf = ''; return out;
      } catch (e) {
        if (!e || typeof e.name !== 'string' || typeof e.message !== 'string') throw e;
        s.dead = true; // keeps its slot until close()
        return named(e.name, e.message, e.retryAfterSec !== undefined ? { retryAfterSec: e.retryAfterSec } : {});
      }
    }
    function readLine(s) {
      for (;;) {
        const i = s.buf.search(/[\r\n]/);
        if (i >= 0) {
          const c = s.buf[i];
          if (c === '\r' && i === s.buf.length - 1 && !s.ended) { pull(s); continue; } // look ahead for \n
          if (i > LIMITS.lineChars) throw { name: 'RangeError', message: 'readLine: line over 1 MiB' };
          const len = c === '\r' && s.buf[i + 1] === '\n' ? 2 : 1;
          const line = s.buf.slice(0, i);
          s.buf = s.buf.slice(i + len);
          return line;
        }
        if (s.buf.length > LIMITS.lineChars) throw { name: 'RangeError', message: 'readLine: line over 1 MiB' };
        if (s.ended) { if (s.buf === '') return null; const l = s.buf; s.buf = ''; return l; }
        pull(s);
      }
    }

    // ---- run the plugin
    let outcome = { status: 'ok', output: null, outputBytes: 0, error: null, jsError: null };
    try {
      vm.runInContext('(' + preludeFn + ')', ctx, { filename: 'host_prelude.js' })(natives);
      runFile(entry, fs.readFileSync(path.join(pluginDir, 'src', entry), 'utf8'));
      const exec = vm.runInContext('typeof execute === "function" ? execute : undefined', ctx);
      if (!exec) throw new Error('script has no execute function');
      const inputValue = vm.runInContext('JSON.parse', ctx)(inputText);
      const ret = exec(inputValue);
      if (ret && typeof ret === 'object' && run.branded.has(ret)) {
        if (ret.ok) {
          const text = JSON.stringify(ret.data);
          const bytes = Buffer.byteLength(text, 'utf8');
          outcome.outputBytes = bytes;
          if (bytes > LIMITS.outputBytes) outcome.status = 'outputTooLarge';
          else outcome.output = JSON.parse(text);
        } else {
          outcome.status = 'scriptError';
          outcome.error = { message: ret.message, kind: ret.kind, retryAfterSec: ret.retryAfterSec };
        }
      } else {
        outcome.status = 'scriptError';
        outcome.error = { message: 'execute must return Response.success or Response.error', kind: 'invalidResponse' };
      }
    } catch (e) {
      const message = String((e && e.message) || e).slice(0, LIMITS.errorChars);
      outcome.status = 'scriptError';
      outcome.jsError = { name: String((e && e.name) || 'Error'), message };
      outcome.error = { message, kind: 'invalidResponse' };
    }

    // ---- post-run checks
    const end = clock.now();
    run.maxSilence = Math.max(run.maxSilence, end - run.lastActivity);
    if (run.maxSilence > emitIdleMs) violate('idle', 'run', 'silence ' + run.maxSilence + ' ms > ' + emitIdleMs + ' ms');
    if (end - t0 > wallMs) { outcome.status = 'timeout'; violate('limit', 'run', 'wall time over ' + wallMs + ' ms'); }
    if (outcome.error) scanOutput(outcome.error.message, 'error');
    for (const e of run.emits) scanOutput(e.text, 'emit', { checkInput: scanEmitInput });
    for (const l of run.rawLogs) scanOutput(l, 'console');
    if (outcome.output !== null) {
      const k = leaksKey(JSON.stringify(outcome.output));
      if (k) violate('key-in-output', 'output', 'key#' + k.i);
    }
    const texts = run.emits.filter((e) => e.value && e.value.t === 'text');
    run.stats.textEmits = texts.length;
    for (let i = 1; i < texts.length - 1; i++) {
      if (texts[i].t - texts[i - 1].t < 50 && String(texts[i - 1].value.d).length < 256) run.stats.shortFastPairs++;
    }
    const notClosed = [...run.streams.values()].filter((s) => s.stream && !s.closed).length;
    const result = {
      ...outcome, emits: run.emits, emitStats: run.stats, requests: run.requests, sends: run.sends,
      streams: { opened: run.opened, notClosed }, logs: run.logs, violations: run.violations,
      elapsedMs: end - t0, maxSilenceMs: run.maxSilence, unusedFixtures: h._queue.length,
    };
    result.contractProblems = contractProblems(result);
    return result;
  };
  return h;
}

// ------------------------------------------------------------ contract checker
/** Problems of a chat run against the documented contract (empty list = fine). */
function contractProblems(r) {
  const p = [];
  if (r.status === 'ok') {
    const o = r.output;
    if (!o || typeof o !== 'object') return ['output is not an object'];
    if (!['stop', 'tool_calls', 'length', 'blocked'].includes(o.finish)) p.push('finish: ' + String(o.finish).slice(0, 20));
    if (typeof o.text !== 'string') p.push('text is not a string');
    const calls = o.toolCalls === undefined ? [] : o.toolCalls;
    if (!Array.isArray(calls)) p.push('toolCalls is not an array');
    else {
      if (calls.length > 8) p.push('more than 8 toolCalls');
      if (o.finish === 'tool_calls' && calls.length === 0) p.push('finish tool_calls without toolCalls');
      calls.forEach((c, i) => {
        if (typeof c.name !== 'string' || c.name.length === 0 || c.name.length > 64) p.push('toolCalls[' + i + '].name');
        if (c.providerId !== undefined && !/^[A-Za-z0-9_.:-]{1,64}$/.test(c.providerId)) p.push('toolCalls[' + i + '].providerId');
        if (c.args === undefined || c.args === null || (typeof c.args !== 'object' && typeof c.args !== 'string')) p.push('toolCalls[' + i + '].args');
      });
    }
    if (o.usage !== undefined && !(Number.isInteger(o.usage.input) && Number.isInteger(o.usage.output))) p.push('usage');
    if (o.provider !== undefined && Buffer.byteLength(JSON.stringify(o.provider)) > LIMITS.providerBytes) p.push('provider over 256 KiB');
  } else if (r.status === 'scriptError' && r.error && !r.jsError) {
    const m = /^ai:([a-z_]+)$/.exec(r.error.message);
    if (!m || !(m[1] in AI_CODES)) p.push('error message is not an ai:<code> (' + r.error.message.length + ' chars)');
    else if (AI_CODES[m[1]] !== r.error.kind) p.push('ai:' + m[1] + ' must have kind ' + AI_CODES[m[1]] + ', got ' + r.error.kind);
    if (r.error.retryAfterSec !== undefined && m && m[1] !== 'rate_limit') p.push('retryAfterSec only with rate_limit');
  } else if (r.status !== 'ok') p.push('run ended ' + r.status + (r.jsError ? ' (' + r.jsError.name + ')' : ''));
  for (const e of r.emits) {
    const v = e.value;
    if (!v || (v.t === 'text' && typeof v.d !== 'string') || (v.t === 'status' && !['thinking', 'generating'].includes(v.s)) ||
        (v.t !== 'text' && v.t !== 'status')) p.push('emit shape: t=' + String(v && v.t).slice(0, 12));
  }
  return p;
}

// ------------------------------------------------------------------ self-test
function selfTest() {
  const assert = require('assert');
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-harness-'));
  const KEY = 'sk-test-ABCDEF123456';
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({
      metadata: { type: 'ai-chat', hosts: ['api.example.com', '*.wild.example.org'] },
      script: { chat: 'chat.js' },
      chat: { keyField: 'apiKeys', idleTimeoutSec: 90 },
      config: { baseUrl: { format: 'url' }, apiKeys: { mode: 'list' } },
    }));
    fs.writeFileSync(path.join(dir, 'src', 'util.js'), 'function helper() { return "helped"; }\n');
    fs.writeFileSync(path.join(dir, 'src', 'chat.js'), `
load('util.js');
function open(url, extra) {
  var o = { stream: true, headers: { Authorization: 'Bearer ' + localConfig.getItem('apiKeys')[0] } };
  for (var k in (extra || {})) o[k] = extra[k];
  return fetch(url || 'https://api.example.com/v1/chat', o);
}
function tryName(fn) { try { fn(); return null; } catch (e) { return e.name; } }
function execute(input) {
  var t = input.test, r, i, out;
  if (t === 'globals') return Response.success({ te: typeof TextEncoder, buf: typeof Buffer, req: typeof require,
    proc: typeof process, st: typeof setTimeout, url: typeof URL, emit: typeof emit, helper: helper(),
    evalName: tryName(function () { eval('1'); }), fnName: tryName(function () { new Function('return 1'); }),
    sha: typeof CryptoJS, d: Date.now(), after: (sleep(1500), Date.now()) });
  if (t === 'lines') {
    r = open(); out = []; var l;
    while ((l = r.readLine()) !== null) out.push(l);
    r.close();
    return Response.success(out);
  }
  if (t === 'idle') {
    r = open(); var name = tryName(function () { r.readLine(); });
    var after = r.readLine();
    r.close();
    return Response.success({ name: name, after: after });
  }
  if (t === 'dead') {
    var s1 = open(); var n1 = tryName(function () { s1.readLine(); });
    var s2 = open(); var n3 = tryName(function () { open(); });
    s1.close(); var n4 = tryName(function () { open(); });
    return Response.success({ n1: n1, n3: n3, n4: n4 });
  }
  if (t === 'third') {
    var a = open(), b = open(); var c = tryName(function () { open(); });
    a.close(); b.close();
    return Response.success({ c: c });
  }
  if (t === 'sends') {
    out = [];
    for (i = 0; i < 11; i++) out.push(tryName(function () { fetch('https://api.example.com/x'); }));
    return Response.success(out);
  }
  if (t === 'body') {
    var big = new Array(1048577).join('a') + 'aa';
    var multi = new Array(400001).join('\\u20ac');
    return Response.success({
      ascii: tryName(function () { fetch('https://api.example.com/x', { method: 'POST', body: big }); }),
      multi: tryName(function () { fetch('https://api.example.com/x', { method: 'POST', body: multi }); }),
    });
  }
  if (t === 'emit') {
    var big2 = new Array(70001).join('x');
    var res = { lone: tryName(function () { emit({ t: 'text', d: '\\ud800' }); }),
      big: tryName(function () { emit({ t: 'text', d: big2 }); }) };
    for (i = 0; i < 60; i++) emit({ t: 'text', d: 'x' });
    return Response.success(res);
  }
  if (t === 'urls') {
    return Response.success({
      http: tryName(function () { fetch('http://api.example.com/x'); }),
      other: tryName(function () { fetch('https://evil.example.net/x'); }),
      ip: tryName(function () { fetch('https://127.0.0.1/x'); }),
      userinfo: tryName(function () { fetch('https://u:p@api.example.com/x'); }),
      wild: tryName(function () { fetch('https://a.wild.example.org/x'); }),
      user: tryName(function () { fetch('https://my.local-ai.example.com:8443/x'); }),
      localhost: tryName(function () { fetch('https://localhost/x'); }),
      port: tryName(function () { fetch('https://api.example.com:8443/x'); }),
      broken: tryName(function () { fetch('https://[::1/x'); }),
      port0: tryName(function () { fetch('https://my.local-ai.example.com:0/x'); }),
      portBig: tryName(function () { fetch('https://api.example.com:99999/x'); }),
      noSlashes: tryName(function () { fetch('https:api.example.com/x'); }),
      numLabel: tryName(function () { fetch('https://foo.123/x'); }),
      corp: tryName(function () { fetch('https://llm.corp/x'); }),
    });
  }
  if (t === 'keyquery') {
    return Response.success({
      query: tryName(function () { fetch('https://api.example.com/x', { queries: { key: localConfig.getItem('apiKeys')[0] } }); }),
      header: tryName(function () { fetch('https://api.example.com/x', { headers: { 'x-other': localConfig.getItem('apiKeys')[0] } }); }),
      body: tryName(function () { fetch('https://api.example.com/x', { method: 'POST', body: { k: localConfig.getItem('apiKeys')[0] } }); }),
      ok: tryName(function () { fetch('https://api.example.com/x', { headers: { Authorization: 'Bearer ' + localConfig.getItem('apiKeys')[0] } }); }),
    });
  }
  if (t === 'leak-error') { console.log('using ' + localConfig.getItem('apiKeys')[0].slice(0, 6)); return Response.error('failed with ' + localConfig.getItem('apiKeys')[0], { kind: 'auth' }); }
  if (t === 'text') { r = fetch('https://api.example.com/x'); return Response.success({ status: r.status, ra: r.header('Retry-After'), json: r.json() }); }
  if (t === 'throws') { null.x; }
  if (t === 'noresp') return { ok: true };
  return Response.error('ai:server', { kind: 'server' });
}
`);
    const base = { apiKeys: [KEY], baseUrl: 'https://my.local-ai.example.com:8443/v1' };
    const make = (extra) => createChatHarness(dir, { config: base, ...extra });
    const input = (test) => ({ v: 1, test, system: 'You are a helpful music assistant, answer briefly.', messages: [] });
    const run = (test, specs, extra) => { const h = make(extra); h.enqueue(...(specs || [])); return h.execute(input(test)); };
    const hang = { status: 200, hang: true };
    const names = (r) => r.output;

    // TextEncoder is undefined (and the rest of Node scope)
    let r = run('globals');
    assert.deepStrictEqual([r.output.te, r.output.buf, r.output.req, r.output.proc, r.output.st, r.output.url, r.output.emit],
      ['undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'function']);
    assert.strictEqual(r.output.helper, 'helped');
    assert.strictEqual(r.output.sha, 'undefined');
    assert.strictEqual(r.output.evalName, 'EvalError');
    assert.strictEqual(r.output.fnName, 'EvalError');
    assert.strictEqual(r.output.after - r.output.d, 1500, 'Date follows the injected clock');

    // readLine splits \n, \r\n and \r
    r = run('lines', [{ chunks: ['a\nb\r', '\nc\rd', '\r\ne'] }]);
    assert.deepStrictEqual(r.output, ['a', 'b', 'c', 'd', 'e']);
    assert.strictEqual(r.streams.notClosed, 0);

    // read after idle throws NetworkError (and the stream is dead afterwards)
    r = run('idle', [{ chunks: [{ text: 'x\n', delayMs: 91000 }] }]);
    assert.deepStrictEqual(names(r), { name: 'NetworkError', after: null });
    r = run('idle', [{ sse: 'data: 1\n\n', hang: true }], { idleSec: 5 });
    assert.strictEqual(r.status, 'ok');

    // dead stream holds its slot until close
    r = run('dead', [hang, hang, hang]);
    assert.deepStrictEqual(r.output, { n1: 'NetworkError', n3: 'TooManyStreamsError', n4: null });
    assert.strictEqual(r.streams.notClosed, 2, 'the two surviving streams were never closed');

    // third open stream throws
    r = run('third', [hang, hang]);
    assert.strictEqual(r.output.c, 'TooManyStreamsError');
    assert.strictEqual(r.sends, 2);

    // eleventh send throws
    r = run('sends', Array.from({ length: 10 }, () => ({ body: '{}' })));
    assert.deepStrictEqual(r.output.slice(9), [null, 'TooManyRequestsError']);
    assert.strictEqual(r.sends, 10);

    // body over cap throws (measured in bytes, outside the context)
    r = run('body');
    assert.deepStrictEqual(r.output, { ascii: 'InvalidRequestError', multi: 'InvalidRequestError' });
    assert.strictEqual(r.sends, 0);

    // emit with a lone surrogate throws TypeError; oversize RangeError; rate reported
    r = run('emit');
    assert.deepStrictEqual(r.output, { lone: 'TypeError', big: 'RangeError' });
    assert.strictEqual(r.emitStats.count, 60);
    assert.strictEqual(r.emitStats.rateWaits, 10, 'burst of 50, then paced');
    assert.ok(r.violations.every((v) => v.kind !== 'key-in-emit'));

    // http URL refused (plus host list, IP, userinfo, wildcard, user url)
    r = run('urls', [{ body: '{}' }, { body: '{}' }, { body: '{}' }]);
    assert.deepStrictEqual(r.output, {
      http: 'BlockedHostError', other: 'BlockedHostError', ip: 'BlockedHostError',
      userinfo: 'BlockedHostError', wild: null, user: null,
      localhost: 'BlockedHostError', port: 'BlockedHostError', broken: 'InvalidRequestError',
      port0: 'BlockedHostError', portBig: 'BlockedHostError', noSlashes: 'InvalidRequestError',
      numLabel: 'BlockedHostError', corp: 'BlockedHostError',
    });
    assert.ok(r.violations.some((v) => v.kind === 'url' && v.detail === 'not https'));

    // key in a URL query fails the check (and in a stray header or the body); auth header is fine
    r = run('keyquery', [{ body: '{}' }]);
    assert.deepStrictEqual(r.output, { query: 'InvalidRequestError', header: 'InvalidRequestError', body: 'InvalidRequestError', ok: null });
    assert.deepStrictEqual(r.violations.map((v) => v.kind).sort(), ['key-in-body', 'key-in-header', 'key-in-url']);
    assert.strictEqual(r.sends, 1, 'leaking requests are never sent');
    assert.ok(!JSON.stringify(r).includes(KEY), 'the result never holds the key');
    r = run('keyquery', [{ body: '{}' }], { authHeader: 'x-goog-api-key' });
    assert.strictEqual(r.violations.filter((v) => v.kind === 'key-in-header').length, 2, 'only the configured header may carry the key');

    // error / console scan: key prefix in errors and console
    r = run('leak-error');
    assert.deepStrictEqual(r.violations.map((v) => v.kind).sort(), ['key-in-console', 'key-in-error']);
    r = run('text', [{ status: 429, headers: { 'Retry-After': '7' }, body: { error: 'slow' } }]);
    assert.deepStrictEqual(r.output, { status: 429, ra: '7', json: { error: 'slow' } });
    assert.strictEqual(r.requests[0].headers.authorization, undefined);

    // thrown / invalid returns
    r = run('throws');
    assert.strictEqual(r.status, 'scriptError');
    assert.strictEqual(r.jsError.name, 'TypeError');
    r = run('noresp');
    assert.strictEqual(r.error.message, 'execute must return Response.success or Response.error');
    r = run('ai');
    assert.deepStrictEqual(r.contractProblems, []);
    const bad = contractProblems({ status: 'ok', emits: [], output: { finish: 'tool_calls', text: '', toolCalls: [] } });
    assert.deepStrictEqual(bad, ['finish tool_calls without toolCalls']);
    assert.deepStrictEqual(sse(['{"a":1}', '[DONE]']), 'data: {"a":1}\n\ndata: [DONE]\n\n');
    console.log('ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { createChatHarness, sse, contractProblems, judgeUrl, LIMITS, makeFixtureTransport };

if (require.main === module) {
  if (process.argv.includes('--self-test')) {
    try { selfTest(); } catch (e) { console.error('FAIL: ' + (e && e.stack || e)); process.exit(1); }
  } else {
    console.log('usage: node tools/chat_harness.js --self-test  (the module is required by check_*_chat.js)');
  }
}
