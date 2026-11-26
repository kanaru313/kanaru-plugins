// Provider presets and quirks for the OpenAI-compatible chat plugin.
// One place per preset: base URL, request parameters, and the provider data
// (blob) kept with each assistant message:
//   rc  DeepSeek `reasoning_content` (must go back with tools, in every later request)
//   ec  Gemini (OpenAI endpoint) `extra_content` per tool call (thought signatures)
//   rd  OpenRouter `reasoning_details` per message (not for anthropic/ models)
// A blob is echoed only when this preset produced it (`p`) and only the fields
// the provider sent. Nothing is ever invented (no placeholder signatures).

var PRESETS = {
  openai: { base: 'https://api.openai.com/v1' },
  deepseek: { base: 'https://api.deepseek.com' },
  openrouter: { base: 'https://openrouter.ai/api/v1' },
  groq: { base: 'https://api.groq.com/openai/v1' },
  'gemini-openai': { base: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  custom: { base: null }
};

// Models whose name implies provider-side tools (web search, code execution).
var SERVER_TOOL_MODEL_RES = [
  /(^|[\/:])sonar/,        // Perplexity sonar*, perplexity/sonar-*
  /:online$/,              // OpenRouter web plugin
  /compound/,              // Groq compound (built-in search / code tools)
  /-search-preview/,       // OpenAI search previews
  /-search-api/,           // OpenAI search API models
  /deep-research/          // OpenAI deep research (web search by design)
];

function isServerToolModel(model) {
  var m = String(model).toLowerCase();
  for (var i = 0; i < SERVER_TOOL_MODEL_RES.length; i++) if (SERVER_TOOL_MODEL_RES[i].test(m)) return true;
  return false;
}

// The app's runtime list (address_class.dart); what a name resolves to is judged by the host.
var LOCAL_SUFFIXES = ['.local', '.lan', '.home.arpa', '.internal', '.localdomain', '.localhost'];
var PUBLIC_HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Normalises the custom address (no /chat/completions) and refuses what the host
 * would refuse, before any request: https only, parseable, no user info, no IP
 * literal, no localhost / local name, no query or fragment. null when unusable.
 */
function normalizeCustomBase(value) {
  var v = typeof value === 'string' ? value.replace(/\s+/g, '') : '';
  v = v.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '').replace(/\/+$/, '');
  var m = /^https:\/\/([^\/?#]+)(\/[^?#]*)?$/i.exec(v);
  if (m === null) return null;
  var hp = /^([^:@\[\]]+)(?::(\d{1,5}))?$/.exec(m[1]); // no user info, no [IPv6]
  if (hp === null) return null;
  if (hp[2] !== undefined && (Number(hp[2]) < 1 || Number(hp[2]) > 65535)) return null;
  var host = hp[1].toLowerCase();
  if (!PUBLIC_HOST_RE.test(host)) return null;                    // also single labels such as localhost
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;          // IPv4 literal
  for (var i = 0; i < LOCAL_SUFFIXES.length; i++) {
    var s = LOCAL_SUFFIXES[i];
    if (host.length > s.length && host.slice(host.length - s.length) === s) return null;
  }
  return v;
}

/** The provider for this run, or aiFail('config'). */
function providerFor(config) {
  var preset = typeof config.preset === 'string' ? config.preset : '';
  if (!PRESETS.hasOwnProperty(preset)) aiFail('config');
  var base = PRESETS[preset].base;
  var custom = preset === 'custom';
  if (custom) {
    base = normalizeCustomBase(config.baseUrl);
    if (base === null) aiFail('config');
  }
  return {
    preset: preset,
    custom: custom,
    endpoint: base + '/chat/completions',
    thinkingOn: preset !== 'deepseek' || config.thinking !== 'off',
    echo: function (message, blob, state) { echoBlob(this, message, blob, state); }
  };
}

function isOpenAiReasoning(prov, model) {
  return prov.preset === 'openai' && /^(o\d|gpt-5)/i.test(model);
}

/** Temperature / max tokens / thinking, by preset. `opts.maxTokens` already merged (options wins). */
function applyParams(prov, body, model, opts) {
  var reasoning = isOpenAiReasoning(prov, model);
  var thinkingDeepSeek = prov.preset === 'deepseek' && prov.thinkingOn;
  if (typeof opts.temperature === 'number' && isFinite(opts.temperature) && !reasoning && !thinkingDeepSeek) {
    body.temperature = Math.max(0, Math.min(2, opts.temperature));
  }
  if (typeof opts.maxTokens === 'number' && isFinite(opts.maxTokens) && opts.maxTokens >= 1) {
    body[reasoning ? 'max_completion_tokens' : 'max_tokens'] = Math.floor(opts.maxTokens);
  }
  if (prov.preset === 'deepseek' && !prov.thinkingOn) body.thinking = { type: 'disabled' };
}

/** Adds the provider fields of an earlier assistant turn's blob. */
function echoBlob(prov, message, blob, state) {
  if (blob.p !== prov.preset) return;
  if (typeof blob.rc === 'string' && blob.rc !== '' && prov.thinkingOn) message.reasoning_content = blob.rc;
  if (Array.isArray(blob.rd) && blob.rd.length > 0 && prov.preset === 'openrouter') message.reasoning_details = blob.rd;
  if (isObject(blob.ec) && Array.isArray(message.tool_calls)) {
    for (var i = 0; i < message.tool_calls.length; i++) {
      var extra = blob.ec[String(i)];
      if (isObject(extra)) message.tool_calls[i].extra_content = extra;
    }
  }
}

/** The first `n` UTF-16 units of `s`, never ending inside a surrogate pair. */
function cutReasoning(s, n) {
  if (n > 0 && n < s.length) {
    var c = s.charCodeAt(n - 1);
    if (c >= 0xD800 && c <= 0xDBFF) n--;
  }
  return s.slice(0, n);
}

/** The blob to keep with the new assistant message (<= 256 KiB), or undefined. */
function makeBlob(prov, model, st, extras) {
  var blob = { v: 1, p: prov.preset };
  if (st.rc !== '') blob.rc = st.rc;
  var ec = {}, hasEc = false;
  for (var i = 0; i < extras.length; i++) if (isObject(extras[i])) { ec[String(i)] = extras[i]; hasEc = true; }
  if (hasEc) blob.ec = ec;
  if (st.rd.length > 0 && prov.preset === 'openrouter' && model.toLowerCase().indexOf('anthropic/') !== 0) blob.rd = st.rd;
  var keys = ['rd', 'ec']; // dropped in this order when too large
  for (var k = 0; k < keys.length && utf8Len(JSON.stringify(blob)) > BLOB_LIMIT_BYTES; k++) {
    if (blob.hasOwnProperty(keys[k])) { delete blob[keys[k]]; console.log('chat: provider data dropped (too large)'); }
  }
  // Still too large: keep the start of the reasoning (DeepSeek wants some back; none fails every later turn).
  if (blob.hasOwnProperty('rc') && utf8Len(JSON.stringify(blob)) > BLOB_LIMIT_BYTES) {
    var full = blob.rc, lo = 0, hi = full.length;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      blob.rc = cutReasoning(full, mid);
      if (utf8Len(JSON.stringify(blob)) <= BLOB_LIMIT_BYTES) lo = mid; else hi = mid - 1;
    }
    blob.rc = cutReasoning(full, lo);
    console.log('chat: reasoning truncated (too large)');
    if (blob.rc === '') delete blob.rc;
  }
  if (!blob.hasOwnProperty('rc') && !blob.hasOwnProperty('ec') && !blob.hasOwnProperty('rd')) return undefined;
  return blob;
}
