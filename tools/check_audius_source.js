// Smoke test and offline unit test for Audius source plugin: `node tools/check_audius_source.js`
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const { runScript } = require('./audius_harness');

const pluginDir = path.join(__dirname, '..', 'src', 'audius');
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
  assert.strictEqual(manifest.metadata.name, 'Audius');
  assert.strictEqual(typeof manifest.metadata.version, 'number');
  assert.ok(Array.isArray(manifest.metadata.hosts));
  assert.ok(manifest.metadata.hosts.includes('api.audius.co'));
  assert.ok(manifest.metadata.hosts.includes('*.audius.co'));
  assert.strictEqual(manifest.script.search, 'search.js');
  assert.strictEqual(manifest.script.stream, 'stream.js');
  assert.ok(manifest.config && manifest.config.appName);
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
  assert.strictEqual(ctx.parseDurationMs(226), 226000);
  assert.strictEqual(ctx.parseDurationMs('15.5'), 15500);
  assert.strictEqual(ctx.parseDurationMs(0), 0);
  assert.strictEqual(ctx.parseDurationMs(null), 0);

  // isAudiusUrl
  assert.strictEqual(ctx.isAudiusUrl('https://audius.co/skrillex/kliptown-empyrean-98562'), true);
  assert.strictEqual(ctx.isAudiusUrl('http://www.audius.co/tracks/G0wyE'), true);
  assert.strictEqual(ctx.isAudiusUrl('https://youtube.com/watch?v=123'), false);
  assert.strictEqual(ctx.isAudiusUrl('skrillex remix'), false);

  // extractTrackId
  assert.strictEqual(ctx.extractTrackId('G0wyE'), 'G0wyE');
  assert.strictEqual(ctx.extractTrackId('98562'), '98562');
  assert.strictEqual(ctx.extractTrackId('https://audius.co/tracks/G0wyE'), 'G0wyE');
  assert.strictEqual(ctx.extractTrackId('https://audius.co/tracks/87GrbyW?foo=bar'), '87GrbyW');

  // chooseArtworkUrl
  const artwork = {
    '150x150': 'https://img.audius.co/150.jpg',
    '480x480': 'https://img.audius.co/480.jpg',
    '1000x1000': 'https://img.audius.co/1000.jpg',
  };
  assert.strictEqual(ctx.chooseArtworkUrl(artwork), 'https://img.audius.co/480.jpg');

  // parseTrackCard
  const mockTrack = {
    id: 'G0wyE',
    title: 'Kliptown Empyrean',
    user: { name: 'Skrillex' },
    duration: 226,
    artwork: artwork,
    permalink: '/skrillex/kliptown-empyrean-98562',
  };
  const card = ctx.parseTrackCard(mockTrack);
  assert.strictEqual(card.id, 'G0wyE');
  assert.strictEqual(card.title, 'Kliptown Empyrean');
  assert.strictEqual(card.artist, 'Skrillex');
  assert.strictEqual(card.durationMs, 226000);
  assert.strictEqual(card.artworkUrl, 'https://img.audius.co/480.jpg');
  assert.strictEqual(card.webUrl, 'https://audius.co/skrillex/kliptown-empyrean-98562');
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
      if (url.includes('/v1/resolve')) {
        return {
          status: 200,
          ok: true,
          text: () => JSON.stringify({
            data: {
              id: '87GrbyW',
              title: 'Elastic Illusions',
              user: { name: 'ShrivL' },
              duration: 231,
              permalink: '/ShrivL/elastic-illusions',
            },
          }),
        };
      }
      if (url.includes('/v1/tracks/search')) {
        const dummyTracks = [];
        for (let i = 0; i < 20; i++) {
          dummyTracks.push({
            id: `track_${i}`,
            title: `Title ${i}`,
            user: { name: `Artist ${i}` },
            duration: 180,
          });
        }
        return {
          status: 200,
          ok: true,
          text: () => JSON.stringify({ data: dummyTracks }),
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

  // 3b. Pasted track URL
  const urlRes = ctx.execute({ query: 'https://audius.co/ShrivL/elastic-illusions' });
  assert.strictEqual(urlRes.status, 'ok');
  assert.strictEqual(urlRes.data.items.length, 1);
  assert.strictEqual(urlRes.data.items[0].id, '87GrbyW');
  assert.strictEqual(urlRes.data.items[0].title, 'Elastic Illusions');

  // 3c. Search query with pagination token
  const searchRes = ctx.execute({ query: 'electronic' });
  assert.strictEqual(searchRes.status, 'ok');
  assert.strictEqual(searchRes.data.items.length, 20);
  assert.strictEqual(searchRes.data.next, '20');
});

// 4. stream.js resolution & error handling
test('stream.js: resolves 302 stream location and maps error kinds', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  let mockStatus = 302;
  let mockLocation = 'https://creatornode.audius.co/tracks/cidstream/Qm123?signature=0xabc';

  const sandbox = {
    Response: mockResponse,
    load: () => {},
    localConfig: { getItem: () => null },
    cacheStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console: console,
    fetch: () => ({
      status: mockStatus,
      ok: mockStatus >= 200 && mockStatus < 300,
      header: (name) => (name.toLowerCase() === 'location' ? mockLocation : null),
      headers: { location: mockLocation },
      text: () => '',
    }),
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  // 4a. Successful 302 redirect resolution
  const okRes = ctx.execute({ id: 'G0wyE' });
  assert.strictEqual(okRes.status, 'ok');
  assert.strictEqual(okRes.data.url, mockLocation);
  assert.strictEqual(okRes.data.mimeType, 'audio/mpeg');
  assert.strictEqual(okRes.data.bitrate, 320000);
  assert.ok(okRes.data.expiresAtMs > Date.now());

  // 4b. 403 Gated track -> auth kind
  mockStatus = 403;
  const authRes = ctx.execute({ id: 'G0wyE', fresh: true });
  assert.strictEqual(authRes.status, 'scriptError');
  assert.strictEqual(authRes.opts.kind, 'auth');

  // 4c. 400 Invalid ID -> unavailable kind
  mockStatus = 400;
  const invalidRes = ctx.execute({ id: 'invalid', fresh: true });
  assert.strictEqual(invalidRes.status, 'scriptError');
  assert.strictEqual(invalidRes.opts.kind, 'unavailable');

  // 4d. 404 Track not found -> unavailable kind
  mockStatus = 404;
  const notFoundRes = ctx.execute({ id: 'notfound', fresh: true });
  assert.strictEqual(notFoundRes.status, 'scriptError');
  assert.strictEqual(notFoundRes.opts.kind, 'unavailable');
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
  let mockStatus = 302;
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
    fetch: () => {
      fetchCount++;
      return {
        status: mockStatus,
        ok: mockStatus >= 200 && mockStatus < 300,
        header: () => `https://creatornode.audius.co/stream_${++streamCount}.mp3`,
        headers: { location: `https://creatornode.audius.co/stream_${streamCount}.mp3` },
        text: () => '',
      };
    },
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  // 1. Initial call: network fetched and cached
  const r1 = ctx.execute({ id: 'G0wyE' });
  assert.strictEqual(r1.status, 'ok');
  assert.strictEqual(fetchCount, 1);
  assert.strictEqual(r1.data.url, 'https://creatornode.audius.co/stream_1.mp3');

  // 2. Second normal call: must hit cache without network
  fetchCount = 0;
  const r2 = ctx.execute({ id: 'G0wyE' });
  assert.strictEqual(r2.status, 'ok');
  assert.strictEqual(fetchCount, 0, 'Must hit cache');
  assert.strictEqual(r2.data.url, 'https://creatornode.audius.co/stream_1.mp3');

  // 3. fresh: true call: bypasses cache and updates cache
  fetchCount = 0;
  const r3 = ctx.execute({ id: 'G0wyE', fresh: true });
  assert.strictEqual(r3.status, 'ok');
  assert.strictEqual(fetchCount, 1, 'Must bypass cache when fresh: true');
  assert.strictEqual(r3.data.url, 'https://creatornode.audius.co/stream_2.mp3');

  // 4. Next normal call: receives updated cache
  fetchCount = 0;
  const r4 = ctx.execute({ id: 'G0wyE' });
  assert.strictEqual(r4.status, 'ok');
  assert.strictEqual(fetchCount, 0);
  assert.strictEqual(r4.data.url, 'https://creatornode.audius.co/stream_2.mp3');

  // 5. fresh: true call that fails: evicts old cache
  mockStatus = 404;
  fetchCount = 0;
  const r5 = ctx.execute({ id: 'G0wyE', fresh: true });
  assert.strictEqual(r5.status, 'scriptError');
  assert.strictEqual(ctx.cacheGet('st:G0wyE'), null, 'Old cache entry must be evicted on fresh failure');

  // 6. Next call after eviction must attempt network
  fetchCount = 0;
  const r6 = ctx.execute({ id: 'G0wyE' });
  assert.strictEqual(r6.status, 'scriptError');
  assert.strictEqual(fetchCount, 1, 'Must attempt network because cache was evicted');
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

// 7. Live integration test with real Audius API
test('Live integration test: search and stream resolution', () => {
  // Search live tracks
  const searchResult = runScript('search.js', { query: 'skrillex' });
  assert.strictEqual(searchResult.result.status, 'ok');
  const items = searchResult.result.data.items;
  assert.ok(items.length > 0, 'Live search should return at least 1 track');
  const firstTrack = items[0];
  assert.ok(firstTrack.id);
  assert.ok(firstTrack.title);
  assert.ok(firstTrack.artworkUrl);
  console.log(`  Live track found: "${firstTrack.title}" by ${firstTrack.artist} (id: ${firstTrack.id})`);

  // Stream live track
  const streamResult = runScript('stream.js', { id: firstTrack.id });
  assert.strictEqual(streamResult.result.status, 'ok');
  assert.ok(streamResult.result.data.url.startsWith('http'), 'Stream URL must be valid HTTP(S) URL');
  assert.strictEqual(streamResult.result.data.mimeType, 'audio/mpeg');
  assert.strictEqual(streamResult.result.data.bitrate, 320000);
  console.log(`  Live stream resolved: ${streamResult.result.data.url.slice(0, 70)}...`);
});

console.log(`\nAll ${passedTests} Audius tests passed successfully.`);
