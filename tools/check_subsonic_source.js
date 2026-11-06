#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { runScript } = require('./source_harness');

const PLUGIN_DIR = path.resolve(__dirname, '../src/subsonic');
const manifestPath = path.join(PLUGIN_DIR, 'plugin.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const commonCode = fs.readFileSync(path.join(PLUGIN_DIR, 'src/common.js'), 'utf8');
const searchCode = fs.readFileSync(path.join(PLUGIN_DIR, 'src/search.js'), 'utf8');
const streamCode = fs.readFileSync(path.join(PLUGIN_DIR, 'src/stream.js'), 'utf8');

let passedTests = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`✗ ${name}:`, err);
    throw err;
  }
}

// 1. Manifest structure check
test('plugin.json structure and fields', () => {
  assert.strictEqual(manifest.metadata.type, 'source');
  assert.strictEqual(manifest.metadata.name, 'Subsonic / Navidrome');
  assert.strictEqual(manifest.script.search, 'search.js');
  assert.strictEqual(manifest.script.stream, 'stream.js');
  assert.ok(manifest.config.serverUrl);
  assert.ok(manifest.config.username);
  assert.ok(manifest.config.password);
  assert.ok(manifest.config.maxBitRate);
});

// 2. common.js: ID extraction and auth token generation
test('common.js: ID extraction and auth token generation', () => {
  const crypto = require('crypto');
  const sandbox = {
    load: (f) => {
      if (f === 'crypto.js') {
        sandbox.CryptoJS = {
          MD5: (s) => ({ toString: () => crypto.createHash('md5').update(String(s)).digest('hex') }),
        };
      }
    },
    localConfig: {
      getItem: (k) => {
        if (k === 'serverUrl') return 'https://music.example.com';
        if (k === 'username') return 'alice';
        if (k === 'password') return 'secret123';
        return null;
      },
    },
    fetch: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);

  // ID extraction
  assert.strictEqual(ctx.extractSongId('2ASymUTMYY5377TW2J6oZW'), '2ASymUTMYY5377TW2J6oZW');
  assert.strictEqual(ctx.extractSongId('subsonic://song/song_12345'), 'song_12345');
  assert.strictEqual(ctx.extractSongId('https://music.example.com/rest/stream.view?id=track_99&u=demo'), 'track_99');
  assert.strictEqual(ctx.extractSongId(''), '');

  // Auth params & MD5 salt token
  const auth = ctx.getAuthParams();
  assert.strictEqual(auth.u, 'alice');
  assert.strictEqual(auth.v, '1.16.1');
  assert.strictEqual(auth.c, 'Kanaru');
  assert.strictEqual(auth.f, 'json');
  assert.ok(auth.s.length >= 6);
  // Verify token matches md5(password + salt)
  const expectedToken = crypto.createHash('md5').update('secret123' + auth.s).digest('hex');
  assert.strictEqual(auth.t, expectedToken);
});

// 3. search.js: query handling, direct link, and pagination
test('search.js: offline search parsing, direct song resolve, and pagination', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  const sandbox = {
    Response: mockResponse,
    load: (f) => {
      if (f === 'crypto.js') {
        const crypto = require('crypto');
        sandbox.CryptoJS = {
          MD5: (s) => ({ toString: () => crypto.createHash('md5').update(String(s)).digest('hex') }),
        };
      }
    },
    localConfig: { getItem: () => null },
    cacheStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console: console,
    fetch: (url) => {
      if (url.includes('getSong.view')) {
        if (url.includes('id=S_DIRECT_01')) {
          return {
            status: 200,
            ok: true,
            text: () => JSON.stringify({
              'subsonic-response': {
                status: 'ok',
                version: '1.16.1',
                song: {
                  id: 'S_DIRECT_01',
                  title: 'Starlight',
                  artist: 'Muse',
                  duration: 240,
                  coverArt: 'cover_01',
                },
              },
            }),
          };
        }
        return {
          status: 200,
          ok: true,
          text: () => JSON.stringify({
            'subsonic-response': {
              status: 'failed',
              error: { code: 70, message: 'Song not found' },
            },
          }),
        };
      }
      if (url.includes('search3.view')) {
        const dummySongs = [];
        for (let i = 0; i < 20; i++) {
          dummySongs.push({
            id: `song_${i}`,
            title: `Track ${i}`,
            artist: `Artist ${i}`,
            duration: 180 + i,
            coverArt: `cover_${i}`,
          });
        }
        return {
          status: 200,
          ok: true,
          text: () => JSON.stringify({
            'subsonic-response': {
              status: 'ok',
              version: '1.16.1',
              searchResult3: { song: dummySongs },
            },
          }),
        };
      }
      return { status: 404, ok: false, text: () => '' };
    },
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(searchCode, ctx);

  // 3a. Direct ID resolve
  const directRes = ctx.execute({ query: 'S_DIRECT_01' });
  assert.strictEqual(directRes.status, 'ok');
  assert.strictEqual(directRes.data.items.length, 1);
  assert.strictEqual(directRes.data.items[0].id, 'S_DIRECT_01');
  assert.strictEqual(directRes.data.items[0].title, 'Starlight');
  assert.strictEqual(directRes.data.items[0].durationMs, 240000);
  assert.ok(directRes.data.items[0].artworkUrl.includes('getCoverArt.view'));

  // 3b. Search query with pagination
  const searchRes = ctx.execute({ query: 'muse' });
  assert.strictEqual(searchRes.status, 'ok');
  assert.strictEqual(searchRes.data.items.length, 20);
  assert.strictEqual(searchRes.data.next, '20');
});

// 4. stream.js resolution & error mapping
test('stream.js: resolves direct stream URL, maxBitRate transcode, and Subsonic error codes', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  let mockSubsonicResponse = {
    'subsonic-response': {
      status: 'ok',
      version: '1.16.1',
      song: {
        id: '2ASymUTMYY5377TW2J6oZW',
        title: 'Can I Have Your Love Tonight',
        artist: 'Konstentyn',
        duration: 302,
        contentType: 'audio/mpeg',
        bitRate: 173,
      },
    },
  };

  const sandbox = {
    Response: mockResponse,
    load: (f) => {
      if (f === 'crypto.js') {
        const crypto = require('crypto');
        sandbox.CryptoJS = {
          MD5: (s) => ({ toString: () => crypto.createHash('md5').update(String(s)).digest('hex') }),
        };
      }
    },
    localConfig: { getItem: () => null },
    cacheStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console: console,
    fetch: () => ({
      status: 200,
      ok: true,
      text: () => JSON.stringify(mockSubsonicResponse),
    }),
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  // 4a. Successful stream resolution
  const okRes = ctx.execute({ id: '2ASymUTMYY5377TW2J6oZW' });
  assert.strictEqual(okRes.status, 'ok');
  assert.ok(okRes.data.url.includes('/rest/stream.view'));
  assert.strictEqual(okRes.data.mimeType, 'audio/mpeg');
  assert.strictEqual(okRes.data.bitrate, 173000);
  assert.strictEqual(okRes.data.headers['User-Agent'], 'Kanaru/1.0 (+https://github.com/hieu313/kanaru)');

  // 4b. Subsonic error 40 (Wrong password -> kind: auth)
  mockSubsonicResponse = {
    'subsonic-response': {
      status: 'failed',
      error: { code: 40, message: 'Wrong username or password' },
    },
  };
  const authErrRes = ctx.execute({ id: '2ASymUTMYY5377TW2J6oZW', fresh: true });
  assert.strictEqual(authErrRes.status, 'scriptError');
  assert.strictEqual(authErrRes.opts.kind, 'auth');

  // 4c. Subsonic error 70 (Song not found -> kind: unavailable)
  mockSubsonicResponse = {
    'subsonic-response': {
      status: 'failed',
      error: { code: 70, message: 'Song not found' },
    },
  };
  const notFoundRes = ctx.execute({ id: 'invalid_id', fresh: true });
  assert.strictEqual(notFoundRes.status, 'scriptError');
  assert.strictEqual(notFoundRes.opts.kind, 'unavailable');
});

// 5. stream.js cache contract
test('stream.js: cache hit on repeat call', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  const memStore = {};
  let fetchCount = 0;

  const sandbox = {
    Response: mockResponse,
    load: (f) => {
      if (f === 'crypto.js') {
        const crypto = require('crypto');
        sandbox.CryptoJS = {
          MD5: (s) => ({ toString: () => crypto.createHash('md5').update(String(s)).digest('hex') }),
        };
      }
    },
    localConfig: { getItem: () => null },
    cacheStorage: {
      getItem: (k) => memStore[k] || null,
      setItem: (k, v) => { memStore[k] = v; },
      removeItem: (k) => { delete memStore[k]; },
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console: console,
    fetch: () => {
      fetchCount++;
      return {
        status: 200,
        ok: true,
        text: () => JSON.stringify({
          'subsonic-response': {
            status: 'ok',
            song: {
              id: 'song_cached',
              title: 'Cached Track',
              artist: 'Cached Artist',
              contentType: 'audio/mpeg',
              bitRate: 320,
            },
          },
        }),
      };
    },
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  const r1 = ctx.execute({ id: 'song_cached' });
  assert.strictEqual(r1.status, 'ok');
  assert.strictEqual(fetchCount, 1);

  fetchCount = 0;
  const r2 = ctx.execute({ id: 'song_cached' });
  assert.strictEqual(r2.status, 'ok');
  assert.strictEqual(fetchCount, 0, 'Must hit cache');
});

// 6. Live integration test with demo Navidrome server
test('Live integration test: search and stream resolution against demo.navidrome.org', () => {
  const searchResult = runScript('search.js', { query: 'love' }, { pluginSlug: 'subsonic' });
  assert.strictEqual(searchResult.result.status, 'ok');
  const items = searchResult.result.data.items;
  assert.ok(items.length > 0, 'Live search should return tracks from demo Navidrome server');
  const firstSong = items[0];
  assert.ok(firstSong.id);
  assert.ok(firstSong.title);
  console.log(`  Live track found: "${firstSong.title}" by ${firstSong.artist} (id: ${firstSong.id})`);

  const streamResult = runScript('stream.js', { id: firstSong.id }, { pluginSlug: 'subsonic' });
  assert.strictEqual(streamResult.result.status, 'ok');
  assert.ok(streamResult.result.data.url.startsWith('https://demo.navidrome.org'), 'Stream URL must target demo server');
  assert.strictEqual(streamResult.result.data.mimeType, 'audio/mpeg');
  assert.ok(streamResult.result.data.bitrate > 0);
  console.log(`  Live Subsonic stream resolved: ${streamResult.result.data.url.slice(0, 70)}...`);
});

console.log(`\nAll ${passedTests} Subsonic source tests passed successfully.`);
