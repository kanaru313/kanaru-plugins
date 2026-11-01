// Smoke test of Spotify lyrics plugin: `node tools/check_spotify_lyrics.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const cp = require('child_process');

const pluginDir = path.join(__dirname, '..', 'src', 'spotify');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8'));
const commonCode = fs.readFileSync(path.join(pluginDir, 'src', 'common.js'), 'utf8');
const searchCode = fs.readFileSync(path.join(pluginDir, 'src', 'search.js'), 'utf8');
const lyricsCode = fs.readFileSync(path.join(pluginDir, 'src', 'lyrics.js'), 'utf8');

// Load bundled CryptoJS for simulation in test environment
const cryptoJsPath = path.resolve(__dirname, '..', '..', '..', 'rust', 'src', 'plugin_runtime', 'js', 'crypto-js.min.js');
let cryptoJsCode = '';
if (fs.existsSync(cryptoJsPath)) {
  cryptoJsCode = fs.readFileSync(cryptoJsPath, 'utf8');
} else {
  // Fallback to npm package if needed
  try {
    cryptoJsCode = fs.readFileSync(require.resolve('crypto-js/crypto-js.js'), 'utf8');
  } catch (e) {}
}

let n = 0;
function test(name, fn) {
  fn();
  n++;
  console.log(`✓ ${name}`);
}

function assertJsonEqual(actual, expected) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected);
}

// 1. Manifest structure check
test('plugin.json structure and fields', () => {
  assert.strictEqual(manifest.metadata.apiVersion, 1);
  assert.strictEqual(manifest.metadata.type, 'lyrics');
  assert.strictEqual(manifest.metadata.name, 'Spotify');
  assert.strictEqual(typeof manifest.metadata.version, 'number');
  assert.ok(Array.isArray(manifest.metadata.hosts));
  assert.ok(manifest.metadata.hosts.includes('open.spotify.com'));
  assert.ok(manifest.metadata.hosts.includes('api.spotify.com'));
  assert.ok(manifest.metadata.hosts.includes('spclient.wg.spotify.com'));
  assert.strictEqual(manifest.script.search, 'search.js');
  assert.strictEqual(manifest.script.lyrics, 'lyrics.js');
  assert.ok(manifest.config && manifest.config.spDc);
  assert.strictEqual(manifest.config.spDc.format, 'secret');
});

// Helper to create sandbox environment
function createMockEnv(overrides = {}) {
  const localStorageStore = {};
  const localConfigStore = overrides.localConfig || {};

  const localStorage = {
    getItem: (k) => (k in localStorageStore ? localStorageStore[k] : null),
    setItem: (k, v) => { localStorageStore[k] = String(v); },
    removeItem: (k) => { delete localStorageStore[k]; },
    clear: () => { for (const k in localStorageStore) delete localStorageStore[k]; }
  };

  const localConfig = {
    getItem: (k) => (k in localConfigStore ? localConfigStore[k] : null)
  };

  const Response = {
    success: (data) => ({ ok: true, data: data }),
    error: (msg, opts) => ({ ok: false, message: msg, ...(opts || {}) })
  };

  const vm = require('vm');
  const sandbox = {
    load: (name) => {},
    localStorage,
    localConfig,
    Response,
    fetch: overrides.fetch || (() => ({ status: 200, json: () => ({}) })),
    ...overrides.globals
  };

  vm.createContext(sandbox);
  vm.runInContext(cryptoJsCode, sandbox);
  vm.runInContext(commonCode, sandbox);

  const commonExports = {
    deriveSecretKey: sandbox.deriveSecretKey,
    generateTotp: sandbox.generateTotp,
    formatLrcTimestamp: sandbox.formatLrcTimestamp,
    formatSpotifyLyrics: sandbox.formatSpotifyLyrics,
    getSpotifyToken: sandbox.getSpotifyToken,
    BUNDLED_SECRET_DICT: sandbox.BUNDLED_SECRET_DICT
  };

  return { sandbox, commonExports, localStorageStore, localConfigStore };
}

// 2. Unit tests for TOTP generation and LRC formatting
test('TOTP generation and timestamp formatting', () => {
  const { commonExports } = createMockEnv();

  // Test deriveSecretKey
  const asciiCodes = [44, 55, 47, 42, 70, 40, 34, 114, 76, 74, 50, 111, 120, 97, 75, 76, 94, 102, 43, 69, 49, 120, 118, 80, 64, 78];
  const secretKey = commonExports.deriveSecretKey(asciiCodes);
  assert.strictEqual(secretKey, '376136387538459893883312310911992847112448894410210511297108');

  // Test generateTotp
  const serverTimeMs = 1793511565000;
  const totp = commonExports.generateTotp(serverTimeMs, secretKey);
  assert.strictEqual(totp, '713239');

  // Test formatLrcTimestamp
  assert.strictEqual(commonExports.formatLrcTimestamp(13420), '[00:13.42]');
  assert.strictEqual(commonExports.formatLrcTimestamp(125666), '[02:05.66]');
  assert.strictEqual(commonExports.formatLrcTimestamp(0), '[00:00.00]');

  // Test formatSpotifyLyrics (synced)
  const syncedInput = {
    syncType: 'LINE_SYNCED',
    lines: [
      { startTimeMs: '13420', words: 'Yesterday' },
      { startTimeMs: '17250', words: 'All my troubles seemed so far away' }
    ]
  };
  const formattedSynced = commonExports.formatSpotifyLyrics(syncedInput);
  assertJsonEqual(formattedSynced, {
    data: '[00:13.42] Yesterday\n[00:17.25] All my troubles seemed so far away',
    type: 'lrc'
  });

  // Test formatSpotifyLyrics (unsynced)
  const unsyncedInput = {
    syncType: 'UNSYNCED',
    lines: [
      { words: 'Line 1' },
      { words: 'Line 2' }
    ]
  };
  const formattedUnsynced = commonExports.formatSpotifyLyrics(unsyncedInput);
  assertJsonEqual(formattedUnsynced, {
    data: 'Line 1\nLine 2',
    type: 'txt'
  });
});

// 3. Missing sp_dc returns friendly error
test('missing sp_dc handling in search and lyrics', () => {
  const vm = require('vm');
  const { sandbox } = createMockEnv({ localConfig: { spDc: '' } });

  vm.runInContext(searchCode, sandbox);
  const searchRes = sandbox.execute({ text: 'Hello' });
  assert.strictEqual(searchRes.ok, false);
  assert.ok(searchRes.message.includes('sp_dc'));

  vm.runInContext(lyricsCode, sandbox);
  const lyricsRes = sandbox.execute('track_123');
  assert.strictEqual(lyricsRes.ok, false);
  assert.ok(lyricsRes.message.includes('sp_dc'));
});

// 4. search.js candidate mapping
test('search.js maps track results correctly', () => {
  const vm = require('vm');
  const mockTracks = [
    {
      id: 'track1',
      name: 'Yesterday - Remastered 2009',
      artists: [{ name: 'The Beatles' }],
      album: { name: 'Help!' },
      duration_ms: 125666
    },
    {
      id: 'track2',
      name: 'Shape of You',
      artists: [{ name: 'Ed Sheeran' }],
      album: { name: '÷ (Divide)' },
      duration_ms: 233712
    }
  ];

  const fetchMock = (url) => {
    if (url.includes('/api/server-time')) {
      return { status: 200, json: () => ({ serverTime: 1793511565 }) };
    }
    if (url.includes('/api/token')) {
      return {
        status: 200,
        json: () => ({
          accessToken: 'mock_access_token',
          accessTokenExpirationTimestampMs: Date.now() + 3600000,
          isAnonymous: false
        })
      };
    }
    if (url.includes('/v1/search')) {
      return {
        status: 200,
        json: () => ({
          tracks: {
            items: mockTracks
          }
        })
      };
    }
    return { status: 404 };
  };

  const { sandbox } = createMockEnv({
    localConfig: { spDc: 'valid_mock_sp_dc' },
    fetch: fetchMock
  });

  vm.runInContext(searchCode, sandbox);
  const res = sandbox.execute({ title: 'Yesterday', artist: 'The Beatles' });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.data.length, 2);
  assertJsonEqual(res.data[0], {
    id: 'track1',
    title: 'Yesterday - Remastered 2009',
    artist: 'The Beatles',
    album: 'Help!',
    durationMs: 125666
  });
});

// 5. lyrics.js execution (timed, not found)
test('lyrics.js executes and formats color-lyrics response', () => {
  const vm = require('vm');
  const fetchMock = (url) => {
    if (url.includes('/api/server-time')) {
      return { status: 200, json: () => ({ serverTime: 1793511565 }) };
    }
    if (url.includes('/api/token')) {
      return {
        status: 200,
        json: () => ({
          accessToken: 'mock_access_token',
          accessTokenExpirationTimestampMs: Date.now() + 3600000,
          isAnonymous: false
        })
      };
    }
    if (url.includes('/color-lyrics/v2/track/track1')) {
      return {
        status: 200,
        json: () => ({
          lyrics: {
            syncType: 'LINE_SYNCED',
            lines: [
              { startTimeMs: '13420', words: 'Yesterday' },
              { startTimeMs: '17250', words: 'All my troubles seemed so far away' }
            ]
          }
        })
      };
    }
    if (url.includes('/color-lyrics/v2/track/track_404')) {
      return { status: 404 };
    }
    return { status: 500 };
  };

  const { sandbox } = createMockEnv({
    localConfig: { spDc: 'valid_mock_sp_dc' },
    fetch: fetchMock
  });

  vm.runInContext(lyricsCode, sandbox);

  // Case A: Valid lyrics
  const resValid = sandbox.execute('track1');
  assert.strictEqual(resValid.ok, true);
  assertJsonEqual(resValid.data, {
    data: '[00:13.42] Yesterday\n[00:17.25] All my troubles seemed so far away',
    type: 'lrc'
  });

  // Case B: 404 Not Found
  const res404 = sandbox.execute('track_404');
  assert.strictEqual(res404.ok, true);
  assert.strictEqual(res404.data, null);
});

// 6. Live network smoke test for server-time endpoint
function syncCurl(url) {
  const raw = cp.execFileSync('curl', ['-s', '-i', url], { encoding: 'utf8' });
  const parts = raw.split(/\r?\n\r?\n/);
  const statusLine = parts[0].split(/\r?\n/)[0];
  const statusMatch = statusLine.match(/HTTP\/\S+\s+(\d+)/);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
  const body = parts.slice(1).join('\n\n');
  return {
    status,
    json: () => JSON.parse(body)
  };
}

test('live Spotify server-time smoke test', () => {
  const res = syncCurl('https://open.spotify.com/api/server-time');
  assert.strictEqual(res.status, 200);
  const data = res.json();
  assert.ok(typeof data.serverTime === 'number');
  assert.ok(data.serverTime > 1700000000);
});

console.log(`\nAll ${n} tests passed successfully!`);
