#!/usr/bin/env node
/**
 * soundcloud_harness.js
 *
 * Runs Kanaru SoundCloud source plugin scripts (`search.js` or `stream.js`) in Node.js
 * with simulated Kanaru QuickJS host globals and synchronous HTTP fetch via curl.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');
const vm = require('vm');

const DEFAULT_STORAGE_QUOTA = 64 * 1024; // 64 KiB
const DEFAULT_CACHE_STORAGE_QUOTA = 1024 * 1024; // 1 MiB
const DEFAULT_MAX_SENDS = 10;
const DEFAULT_DEADLINE_SEC = 15;
const FORCED_UA_STRING = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
    pluginDir = path.join(__dirname, '..', 'src', 'soundcloud'),
    uaMode = 'plugin',
    storageQuota = DEFAULT_STORAGE_QUOTA,
    cacheStorageQuota = DEFAULT_CACHE_STORAGE_QUOTA,
    disableCacheStorage = false,
    maxSends = DEFAULT_MAX_SENDS,
    deadlineSec = DEFAULT_DEADLINE_SEC,
    initialStorage = {},
    initialCacheStorage = {},
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
    cacheStorageBytes: 0,
    logs: [],
  };

  let finalResponse = null;
  const Response = {
    success: (data) => {
      finalResponse = { status: 'ok', data };
      return finalResponse;
    },
    error: (message, opts) => {
      finalResponse = { status: 'scriptError', message: String(message), opts: opts || {} };
      return finalResponse;
    },
  };

  const localConfig = {
    getItem: (key) => {
      const k = String(key);
      if (k in config) return String(config[k]);
      return null;
    },
  };

  const storageMap = { ...initialStorage };
  const localStorage = {
    getItem: (key) => {
      const k = String(key);
      return k in storageMap ? storageMap[k] : null;
    },
    setItem: (key, val) => {
      const k = String(key);
      const v = String(val);
      const oldVal = storageMap[k];
      storageMap[k] = v;
      if (calculateStorageBytes(storageMap) > storageQuota) {
        if (oldVal !== undefined) storageMap[k] = oldVal;
        else delete storageMap[k];
        throw new QuotaExceededError(`localStorage quota of ${storageQuota} bytes exceeded`);
      }
    },
    removeItem: (key) => {
      delete storageMap[String(key)];
    },
    clear: () => {
      for (const k of Object.keys(storageMap)) delete storageMap[k];
    },
  };

  const cacheStorageMap = { ...initialCacheStorage };
  const cacheStorage = disableCacheStorage ? undefined : {
    getItem: (key) => {
      const k = String(key);
      return k in cacheStorageMap ? cacheStorageMap[k] : null;
    },
    setItem: (key, val) => {
      const k = String(key);
      const v = String(val);
      const oldVal = cacheStorageMap[k];
      cacheStorageMap[k] = v;
      if (calculateStorageBytes(cacheStorageMap) > cacheStorageQuota) {
        if (oldVal !== undefined) cacheStorageMap[k] = oldVal;
        else delete cacheStorageMap[k];
        throw new QuotaExceededError(`cacheStorage quota of ${cacheStorageQuota} bytes exceeded`);
      }
    },
    removeItem: (key) => {
      delete cacheStorageMap[String(key)];
    },
    clear: () => {
      for (const k of Object.keys(cacheStorageMap)) delete cacheStorageMap[k];
    },
  };

  const consoleObj = {
    log: (...args) => metrics.logs.push(['log', args.map(String).join(' ')]),
    warn: (...args) => metrics.logs.push(['warn', args.map(String).join(' ')]),
    error: (...args) => metrics.logs.push(['error', args.map(String).join(' ')]),
  };

  const sleep = (ms) => {
    const target = Date.now() + Math.max(0, Number(ms) || 0);
    while (Date.now() < target) {}
  };

  const fetchFn = (url, fetchOptions = {}) => {
    const elapsed = Date.now() - startTime;
    if (elapsed >= deadlineMs) {
      throw new NetworkError(`Execution deadline exceeded (${elapsed} ms >= ${deadlineMs} ms)`);
    }

    if (metrics.sends >= maxSends) {
      throw new TooManyRequestsError(`HTTP send limit exceeded (${metrics.sends} >= ${maxSends})`);
    }

    metrics.sends++;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanaru-sc-'));
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
    cacheStorage,
    cacheStorageMap,
    calculateCacheStorageBytes: () => calculateStorageBytes(cacheStorageMap),
    console: consoleObj,
    sleep,
    fetch: fetchFn,
    metrics,
    getFinalResponse: () => finalResponse,
    srcDir,
  };
}

function runScript(scriptName, input, options = {}) {
  const env = createHostEnvironment(options);
  const scriptPath = path.join(env.srcDir, scriptName);

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }

  const loadedFiles = new Set();
  const loadFn = (fileName) => {
    const targetFile = path.resolve(env.srcDir, fileName);
    if (!targetFile.startsWith(env.srcDir)) {
      throw new Error(`Path traversal denied: ${fileName}`);
    }
    if (loadedFiles.has(targetFile)) return;
    loadedFiles.add(targetFile);

    const code = fs.readFileSync(targetFile, 'utf8');
    vm.runInContext(code, sandbox, { filename: targetFile });
  };

  const sandbox = {
    Response: env.Response,
    localConfig: env.localConfig,
    localStorage: env.localStorage,
    cacheStorage: env.cacheStorage,
    console: env.console,
    sleep: env.sleep,
    fetch: env.fetch,
    load: loadFn,
    setTimeout: undefined,
    setInterval: undefined,
    setImmediate: undefined,
    process: undefined,
    require: undefined,
  };

  vm.createContext(sandbox);

  const mainCode = fs.readFileSync(scriptPath, 'utf8');
  vm.runInContext(mainCode, sandbox, { filename: scriptPath });

  if (typeof sandbox.execute !== 'function') {
    throw new Error(`Script ${scriptName} does not define execute() function`);
  }

  const execRes = sandbox.execute(input);
  const result = execRes || env.getFinalResponse();

  env.metrics.endTime = Date.now();
  env.metrics.durationMs = env.metrics.endTime - env.metrics.startTime;
  env.metrics.storageBytes = calculateStorageBytes(env.storageMap);
  env.metrics.cacheStorageBytes = env.calculateCacheStorageBytes();
  if (result) {
    env.metrics.outputBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  }

  return {
    result,
    metrics: env.metrics,
    storage: env.storageMap,
    cacheStorage: env.cacheStorageMap,
  };
}

module.exports = {
  createHostEnvironment,
  runScript,
  calculateStorageBytes,
  QuotaExceededError,
  TooManyRequestsError,
  NetworkError,
};
