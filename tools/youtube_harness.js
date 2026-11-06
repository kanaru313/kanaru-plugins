#!/usr/bin/env node
/**
 * youtube_harness.js
 *
 * Runs Kanaru YouTube source plugin scripts (`search.js` or `stream.js`) in Node.js
 * with simulated Kanaru QuickJS host globals and synchronous HTTP fetch via curl.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');
const vm = require('vm');

const DEFAULT_STORAGE_QUOTA = 64 * 1024; // 64 KiB
const DEFAULT_MAX_SENDS = 10;
const DEFAULT_DEADLINE_SEC = 15;
const FORCED_UA_STRING = 'Kanaru/0.1.0 (+https://github.com/hieu313/kanaru)';

class QuotaExceededError extends Error {
  constructor(message = 'QuotaExceededError') {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

class TooManyRequestsError extends Error {
  constructor(message = 'TooManyRequestsError') {
    super(message);
    this.name = 'TooManyRequestsError';
  }
}

class NetworkError extends Error {
  constructor(message = 'NetworkError') {
    super(message);
    this.name = 'NetworkError';
  }
}

function calculateStorageBytes(storageMap) {
  let bytes = 0;
  for (const [k, v] of Object.entries(storageMap)) {
    bytes += Buffer.byteLength(String(k), 'utf8') + Buffer.byteLength(String(v), 'utf8');
  }
  return bytes;
}

function createHostEnvironment(options = {}) {
  const {
    pluginDir = path.join(__dirname, '..', 'src', 'youtube'),
    uaMode = 'plugin', // 'plugin' or 'forced'
    storageQuota = DEFAULT_STORAGE_QUOTA,
    maxSends = DEFAULT_MAX_SENDS,
    deadlineSec = DEFAULT_DEADLINE_SEC,
    initialStorage = {},
    config = {},
  } = options;

  const srcDir = path.join(pluginDir, 'src');
  const startTime = Date.now();
  const deadlineMs = deadlineSec * 1000;

  const metrics = {
    sends: 0,
    bytesReceived: 0,
    startTime,
    endTime: 0,
    durationMs: 0,
    outputBytes: 0,
    storageBytes: 0,
    logs: [],
  };

  // 1. Response host object
  let finalResponse = null;
  const Response = {
    success: (data) => {
      finalResponse = {
        status: 'ok',
        data: data === undefined ? null : data,
      };
      return finalResponse;
    },
    error: (message, opts = {}) => {
      finalResponse = {
        status: 'scriptError',
        errorMessage: String(message),
        errorKind: opts.kind || 'server',
        retryAfterSec: opts.retryAfterSec,
      };
      return finalResponse;
    },
  };

  // 2. Local storage simulation with quota
  const storageMap = { ...initialStorage };

  const localStorage = {
    getItem: (key) => {
      const k = String(key);
      return Object.prototype.hasOwnProperty.call(storageMap, k) ? storageMap[k] : null;
    },
    setItem: (key, val) => {
      const k = String(key);
      const v = String(val);
      const temp = { ...storageMap, [k]: v };
      const neededBytes = calculateStorageBytes(temp);
      if (neededBytes > storageQuota) {
        throw new QuotaExceededError(`Quota exceeded: ${neededBytes} > ${storageQuota} bytes`);
      }
      storageMap[k] = v;
    },
    removeItem: (key) => {
      const k = String(key);
      delete storageMap[k];
    },
    clear: () => {
      for (const k of Object.keys(storageMap)) {
        delete storageMap[k];
      }
    },
  };

  // 3. localConfig
  const localConfig = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(config, key) ? config[key] : null),
  };

  // 4. Console simulation (50 lines max, 500 chars/line)
  const consoleObj = {
    log: (...args) => {
      if (metrics.logs.length < 50) {
        metrics.logs.push(args.map(String).join(' ').slice(0, 500));
      }
    },
    info: (...args) => consoleObj.log(...args),
    warn: (...args) => consoleObj.log(...args),
    error: (...args) => consoleObj.log(...args),
    debug: (...args) => consoleObj.log(...args),
  };

  // 5. Sleep
  const sleep = (ms) => {
    const n = Math.max(0, Number(ms) || 0);
    const end = Date.now() + n;
    while (Date.now() < end) {}
  };

  // 6. Synchronous fetch via curl
  const fetchFn = (url, fetchOptions = {}) => {
    const elapsed = Date.now() - startTime;
    if (elapsed >= deadlineMs) {
      throw new NetworkError(`Execution deadline exceeded (${elapsed} ms >= ${deadlineMs} ms)`);
    }

    if (metrics.sends >= maxSends) {
      throw new TooManyRequestsError(`HTTP send limit exceeded (${metrics.sends} >= ${maxSends})`);
    }

    metrics.sends++;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanaru-yt-'));
    const headerFile = path.join(tmpDir, 'headers.txt');
    const bodyFile = path.join(tmpDir, 'body.bin');
    const remainingSec = Math.max(1, Math.ceil((deadlineMs - elapsed) / 1000));

    try {
      const curlArgs = [
        '-s', '-S',
        '-D', headerFile,
        '-o', bodyFile,
        '-w', '\n%{http_code}\n%{url_effective}',
        '--max-time', String(Math.min(remainingSec, 15)),
      ];

      const method = (fetchOptions.method || 'GET').toUpperCase();
      if (method === 'POST') {
        curlArgs.push('-X', 'POST');
      }

      const inHeaders = fetchOptions.headers || {};
      const outHeaders = {};

      for (const [k, v] of Object.entries(inHeaders)) {
        outHeaders[k.toLowerCase()] = String(v);
      }

      if (uaMode === 'forced') {
        delete outHeaders['user-agent'];
        curlArgs.push('-H', `User-Agent: ${FORCED_UA_STRING}`);
      } else {
        if (!outHeaders['user-agent']) {
          curlArgs.push('-H', `User-Agent: ${FORCED_UA_STRING}`);
        }
      }

      for (const [k, v] of Object.entries(outHeaders)) {
        curlArgs.push('-H', `${k}: ${v}`);
      }

      if (fetchOptions.body !== undefined && fetchOptions.body !== null) {
        const bodyInputFile = path.join(tmpDir, 'input.bin');
        const bodyStr = typeof fetchOptions.body === 'string'
          ? fetchOptions.body
          : JSON.stringify(fetchOptions.body);
        fs.writeFileSync(bodyInputFile, bodyStr);
        curlArgs.push('--data-binary', `@${bodyInputFile}`);
      }

      curlArgs.push(url);

      const curlRes = cp.spawnSync('curl', curlArgs, {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      });

      if (curlRes.error) {
        throw new NetworkError(curlRes.error.message);
      }

      const lines = curlRes.stdout.trim().split('\n');
      const finalUrl = lines.pop() || url;
      const status = parseInt(lines.pop(), 10) || (curlRes.status === 0 ? 200 : 0);

      const rawHeaders = fs.existsSync(headerFile) ? fs.readFileSync(headerFile, 'utf8') : '';
      const bodyBuf = fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile) : Buffer.alloc(0);

      metrics.bytesReceived += bodyBuf.length;

      const parsedHeaders = {};
      for (const hLine of rawHeaders.split(/\r?\n/)) {
        const cIdx = hLine.indexOf(':');
        if (cIdx > 0) {
          const hk = hLine.slice(0, cIdx).trim().toLowerCase();
          const hv = hLine.slice(cIdx + 1).trim();
          parsedHeaders[hk] = parsedHeaders[hk] ? parsedHeaders[hk] + ', ' + hv : hv;
        }
      }

      let cachedText = null;

      const responseObj = {
        status: status,
        ok: status >= 200 && status < 300,
        url: finalUrl,
        headers: parsedHeaders,
        header: (name) => parsedHeaders[String(name).toLowerCase()] ?? null,
        text: () => {
          if (cachedText === null) {
            cachedText = bodyBuf.toString('utf8');
          }
          return cachedText;
        },
        json: () => JSON.parse(responseObj.text()),
      };

      return Object.freeze(responseObj);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  };

  return {
    Response,
    localConfig,
    localStorage,
    storageMap,
    console: consoleObj,
    sleep,
    fetch: fetchFn,
    metrics,
    getFinalResponse: () => finalResponse,
    srcDir,
  };
}

function runPluginScript(scriptName, input, options = {}) {
  const pluginDir = options.pluginDir || path.join(__dirname, '..', 'src', 'youtube');
  const env = createHostEnvironment({ ...options, pluginDir });

  // Loaded tracking
  const loadedFiles = new Set();

  const loadFn = (fileName) => {
    if (loadedFiles.has(fileName)) return;
    loadedFiles.add(fileName);
    const filePath = path.join(env.srcDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${fileName}`);
    }
    const code = fs.readFileSync(filePath, 'utf8');
    vm.runInContext(code, context, { filename: fileName });
  };

  const sandbox = {
    Response: env.Response,
    load: loadFn,
    localConfig: env.localConfig,
    localStorage: env.localStorage,
    console: env.console,
    sleep: env.sleep,
    fetch: env.fetch,
  };

  const context = vm.createContext(sandbox);

  // Load entry file
  const entryFileName = scriptName.endsWith('.js') ? scriptName : `${scriptName}.js`;
  const entryPath = path.join(pluginDir, 'src', entryFileName);
  const entryCode = fs.readFileSync(entryPath, 'utf8');

  let result = null;
  let thrownError = null;

  try {
    vm.runInContext(entryCode, context, { filename: entryFileName });
    if (typeof context.execute !== 'function') {
      throw new Error(`execute function is not defined in ${entryFileName}`);
    }
    result = context.execute(input);
  } catch (err) {
    thrownError = err;
  }

  env.metrics.endTime = Date.now();
  env.metrics.durationMs = env.metrics.endTime - env.metrics.startTime;
  env.metrics.storageBytes = calculateStorageBytes(env.storageMap);

  const finalResponse = env.getFinalResponse() || result;
  if (finalResponse) {
    try {
      env.metrics.outputBytes = Buffer.byteLength(JSON.stringify(finalResponse), 'utf8');
    } catch (e) {}
  }

  return {
    response: finalResponse,
    error: thrownError,
    metrics: env.metrics,
    storage: env.storageMap,
  };
}

// CLI handling
if (require.main === module) {
  const args = process.argv.slice(2);
  let script = 'search';
  let input = { query: 'Waiting For You MONO' };
  let uaMode = 'plugin';
  let storageQuota = DEFAULT_STORAGE_QUOTA;
  let warm = false;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--script=')) {
      script = arg.split('=')[1];
    } else if (arg.startsWith('--ua=')) {
      uaMode = arg.split('=')[1];
    } else if (arg.startsWith('--storage-quota=')) {
      storageQuota = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--input=')) {
      const val = arg.slice('--input='.length);
      try {
        input = JSON.parse(val);
      } catch (e) {
        input = val;
      }
    } else if (arg.startsWith('--query=')) {
      input = { query: arg.slice('--query='.length) };
    } else if (arg.startsWith('--id=')) {
      input = { id: arg.slice('--id='.length) };
    } else if (arg === '--warm') {
      warm = true;
    } else if (arg === '--json') {
      jsonOutput = true;
    }
  }

  // Cold run
  const cold = runPluginScript(script, input, { uaMode, storageQuota });

  let warmResult = null;
  if (warm) {
    warmResult = runPluginScript(script, input, {
      uaMode,
      storageQuota,
      initialStorage: cold.storage,
    });
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ cold, warm: warmResult }, null, 2));
  } else {
    console.log(`\n=== YouTube Harness [${script}.js] ===`);
    console.log(`Mode UA: ${uaMode} | Storage Quota: ${storageQuota} B`);
    console.log(`Input:`, JSON.stringify(input));
    console.log(`\n--- Cold Call ---`);
    console.log(`Status:`, cold.response?.status || (cold.error ? 'THROWN' : 'null'));
    if (cold.error) console.log(`Error:`, cold.error);
    console.log(`Sends:`, cold.metrics.sends);
    console.log(`Duration:`, cold.metrics.durationMs, 'ms');
    console.log(`Bytes Received:`, cold.metrics.bytesReceived, 'B');
    console.log(`Output Size:`, cold.metrics.outputBytes, 'B');
    console.log(`Storage Used:`, cold.metrics.storageBytes, 'B');
    if (cold.response?.status === 'ok') {
      const d = cold.response.data;
      if (d.items) console.log(`Items returned:`, d.items.length, '| Has next:', !!d.next);
      if (d.url) console.log(`Stream URL:`, d.url.slice(0, 80) + '...', '| expiresAt:', d.expiresAt);
    } else if (cold.response?.status === 'scriptError') {
      console.log(`Script Error Message:`, cold.response.errorMessage);
    }

    if (warmResult) {
      console.log(`\n--- Warm Call ---`);
      console.log(`Status:`, warmResult.response?.status || (warmResult.error ? 'THROWN' : 'null'));
      console.log(`Sends:`, warmResult.metrics.sends);
      console.log(`Duration:`, warmResult.metrics.durationMs, 'ms');
      console.log(`Bytes Received:`, warmResult.metrics.bytesReceived, 'B');
      console.log(`Output Size:`, warmResult.metrics.outputBytes, 'B');
      console.log(`Storage Used:`, warmResult.metrics.storageBytes, 'B');
    }
  }
}

module.exports = {
  runPluginScript,
  createHostEnvironment,
  QuotaExceededError,
  TooManyRequestsError,
  NetworkError,
};
