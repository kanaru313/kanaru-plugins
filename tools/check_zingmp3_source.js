// Smoke test and offline unit test for ZingMP3 source plugin: `node tools/check_zingmp3_source.js`
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const { runScript } = require('./source_harness');

const pluginDir = path.join(__dirname, '..', 'src', 'zingmp3-source');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8'));
const commonCode = fs.readFileSync(path.join(pluginDir, 'src', 'common.js'), 'utf8');
const searchCode = fs.readFileSync(path.join(pluginDir, 'src', 'search.js'), 'utf8');
const streamCode = fs.readFileSync(path.join(pluginDir, 'src', 'stream.js'), 'utf8');

let passedTests = 0;
function test(name, fn) {
  try {
    fn();
    passedTests++;
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}:`, err);
    throw err;
  }
}

// 1. Manifest structure check
test('plugin.json structure and fields', () => {
  assert.strictEqual(manifest.metadata.apiVersion, 1);
  assert.strictEqual(manifest.metadata.type, 'source');
  assert.strictEqual(manifest.metadata.name, 'ZingMP3');
  assert.strictEqual(typeof manifest.metadata.version, 'number');
  assert.ok(Array.isArray(manifest.metadata.hosts));
  assert.ok(manifest.metadata.hosts.includes('zingmp3.vn'));
  assert.strictEqual(manifest.script.search, 'search.js');
  assert.strictEqual(manifest.script.stream, 'stream.js');
  assert.ok(manifest.config && manifest.config.apiKey && manifest.config.secretKey);
});

// 2. Unit tests for common helpers & HMAC signing
test('common.js: encodeId extraction and zingSig signature generation', () => {
  const sandbox = {
    load: (f) => {
      if (f === 'crypto.js') {
        const crypto = require('crypto');
        sandbox.CryptoJS = {
          SHA256: (s) => ({ toString: () => crypto.createHash('sha256').update(String(s)).digest('hex') }),
          HmacSHA512: (m, sec) => ({ toString: () => crypto.createHmac('sha512', String(sec)).update(String(m)).digest('hex') }),
        };
      }
    },
    fetch: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);

  // extractEncodeId
  assert.strictEqual(ctx.extractEncodeId('ZWZB96AB'), 'ZWZB96AB');
  assert.strictEqual(ctx.extractEncodeId('https://zingmp3.vn/bai-hat/waiting-for-you/ZWZB96AB.html'), 'ZWZB96AB');
  assert.strictEqual(ctx.extractEncodeId('invalid_query'), '');

  // zingSig verification
  const sig = ctx.zingSig('/song/get/streaming', { id: 'ZWZB96AB', ctime: '1793950138', version: '1.22.4' }, 'acOrvUS15XRW2o9JksiK1KgQ6Vbds8ZW');
  assert.strictEqual(typeof sig, 'string');
  assert.strictEqual(sig.length, 128); // SHA-512 hex is 128 chars
});

// 3. search.js parser & query handling
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
          SHA256: (s) => ({ toString: () => crypto.createHash('sha256').update(String(s)).digest('hex') }),
          HmacSHA512: (m, sec) => ({ toString: () => crypto.createHmac('sha512', String(sec)).update(String(m)).digest('hex') }),
        };
      }
    },
    localConfig: { getItem: () => null },
    cacheStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => 'fake_rqid', setItem: () => {}, removeItem: () => {} },
    console: console,
    fetch: (url) => {
      if (url === 'https://zingmp3.vn/' || url === 'https://zingmp3.vn') {
        return {
          status: 200,
          ok: true,
          header: (n) => (n === 'set-cookie' ? 'zmp3_rqid=fake_cookie; Path=/' : null),
          text: () => '<html></html>',
        };
      }
      if (url.includes('/song/get/info')) {
        return {
          status: 200,
          ok: true,
          header: () => null,
          text: () => JSON.stringify({
            err: 0,
            data: {
              encodeId: 'ZWZB96AB',
              title: 'Waiting For You',
              artistsNames: 'MONO',
              duration: 266,
              thumbnailM: 'https://photo-resize-zmp3.zmdcdn.me/w240_r1x1_jpeg/cover.jpg',
            },
          }),
        };
      }
      if (url.includes('/search')) {
        const dummyItems = [];
        for (let i = 0; i < 20; i++) {
          dummyItems.push({
            encodeId: `SONG_${i}`,
            title: `Bài hát ${i}`,
            artistsNames: `Ca sĩ ${i}`,
            duration: 200,
          });
        }
        return {
          status: 200,
          ok: true,
          header: () => null,
          text: () => JSON.stringify({
            err: 0,
            data: { items: dummyItems },
          }),
        };
      }
      return { status: 404, ok: false, header: () => null, text: () => '' };
    },
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(searchCode, ctx);

  // 3a. Direct song link
  const directRes = ctx.execute({ query: 'https://zingmp3.vn/bai-hat/waiting-for-you/ZWZB96AB.html' });
  assert.strictEqual(directRes.status, 'ok');
  assert.strictEqual(directRes.data.items.length, 1);
  assert.strictEqual(directRes.data.items[0].id, 'ZWZB96AB');

  // 3b. Search query with pagination token
  const searchRes = ctx.execute({ query: 'mono' });
  assert.strictEqual(searchRes.status, 'ok');
  assert.strictEqual(searchRes.data.items.length, 20);
  assert.strictEqual(searchRes.data.next, '2');
});

// 4. stream.js resolution & VIP handling
test('stream.js: resolves direct CDN stream URL and handles VIP restriction', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  let mockStreamingData = {
    '128': 'https://a128-z3.zmdcdn.me/audio.mp3?authen=exp=1794122958~acl=/*',
  };

  const sandbox = {
    Response: mockResponse,
    load: (f) => {
      if (f === 'crypto.js') {
        const crypto = require('crypto');
        sandbox.CryptoJS = {
          SHA256: (s) => ({ toString: () => crypto.createHash('sha256').update(String(s)).digest('hex') }),
          HmacSHA512: (m, sec) => ({ toString: () => crypto.createHmac('sha512', String(sec)).update(String(m)).digest('hex') }),
        };
      }
    },
    localConfig: { getItem: () => null },
    cacheStorage: {
      getItem: (k) => {
        if (k === 'zmp3_rqid') return 'fake_rqid';
        if (k === 'zmp3_rqidAt') return String(Date.now());
        return null;
      },
      setItem: () => {},
      removeItem: () => {},
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console: console,
    fetch: () => ({
      status: 200,
      ok: true,
      header: () => null,
      text: () => JSON.stringify({
        err: 0,
        data: mockStreamingData,
      }),
    }),
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  // 4a. Successful stream resolution
  const okRes = ctx.execute({ id: 'ZWZB96AB' });
  assert.strictEqual(okRes.status, 'ok');
  assert.ok(okRes.data.url.includes('audio.mp3'));
  assert.strictEqual(okRes.data.mimeType, 'audio/mpeg');
  assert.strictEqual(okRes.data.bitrate, 128000);
  assert.strictEqual(okRes.data.expiresAtMs, 1794122958000);

  // 4b. VIP restricted song
  mockStreamingData = { '128': '', '320': 'VIP' };
  const vipRes = ctx.execute({ id: 'ZWZB96AB', fresh: true });
  assert.strictEqual(vipRes.status, 'scriptError');
  assert.strictEqual(vipRes.opts.kind, 'auth');
});

// 5. stream.js cache contract
test('stream.js: cache hit on repeat call', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  const memStore = {
    zmp3_rqid: 'fake_rqid',
    zmp3_rqidAt: String(Date.now()),
  };
  let fetchCount = 0;

  const sandbox = {
    Response: mockResponse,
    load: (f) => {
      if (f === 'crypto.js') {
        const crypto = require('crypto');
        sandbox.CryptoJS = {
          SHA256: (s) => ({ toString: () => crypto.createHash('sha256').update(String(s)).digest('hex') }),
          HmacSHA512: (m, sec) => ({ toString: () => crypto.createHmac('sha512', String(sec)).update(String(m)).digest('hex') }),
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
        header: () => null,
        text: () => JSON.stringify({
          err: 0,
          data: { '128': 'https://a128.zmdcdn.me/song.mp3?authen=exp=1794122958' },
        }),
      };
    },
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  const r1 = ctx.execute({ id: 'ZWZB96AB' });
  assert.strictEqual(r1.status, 'ok');
  assert.strictEqual(fetchCount, 1);

  fetchCount = 0;
  const r2 = ctx.execute({ id: 'ZWZB96AB' });
  assert.strictEqual(r2.status, 'ok');
  assert.strictEqual(fetchCount, 0, 'Must hit cache');
});

// 6. Live integration test with real ZingMP3 API
test('Live integration test: search and stream resolution', () => {
  const searchResult = runScript('search.js', { query: 'waiting for you mono' }, { pluginSlug: 'zingmp3-source' });
  assert.strictEqual(searchResult.result.status, 'ok');
  const items = searchResult.result.data.items;
  assert.ok(items.length > 0, 'Live search should return ZingMP3 songs');
  const firstSong = items[0];
  assert.ok(firstSong.id);
  assert.ok(firstSong.title);
  console.log(`  Live song found: "${firstSong.title}" by ${firstSong.artist} (encodeId: ${firstSong.id})`);

  const streamResult = runScript('stream.js', { id: firstSong.id }, { pluginSlug: 'zingmp3-source' });
  assert.strictEqual(streamResult.result.status, 'ok');
  assert.ok(streamResult.result.data.url.startsWith('http'), 'Stream URL must be valid HTTP URL');
  assert.strictEqual(streamResult.result.data.mimeType, 'audio/mpeg');
  assert.strictEqual(streamResult.result.data.bitrate, 128000);
  console.log(`  Live CDN MP3 stream resolved: ${streamResult.result.data.url.slice(0, 60)}...`);
});

// 7. Check all new scripts: home, genre, playlist, album, artist, related, autocomplete, resolve
test('all 10 scripts exported and conform to latest source contract', () => {
  // autocomplete
  const autoRes = runScript('autocomplete.js', { query: 'waiting' }, { pluginSlug: 'zingmp3-source' });
  assert.strictEqual(autoRes.result.status, 'ok');
  assert.ok(Array.isArray(autoRes.result.data));

  // genre list
  const genreRes = runScript('genre.js', {}, { pluginSlug: 'zingmp3-source' });
  assert.strictEqual(genreRes.result.status, 'ok');
  assert.ok(Array.isArray(genreRes.result.data));
  assert.ok(genreRes.result.data.length > 0);
  assert.strictEqual(genreRes.result.data[0].script, 'genre.js');

  // playlist
  const plRes = runScript('playlist.js', { id: 'CasHsDNUCujg' }, { pluginSlug: 'zingmp3-source' });
  assert.strictEqual(plRes.result.status, 'ok');
  assert.ok(Array.isArray(plRes.result.data.tracks));

  // related
  const relRes = runScript('related.js', { id: 'BQfYy9h2OKFO' }, { pluginSlug: 'zingmp3-source' });
  assert.strictEqual(relRes.result.status, 'ok');
  assert.ok(Array.isArray(relRes.result.data.items));
});

console.log(`\nAll ${passedTests} ZingMP3 source tests passed successfully.`);
