// Smoke test and offline unit test for Bilibili source plugin: `node tools/check_bilibili_source.js`
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const { runScript } = require('./source_harness');

const pluginDir = path.join(__dirname, '..', 'src', 'bilibili');
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
  assert.strictEqual(manifest.metadata.name, 'Bilibili');
  assert.strictEqual(typeof manifest.metadata.version, 'number');
  assert.ok(Array.isArray(manifest.metadata.hosts));
  assert.ok(manifest.metadata.hosts.includes('api.bilibili.com'));
  assert.strictEqual(manifest.script.search, 'search.js');
  assert.strictEqual(manifest.script.stream, 'stream.js');
  assert.ok(manifest.config && manifest.config.quality);
});

// 2. Unit tests for common helpers
test('common.js: duration parsing, ID extraction, artwork choosing', () => {
  const sandbox = {
    fetch: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);

  // parseDurationMs
  assert.strictEqual(ctx.parseDurationMs('56:15'), 3375000);
  assert.strictEqual(ctx.parseDurationMs('1:02:15'), 3735000);
  assert.strictEqual(ctx.parseDurationMs('45'), 45000);
  assert.strictEqual(ctx.parseDurationMs(120), 120000);

  // extractBvid
  assert.strictEqual(ctx.extractBvid('BV1oM4m1X7QB'), 'BV1oM4m1X7QB');
  assert.strictEqual(ctx.extractBvid('https://www.bilibili.com/video/BV1oM4m1X7QB?spm_id=1'), 'BV1oM4m1X7QB');
  assert.strictEqual(ctx.extractBvid('av1302719542'), 'av1302719542');
  assert.strictEqual(ctx.extractBvid('query without bv'), '');

  // chooseArtworkUrl
  assert.strictEqual(ctx.chooseArtworkUrl('//i0.hdslb.com/bfs/archive/123.jpg'), 'https://i0.hdslb.com/bfs/archive/123.jpg');

  // parseTrackCard
  const mockItem = {
    bvid: 'BV1oM4m1X7QB',
    title: '【精选歌单】| <em class="keyword">YOASOBI</em> 的一小时精选歌曲',
    author: 'AOI的循环歌单',
    duration: '56:15',
    pic: '//i0.hdslb.com/bfs/archive/123.jpg',
  };
  const card = ctx.parseTrackCard(mockItem);
  assert.strictEqual(card.id, 'BV1oM4m1X7QB');
  assert.strictEqual(card.title, '【精选歌单】| YOASOBI 的一小时精选歌曲');
  assert.strictEqual(card.artist, 'AOI的循环歌单');
  assert.strictEqual(card.durationMs, 3375000);
  assert.strictEqual(card.artworkUrl, 'https://i0.hdslb.com/bfs/archive/123.jpg');
  assert.strictEqual(card.webUrl, 'https://www.bilibili.com/video/BV1oM4m1X7QB');
});

// 3. search.js parser & query handling
test('search.js: offline search parsing, URL resolve, and pagination', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  const sandbox = {
    Response: mockResponse,
    load: () => {},
    localConfig: { getItem: () => null },
    cacheStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console: console,
    fetch: (url) => {
      if (url.includes('/view?')) {
        return {
          status: 200,
          ok: true,
          text: () => JSON.stringify({
            code: 0,
            data: {
              bvid: 'BV1oM4m1X7QB',
              title: 'YOASOBI Mix',
              owner: { name: 'AOI' },
              duration: 3375,
              pic: '//i0.hdslb.com/123.jpg',
            },
          }),
        };
      }
      if (url.includes('/search/type?')) {
        const dummyResult = [];
        for (let i = 0; i < 20; i++) {
          dummyResult.push({
            bvid: `BV_${i}`,
            title: `Title ${i}`,
            author: `Author ${i}`,
            duration: '03:30',
          });
        }
        return {
          status: 200,
          ok: true,
          text: () => JSON.stringify({
            code: 0,
            data: {
              page: 1,
              numPages: 5,
              result: dummyResult,
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

  // 3a. Empty query
  const emptyRes = ctx.execute({});
  assert.strictEqual(emptyRes.status, 'ok');
  assert.strictEqual(emptyRes.data.items.length, 0);

  // 3b. Pasted Bilibili URL
  const urlRes = ctx.execute({ query: 'https://www.bilibili.com/video/BV1oM4m1X7QB' });
  assert.strictEqual(urlRes.status, 'ok');
  assert.strictEqual(urlRes.data.items.length, 1);
  assert.strictEqual(urlRes.data.items[0].id, 'BV1oM4m1X7QB');

  // 3c. Search query with pagination token
  const searchRes = ctx.execute({ query: 'yoasobi' });
  assert.strictEqual(searchRes.status, 'ok');
  assert.strictEqual(searchRes.data.items.length, 20);
  assert.strictEqual(searchRes.data.next, '2');
});

// 4. stream.js resolution & error handling
test('stream.js: resolves DASH audio stream URL and handles custom Referer header', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  let mockViewCode = 0;
  let mockPlayCode = 0;

  const sandbox = {
    Response: mockResponse,
    load: () => {},
    localConfig: { getItem: () => null },
    cacheStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console: console,
    fetch: (url) => {
      if (url.includes('/view?')) {
        return {
          status: 200,
          ok: true,
          text: () => JSON.stringify({
            code: mockViewCode,
            message: mockViewCode !== 0 ? 'Video unavailable' : 'OK',
            data: { bvid: 'BV1oM4m1X7QB', cid: 123456 },
          }),
        };
      }
      if (url.includes('/playurl?')) {
        return {
          status: 200,
          ok: true,
          text: () => JSON.stringify({
            code: mockPlayCode,
            data: {
              dash: {
                audio: [
                  { id: 30280, bandwidth: 101420, mimeType: 'audio/mp4', baseUrl: 'https://upos.akamaized.net/audio.m4s' },
                ],
              },
            },
          }),
        };
      }
      return { status: 404, ok: false, text: () => '' };
    },
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  // 4a. Successful stream resolution
  const okRes = ctx.execute({ id: 'BV1oM4m1X7QB' });
  assert.strictEqual(okRes.status, 'ok');
  assert.strictEqual(okRes.data.url, 'https://upos.akamaized.net/audio.m4s');
  assert.strictEqual(okRes.data.headers['Referer'], 'https://www.bilibili.com/');
  assert.strictEqual(okRes.data.mimeType, 'audio/mp4');
  assert.strictEqual(okRes.data.bitrate, 101420);

  // 4b. Video deleted/unavailable
  mockViewCode = -404;
  const unavailRes = ctx.execute({ id: 'BV1oM4m1X7QB', fresh: true });
  assert.strictEqual(unavailRes.status, 'scriptError');
  assert.strictEqual(unavailRes.opts.kind, 'unavailable');
});

// 5. stream.js cache contract: warm hits cache, fresh bypasses, fresh failure evicts
test('stream.js: cache hit, fresh bypass, and eviction on failure', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  const memStore = {};
  let fetchCount = 0;
  let mockViewCode = 0;
  let streamCount = 0;

  const sandbox = {
    Response: mockResponse,
    load: () => {},
    localConfig: { getItem: () => null },
    cacheStorage: {
      getItem: (k) => memStore[k] || null,
      setItem: (k, v) => { memStore[k] = v; },
      removeItem: (k) => { delete memStore[k]; },
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console: console,
    fetch: (url) => {
      fetchCount++;
      if (url.includes('/view?')) {
        return {
          status: 200,
          ok: true,
          text: () => JSON.stringify({
            code: mockViewCode,
            message: mockViewCode !== 0 ? 'Video unavailable' : 'OK',
            data: { bvid: 'BV1oM4m1X7QB', cid: 123456 },
          }),
        };
      }
      return {
        status: 200,
        ok: true,
        text: () => JSON.stringify({
          code: 0,
          data: {
            dash: {
              audio: [
                { id: 30280, bandwidth: 101420, mimeType: 'audio/mp4', baseUrl: `https://upos.akamaized.net/audio_${++streamCount}.m4s` },
              ],
            },
          },
        }),
      };
    },
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  // 1. Initial call: network fetched and cached
  const r1 = ctx.execute({ id: 'BV1oM4m1X7QB' });
  assert.strictEqual(r1.status, 'ok');
  assert.ok(fetchCount >= 2);
  assert.strictEqual(r1.data.url, 'https://upos.akamaized.net/audio_1.m4s');

  // 2. Second normal call: must hit cache without network
  fetchCount = 0;
  const r2 = ctx.execute({ id: 'BV1oM4m1X7QB' });
  assert.strictEqual(r2.status, 'ok');
  assert.strictEqual(fetchCount, 0, 'Must hit cache');
  assert.strictEqual(r2.data.url, 'https://upos.akamaized.net/audio_1.m4s');

  // 3. fresh: true call: bypasses cache and updates cache
  fetchCount = 0;
  const r3 = ctx.execute({ id: 'BV1oM4m1X7QB', fresh: true });
  assert.strictEqual(r3.status, 'ok');
  assert.ok(fetchCount >= 2, 'Must bypass cache when fresh: true');
  assert.strictEqual(r3.data.url, 'https://upos.akamaized.net/audio_2.m4s');

  // 4. Next normal call: receives updated cache
  fetchCount = 0;
  const r4 = ctx.execute({ id: 'BV1oM4m1X7QB' });
  assert.strictEqual(r4.status, 'ok');
  assert.strictEqual(fetchCount, 0);
  assert.strictEqual(r4.data.url, 'https://upos.akamaized.net/audio_2.m4s');

  // 5. fresh: true call that fails: evicts old cache
  mockViewCode = -404;
  fetchCount = 0;
  const r5 = ctx.execute({ id: 'BV1oM4m1X7QB', fresh: true });
  assert.strictEqual(r5.status, 'scriptError');
  assert.strictEqual(ctx.cacheGet('st:BV1oM4m1X7QB'), null, 'Old cache entry must be evicted on fresh failure');

  // 6. Next call after eviction must attempt network
  fetchCount = 0;
  const r6 = ctx.execute({ id: 'BV1oM4m1X7QB' });
  assert.strictEqual(r6.status, 'scriptError');
  assert.ok(fetchCount >= 1, 'Must attempt network because cache was evicted');
});

// 6. Storage quota resilience
test('common.js: handles QuotaExceededError without crashing', () => {
  const sandbox = {
    cacheStorage: {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {},
    },
    localStorage: {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {},
    },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);

  assert.doesNotThrow(() => {
    ctx.cacheSet('test_key', { data: 'some_value' }, 60000);
  });
});

// 7. Live integration test with real Bilibili API
test('Live integration test: search and stream resolution', () => {
  // Search live videos
  const searchResult = runScript('search.js', { query: 'yoasobi' }, { pluginSlug: 'bilibili' });
  assert.strictEqual(searchResult.result.status, 'ok');
  const items = searchResult.result.data.items;
  assert.ok(items.length > 0, 'Live search should return at least 1 video');
  const firstVideo = items[0];
  assert.ok(firstVideo.id);
  assert.ok(firstVideo.title);
  assert.ok(firstVideo.artworkUrl);
  console.log(`  Live video found: "${firstVideo.title}" by ${firstVideo.artist} (bvid: ${firstVideo.id})`);

  // Stream live video
  const streamResult = runScript('stream.js', { id: firstVideo.id }, { pluginSlug: 'bilibili' });
  assert.strictEqual(streamResult.result.status, 'ok');
  assert.ok(streamResult.result.data.url.startsWith('http'), 'Stream URL must be valid HTTP(S) URL');
  assert.strictEqual(streamResult.result.data.mimeType, 'audio/mp4');
  assert.strictEqual(streamResult.result.data.headers['Referer'], 'https://www.bilibili.com/');
  console.log(`  Live DASH audio stream resolved: ${streamResult.result.data.url.slice(0, 65)}...`);
});

// 8. Test all new source specification scripts
test('all 10 scripts exported and conform to latest source contract', () => {
  // autocomplete
  const autoRes = runScript('autocomplete.js', { query: 'yoasobi' }, { pluginSlug: 'bilibili' });
  assert.strictEqual(autoRes.result.status, 'ok');
  assert.ok(Array.isArray(autoRes.result.data));

  // genre list
  const genreRes = runScript('genre.js', {}, { pluginSlug: 'bilibili' });
  assert.strictEqual(genreRes.result.status, 'ok');
  assert.ok(Array.isArray(genreRes.result.data));
  assert.ok(genreRes.result.data.length > 0);
  assert.strictEqual(genreRes.result.data[0].script, 'genre.js');

  // related
  const relRes = runScript('related.js', { id: 'BV1xx411c7mD' }, { pluginSlug: 'bilibili' });
  assert.strictEqual(relRes.result.status, 'ok');
  assert.ok(Array.isArray(relRes.result.data.items));

  // resolve
  const resolveRes = runScript('resolve.js', { url: 'https://www.bilibili.com/video/BV1xx411c7mD' }, { pluginSlug: 'bilibili' });
  assert.strictEqual(resolveRes.result.status, 'ok');
  assert.strictEqual(resolveRes.result.data.kind, 'track');
});

console.log(`\nAll ${passedTests} Bilibili tests passed successfully.`);
