// Live runner for `ai-chat` plugins: runs a scripted 3-turn conversation with a fake
// `search_library` tool against the real provider, through the same QuickJS-like
// harness as the offline checks (tools/chat_harness.js), with REAL streaming over
// node `https`.
//
//   node tools/run_chat_live.js --help
//
// Safety: keys come from environment variables only (never argv, never files).
// Nothing is printed except codes, HTTP status, finish reasons, tool-call names,
// blob / input byte sizes, counts and the longest silence between stream chunks.
// Request headers, URLs with queries, request bodies and provider bodies are never
// printed. Requests that would put a key outside the auth header are refused by the
// harness before anything is sent.
//
// How it works: each plugin run happens in a worker thread (the plugin is
// synchronous). The worker's transport blocks on Atomics.wait while the main thread
// does the https call and answers over a MessagePort. Each assistant message's
// `provider` blob is carried forward in the next turns, as the app does.
const { Worker, isMainThread, parentPort, workerData, MessageChannel, receiveMessageOnPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');

const USAGE = `usage: node tools/run_chat_live.js --plugin <dir> --model <id> --key-env <VAR>[,<VAR2>...] [options]

  --plugin <dir>        plugin folder (e.g. src/ai-chat/gemini-chat)
  --model <id>          model id passed in input.model (and config.model)
  --key-env <VARS>      env var name(s) holding the key(s); a value may hold several keys
                        separated by comma or newline. Names only: the value is never printed.
  --preset <name>       config.preset (OpenAI-compatible providers: openai, deepseek, ...)
  --config k=v          extra config entry (repeatable); JSON values allowed, e.g. baseUrl=https://...
  --auth-header <name>  the one header allowed to carry the key (default: authorization;
                        use x-goog-api-key for Gemini)
  --turns <1-3>         user turns to run (default 3)
  --idle-sec <1-90>     stream read idle timeout (default 90)
  --help                this text

Needs real keys and spends quota: it is not part of the offline checks.`;

const CANNED = [
  { id: 'trk_101', title: 'Lac Troi', artist: 'Son Tung M-TP', album: 'm-tp M-TP', durationSec: 272 },
  { id: 'trk_102', title: 'Chung Ta Cua Hien Tai', artist: 'Son Tung M-TP', album: 'Single', durationSec: 301 },
  { id: 'trk_103', title: 'Hay Trao Cho Anh', artist: 'Son Tung M-TP', album: 'Single', durationSec: 245 },
];
const TOOLS = [{
  name: 'search_library',
  description: 'Search the user\'s music library by text. Returns matching tracks.',
  parameters: { type: 'object', properties: { query: { type: 'string', description: 'Text to search for' } }, required: ['query'] },
}];
const PROMPTS = [
  'Use the search_library tool to find songs by Son Tung, then tell me the title of the first result.',
  'From the results you already have, which album is the first song on? Do not search again.',
  'Now use search_library once more for "ballad" and compare it with the first search in one sentence.',
];
const SYSTEM = 'You are the assistant of a music player. Use the provided tools when you need library data. Answer briefly.';

// ------------------------------------------------------------------ worker side
function workerMain() {
  const { createChatHarness } = require('./chat_harness');
  const { pluginDir, options, input, sab, port } = workerData;
  const i32 = new Int32Array(sab);
  const waitMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

  function rpc(msg, timeoutMs) {
    Atomics.store(i32, 0, 0);
    port.postMessage(msg);
    if (Atomics.wait(i32, 0, 0, timeoutMs) === 'timed-out') throw { name: 'NetworkError', message: 'transport timeout' };
    const got = receiveMessageOnPort(port);
    return got ? got.message : { error: { name: 'NetworkError', message: 'no reply' } };
  }
  const chunkGaps = { max: 0 };
  const lastChunk = new Map();
  const transport = {
    open(req) {
      const r = rpc({ op: 'open', req }, 330000);
      if (r.error) throw r.error;
      lastChunk.set(r.id, Date.now());
      return r;
    },
    read(id, idleMs) {
      const r = rpc({ op: 'read', id, idleMs }, idleMs + 10000);
      if (r.error) throw r.error;
      if (r.idle) throw { name: 'NetworkError', message: 'stream idle timeout' };
      if (r.end) return null;
      const now = Date.now();
      chunkGaps.max = Math.max(chunkGaps.max, now - (lastChunk.get(id) || now));
      lastChunk.set(id, now);
      return r.chunk;
    },
    close(id) { rpc({ op: 'close', id }, 10000); },
  };
  const h = createChatHarness(pluginDir, {
    config: options.config, authHeader: options.authHeader, idleSec: options.idleSec,
    keys: options.keys, scanEmitInput: false, transport,
    clock: { now: () => Date.now(), advance: () => {} }, sleep: waitMs,
  });
  const result = h.execute(input);
  const slim = { ...result, requests: result.requests.map((q) => ({ n: q.n, status: q.status, error: q.error, bodyBytes: q.bodyBytes })),
    emits: undefined, emitCount: result.emits.length, chunkGapMs: chunkGaps.max };
  parentPort.postMessage({ type: 'result', result: slim });
}

// ------------------------------------------------------------------- main side
function parseArgs(argv) {
  const a = { config: {}, keyEnv: [], turns: 3, idleSec: 90, authHeader: 'authorization' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error('missing value for ' + k); return argv[++i]; };
    if (k === '--help' || k === '-h') a.help = true;
    else if (k === '--plugin') a.plugin = val();
    else if (k === '--model') a.model = val();
    else if (k === '--key-env') a.keyEnv = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--preset') a.config.preset = val();
    else if (k === '--auth-header') a.authHeader = val().toLowerCase();
    else if (k === '--turns') a.turns = Math.min(3, Math.max(1, Number(val()) || 3));
    else if (k === '--idle-sec') a.idleSec = Math.min(90, Math.max(1, Number(val()) || 90));
    else if (k === '--config') {
      const kv = val(); const eq = kv.indexOf('=');
      if (eq < 1) throw new Error('--config expects key=value');
      let v = kv.slice(eq + 1);
      try { v = JSON.parse(v); } catch (e) { /* plain string */ }
      a.config[kv.slice(0, eq)] = v;
    } else throw new Error('unknown argument ' + k);
  }
  return a;
}

/** Serves the worker's transport calls with real https; answers on the port. */
function startTransportServer(port, sab) {
  const https = require('https');
  const { StringDecoder } = require('string_decoder');
  const i32 = new Int32Array(sab);
  const streams = new Map();
  let nextId = 1;
  let lastStart = 0;
  const reply = (msg) => { port.postMessage(msg); Atomics.store(i32, 0, 1); Atomics.notify(i32, 0); };

  function open(req) {
    const wait = Math.max(0, lastStart + 100 - Date.now()); // hosts: requests start >= 100 ms apart
    setTimeout(() => {
      lastStart = Date.now();
      const st = { queue: [], ended: false, error: null, waiter: null, req: null, res: null };
      const wake = () => { const w = st.waiter; if (w) { st.waiter = null; clearTimeout(w.timer); w.run(); } };
      let answered = false;
      const fail = (err) => {
        st.error = { name: 'NetworkError', message: 'network error ' + (err && err.code ? err.code : '') };
        if (!answered) { answered = true; reply({ error: st.error }); } else wake();
      };
      let url;
      try { url = new URL(req.url); } catch (e) { return reply({ error: { name: 'InvalidRequestError', message: 'bad url' } }); }
      const headers = { ...req.headers, 'accept-encoding': 'identity' };
      if (req.body !== undefined) headers['content-length'] = String(Buffer.byteLength(req.body));
      const r = https.request(url, { method: req.method, headers }, (res) => {
        const decoder = new StringDecoder('utf8');
        st.res = res;
        res.on('data', (b) => { const t = decoder.write(b); if (t) st.queue.push(t); wake(); });
        res.on('end', () => { const t = decoder.end(); if (t) st.queue.push(t); st.ended = true; wake(); });
        res.on('error', fail);
        const id = nextId++;
        streams.set(id, st);
        const flat = {};
        for (const [k, v] of Object.entries(res.headers)) flat[k] = Array.isArray(v) ? v.join(', ') : String(v);
        answered = true;
        reply({ id, status: res.statusCode, headers: flat });
      });
      st.req = r;
      r.setTimeout(Math.min(300000, req.timeoutMs > 0 ? req.timeoutMs : 300000), () => r.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
      r.on('error', fail);
      if (req.body !== undefined) r.write(req.body);
      r.end();
    }, wait);
  }

  function read(msg) {
    const st = streams.get(msg.id);
    if (!st) return reply({ end: true });
    const answer = () => {
      if (st.queue.length) return reply({ chunk: st.queue.shift() });
      if (st.error) return reply({ error: st.error });
      if (st.ended) return reply({ end: true });
      return false;
    };
    if (answer() !== false) return undefined;
    st.waiter = {
      run: answer,
      timer: setTimeout(() => { st.waiter = null; reply({ idle: true }); }, msg.idleMs),
    };
    return undefined;
  }

  port.on('message', (msg) => {
    if (msg.op === 'open') open(msg.req);
    else if (msg.op === 'read') read(msg);
    else if (msg.op === 'close') {
      const st = streams.get(msg.id);
      if (st && st.res) st.res.destroy();
      streams.delete(msg.id);
      reply({ ok: true });
    }
  });
  return () => port.close();
}

function runOnce(pluginDir, options, input) {
  return new Promise((resolve, reject) => {
    const sab = new SharedArrayBuffer(4);
    const { port1, port2 } = new MessageChannel();
    const stop = startTransportServer(port1, sab);
    const worker = new Worker(__filename, { workerData: { pluginDir, options, input, sab, port: port2 }, transferList: [port2] });
    worker.once('message', (m) => { if (m.type === 'result') resolve(m.result); });
    worker.once('error', (e) => { stop(); reject(new Error('worker failed: ' + (e && e.name))); });
    worker.once('exit', () => stop());
  });
}

const kib = (n) => (n / 1024).toFixed(1) + ' KiB';

function describe(label, r, inputBytes) {
  const o = r.output;
  const parts = [label, 'status ' + r.status];
  if (o) {
    parts.push('finish ' + o.finish);
    parts.push('tools [' + (o.toolCalls || []).map((c) => String(c.name).slice(0, 64)).join(',') + ']');
    parts.push('provider ' + (o.provider === undefined ? 'none' : kib(Buffer.byteLength(JSON.stringify(o.provider)))));
    if (o.usage) parts.push('usage ' + o.usage.input + '/' + o.usage.output);
  }
  if (r.error) {
    const code = /^ai:[a-z_]+$/.test(r.error.message) ? r.error.message : '(non-code message, ' + r.error.message.length + ' chars)';
    parts.push('error ' + code + ' kind ' + r.error.kind + (r.error.retryAfterSec !== undefined ? ' retryAfter ' + r.error.retryAfterSec + 's' : ''));
  }
  parts.push('input ' + kib(inputBytes), 'emits ' + r.emitCount, 'http [' + r.requests.map((q) => q.status || q.error || '?').join(',') + ']',
    'longest silence ' + Math.max(r.maxSilenceMs, r.chunkGapMs) + ' ms', 'streams unclosed ' + r.streams.notClosed);
  console.log(parts.join(' | '));
  for (const v of r.violations) console.log('  VIOLATION ' + v.kind + ' @' + v.where + (v.detail ? ' (' + v.detail + ')' : ''));
  for (const p of r.contractProblems) console.log('  CONTRACT ' + p);
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message + '\n\n' + USAGE); process.exit(2); }
  if (args.help) { console.log(USAGE); return; }
  if (!args.plugin || !args.model || args.keyEnv.length === 0) { console.error(USAGE); process.exit(2); }
  const pluginDir = path.resolve(args.plugin);
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8'));
  const keys = [];
  for (const name of args.keyEnv) {
    const v = process.env[name];
    if (!v) { console.error('env var ' + name + ' is empty or not set'); process.exit(2); }
    keys.push(...v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean));
  }
  const keyField = manifest.chat && manifest.chat.keyField;
  const config = { ...args.config, model: args.model };
  if (keyField) config[keyField] = (manifest.config && manifest.config[keyField] && manifest.config[keyField].mode === 'list') ? keys : keys[0];
  const options = { config, keys, authHeader: args.authHeader, idleSec: args.idleSec };

  const boundary = 'k' + require('crypto').randomBytes(5).toString('hex');
  const messages = [];
  let blobTotal = 0;
  console.log('plugin ' + path.basename(pluginDir) + ' | model ' + args.model + ' | keys ' + keys.length + ' | turns ' + args.turns);
  for (let turn = 1; turn <= args.turns; turn++) {
    messages.push({ role: 'user', parts: [{ type: 'text', text: PROMPTS[turn - 1] }] });
    for (let round = 1; round <= 3; round++) {
      const input = { v: 1, model: args.model, system: SYSTEM, boundary, messages, tools: TOOLS,
        toolChoice: round >= 3 ? 'none' : 'auto', options: { maxOutputTokens: null } };
      const inputBytes = Buffer.byteLength(JSON.stringify(input));
      let r;
      try { r = await runOnce(pluginDir, options, input); } catch (e) { console.log('turn ' + turn + ' round ' + round + ' | harness failure: ' + e.message); process.exit(1); }
      describe('turn ' + turn + ' round ' + round, r, inputBytes);
      if (r.status !== 'ok') process.exit(1);
      const o = r.output;
      const assistant = { role: 'assistant', parts: [] };
      if (o.text) assistant.parts.push({ type: 'text', text: o.text });
      const calls = (o.toolCalls || []).map((c, n) => ({
        type: 'tool_call', id: 't' + turn + '-r' + round + '-' + n, name: String(c.name).slice(0, 64), args: c.args,
        ...(typeof c.providerId === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(c.providerId) ? { providerId: c.providerId } : {}),
      }));
      assistant.parts.push(...calls);
      if (o.provider !== undefined) { assistant.provider = o.provider; blobTotal += Buffer.byteLength(JSON.stringify(o.provider)); }
      messages.push(assistant);
      if (o.finish !== 'tool_calls') break;
      messages.push({ role: 'tool', parts: calls.map((c) => {
        const ok = c.name === 'search_library' && c.args && typeof c.args === 'object' && typeof c.args.query === 'string';
        return { type: 'tool_result', id: c.id, ...(c.providerId ? { providerId: c.providerId } : {}), name: c.name, isError: !ok,
          content: [{ type: 'text', text: ok ? JSON.stringify(CANNED) : 'error: unknown tool or bad arguments' }] };
      }) });
    }
  }
  console.log('done | provider blobs total ' + kib(blobTotal) + ' | messages ' + messages.length);
}

if (isMainThread) main().catch((e) => { console.error('runner failed: ' + (e && e.name)); process.exit(1); });
else workerMain();
