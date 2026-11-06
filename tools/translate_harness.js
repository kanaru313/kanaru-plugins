// Runs a translate plugin's `execute(input)` in Node with the Kanaru host
// globals stubbed: Response, load (reads src/<name>.js into the same scope),
// localConfig, console and a fetch you pass in. Kanaru's own runtime is
// QuickJS; this only approximates it (no limits, no host allowlist).
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');

const Response = {
  success: (data) => ({ ok: true, data: data === undefined ? null : data }),
  error: (message, options) => {
    const res = {
      ok: false,
      message: String(message),
      error: String(message),
      kind: 'server',
      ...(options || {}),
    };
    if (options && typeof options === 'object') {
      if (['rateLimited', 'invalidResponse', 'server', 'auth', 'quota'].includes(options.kind)) {
        res.kind = options.kind;
      }
      if (typeof options.retryAfterSec === 'number' && Number.isFinite(options.retryAfterSec) && options.retryAfterSec >= 0) {
        res.retryAfterSec = Math.min(Math.floor(options.retryAfterSec), 4294967295);
      }
    }
    return res;
  },
};

const defaultCryptoJS = {
  MD5: (str) => {
    const h = nodeCrypto.createHash('md5').update(String(str), 'utf8').digest('hex');
    return { toString: () => h };
  },
};

/**
 * Builds the whole plugin as one script (load() calls are inlined, each file
 * once, like the runtime's single global scope) and returns its execute.
 */
function loadPlugin(pluginDir, { fetch, config = {}, logs = [] }) {
  const srcDir = path.join(pluginDir, 'src');
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8'));
  const loaded = new Set();
  const inline = (name) => {
    if (loaded.has(name)) return '';
    loaded.add(name);
    if (name === 'crypto.js') return '';
    const code = fs.readFileSync(path.join(srcDir, name), 'utf8');
    return code.replace(/^\s*load\(['"]([^'"]+)['"]\);?\s*$/gm, (_, dep) => inline(dep));
  };
  const code = inline(manifest.script.translate);
  const localConfig = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(config, key) ? config[key] : null),
  };
  const console = { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')) };
  const sleep = () => {};
  const factory = new Function('Response', 'fetch', 'localConfig', 'console', 'sleep', 'load', 'CryptoJS',
    code + '\nreturn { execute, DEFAULT_SYSTEM_PROMPT: typeof DEFAULT_SYSTEM_PROMPT === "undefined" ? null : DEFAULT_SYSTEM_PROMPT };');
  const mod = factory(Response, fetch, localConfig, console, sleep, () => {}, defaultCryptoJS);
  return {
    ...mod,
    execute: (input) => {
      const res = mod.execute(input);
      // In Rust plugin_runtime (globals.rs), execute(input) returns a branded Response
      // object where res.ok is boolean. If true, Rust unwraps res.data into output_json.
      // We expose res.data as both `data` and `ok` on the top-level result to keep test
      // assertions (`result.ok`) compatible while sub-calls see the real `{ ok: true, data }`.
      if (res && res.ok === true && res.data !== undefined) {
        return {
          ok: res.data,
          data: res.data,
          status: 'ok',
        };
      }
      return res;
    },
  };
}

/** A frozen-ish response object like the host's fetch returns. */
function makeResponse(status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: lower,
    header: (name) => lower[String(name).toLowerCase()] ?? null,
    text: () => text,
    json: () => JSON.parse(text),
  };
}

module.exports = { loadPlugin, makeResponse, Response };
