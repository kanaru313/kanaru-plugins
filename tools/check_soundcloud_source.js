// Smoke test and offline unit test for SoundCloud source plugin: `node tools/check_soundcloud_source.js`
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const { runScript } = require('./soundcloud_harness');

const pluginDir = path.join(__dirname, '..', 'src', 'soundcloud');
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
  assert.strictEqual(manifest.metadata.name, 'SoundCloud');
  assert.strictEqual(typeof manifest.metadata.version, 'number');
  assert.ok(Array.isArray(manifest.metadata.hosts));
  assert.ok(manifest.metadata.hosts.includes('soundcloud.com'));
  assert.ok(manifest.metadata.hosts.includes('*.soundcloud.com'));
  assert.ok(manifest.metadata.hosts.includes('*.sndcdn.com'));
  assert.ok(manifest.metadata.hosts.includes('*.soundcloud.cloud'));
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
  assert.strictEqual(ctx.parseDurationMs(307977), 307977);
  assert.strictEqual(ctx.parseDurationMs(0), 0);
  assert.strictEqual(ctx.parseDurationMs(null), 0);

  // isSoundCloudUrl
  assert.strictEqual(ctx.isSoundCloudUrl('https://soundcloud.com/skrillex/cinema'), true);
  assert.strictEqual(ctx.isSoundCloudUrl('http://m.soundcloud.com/artist/track'), true);
  assert.strictEqual(ctx.isSoundCloudUrl('https://youtube.com/watch?v=123'), false);
  assert.strictEqual(ctx.isSoundCloudUrl('skrillex cinema remix'), false);

  // extractTrackId
  assert.strictEqual(ctx.extractTrackId('24715050'), '24715050');
  assert.strictEqual(ctx.extractTrackId('soundcloud:tracks:24715050'), '24715050');
  assert.strictEqual(ctx.extractTrackId('invalid_id'), '');

  // chooseArtworkUrl (-large.jpg -> -t500x500.jpg)
  const artLarge = 'https://i1.sndcdn.com/artworks-000080856705-uztc0k-large.jpg';
  assert.strictEqual(ctx.chooseArtworkUrl(artLarge), 'https://i1.sndcdn.com/artworks-000080856705-uztc0k-t500x500.jpg');

  // fallback to avatar url when artwork is null
  const avatarLarge = 'https://i1.sndcdn.com/avatars-2E03CZsylPtx04BH-IAcNiw-large.jpg';
  assert.strictEqual(ctx.chooseArtworkUrl(null, avatarLarge), 'https://i1.sndcdn.com/avatars-2E03CZsylPtx04BH-IAcNiw-t500x500.jpg');

  // parseTrackCard
  const mockTrack = {
    id: 24715050,
    title: 'Cinema (Skrillex Remix)',
    user: { username: 'Skrillex' },
    duration: 307977,
    artwork_url: artLarge,
    permalink_url: 'https://soundcloud.com/skrillex/cinema',
  };
  const card = ctx.parseTrackCard(mockTrack);
  assert.strictEqual(card.id, '24715050');
  assert.strictEqual(card.title, 'Cinema (Skrillex Remix)');
  assert.strictEqual(card.artist, 'Skrillex');
  assert.strictEqual(card.durationMs, 307977);
  assert.strictEqual(card.artworkUrl, 'https://i1.sndcdn.com/artworks-000080856705-uztc0k-t500x500.jpg');
  assert.strictEqual(card.webUrl, 'https://soundcloud.com/skrillex/cinema');
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
      if (url.includes('/resolve')) {
        return {
          status: 200,
          ok: true,
          text: () => JSON.stringify({
            kind: 'track',
            id: 24715050,
            title: 'Cinema (Skrillex Remix)',
            user: { username: 'Skrillex' },
            duration: 307977,
          }),
        };
      }
      if (url.includes('/search/tracks')) {
        const dummyCollection = [];
        for (let i = 0; i < 20; i++) {
          dummyCollection.push({
            id: 1000 + i,
            title: `Track ${i}`,
            user: { username: `Artist ${i}` },
            duration: 180000,
          });
        }
        return {
          status: 200,
          ok: true,
          text: () => JSON.stringify({ collection: dummyCollection }),
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
  const urlRes = ctx.execute({ query: 'https://soundcloud.com/skrillex/cinema' });
  assert.strictEqual(urlRes.status, 'ok');
  assert.strictEqual(urlRes.data.items.length, 1);
  assert.strictEqual(urlRes.data.items[0].id, '24715050');
  assert.strictEqual(urlRes.data.items[0].title, 'Cinema (Skrillex Remix)');

  // 3c. Search query with pagination token
  const searchRes = ctx.execute({ query: 'skrillex' });
  assert.strictEqual(searchRes.status, 'ok');
  assert.strictEqual(searchRes.data.items.length, 20);
  assert.strictEqual(searchRes.data.next, '20');
});

// 4. stream.js resolution & error handling
test('stream.js: resolves HLS stream URL and maps error kinds', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  let mockTrackData = {
    id: 24715050,
    policy: 'ALLOW',
    streamable: true,
    media: {
      transcodings: [
        {
          preset: 'aac_160k',
          url: 'https://api-v2.soundcloud.com/media/transcoding_1',
          format: { protocol: 'hls', mime_type: 'audio/mp4; codecs="mp4a.40.2"' },
        },
      ],
    },
  };

  let mockStatus = 200;

  const sandbox = {
    Response: mockResponse,
    load: () => {},
    localConfig: { getItem: () => null },
    cacheStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console: console,
    fetch: (url) => {
      if (url.includes('/tracks/')) {
        return {
          status: mockStatus,
          ok: mockStatus === 200,
          text: () => JSON.stringify(mockTrackData),
        };
      }
      if (url.includes('/media/')) {
        return {
          status: 200,
          ok: true,
          text: () => JSON.stringify({
            url: 'https://playback.media-streaming.soundcloud.cloud/playlist.m3u8?expires=1793957152',
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
  const okRes = ctx.execute({ id: '24715050' });
  assert.strictEqual(okRes.status, 'ok');
  assert.ok(okRes.data.url.includes('playlist.m3u8'));
  assert.strictEqual(okRes.data.bitrate, 160000);
  assert.strictEqual(okRes.data.expiresAtMs, 1793957152000);

  // 4b. SNIP policy (SoundCloud Go+ required) -> auth kind
  mockTrackData.policy = 'SNIP';
  const authRes = ctx.execute({ id: '24715050', fresh: true });
  assert.strictEqual(authRes.status, 'scriptError');
  assert.strictEqual(authRes.opts.kind, 'auth');

  // 4c. BLOCK policy (Region locked) -> unavailable kind
  mockTrackData.policy = 'BLOCK';
  const blockRes = ctx.execute({ id: '24715050', fresh: true });
  assert.strictEqual(blockRes.status, 'scriptError');
  assert.strictEqual(blockRes.opts.kind, 'unavailable');

  // 4d. streamable: false -> unsupported kind
  mockTrackData.policy = 'ALLOW';
  mockTrackData.streamable = false;
  const unsuppRes = ctx.execute({ id: '24715050', fresh: true });
  assert.strictEqual(unsuppRes.status, 'scriptError');
  assert.strictEqual(unsuppRes.opts.kind, 'unsupported');

  // 4e. 404 Not Found -> unavailable kind
  mockStatus = 404;
  const notFoundRes = ctx.execute({ id: '999999', fresh: true });
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
  let mockStatus = 200;
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
      if (url.includes('/tracks/')) {
        return {
          status: mockStatus,
          ok: mockStatus === 200,
          text: () => JSON.stringify({
            id: 24715050,
            policy: 'ALLOW',
            streamable: true,
            media: {
              transcodings: [
                {
                  preset: 'aac_160k',
                  url: 'https://api-v2.soundcloud.com/media/transcoding',
                  format: { protocol: 'hls' },
                },
              ],
            },
          }),
        };
      }
      return {
        status: 200,
        ok: true,
        text: () => JSON.stringify({
          url: `https://playback.media-streaming.soundcloud.cloud/stream_${++streamCount}.m3u8?expires=1793957152`,
        }),
      };
    },
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  // 1. Initial call: network fetched and cached
  const r1 = ctx.execute({ id: '24715050' });
  assert.strictEqual(r1.status, 'ok');
  assert.ok(fetchCount >= 1);
  assert.ok(r1.data.url.includes('stream_1.m3u8'));

  // 2. Second normal call: must hit cache without network
  fetchCount = 0;
  const r2 = ctx.execute({ id: '24715050' });
  assert.strictEqual(r2.status, 'ok');
  assert.strictEqual(fetchCount, 0, 'Must hit cache');
  assert.ok(r2.data.url.includes('stream_1.m3u8'));

  // 3. fresh: true call: bypasses cache and updates cache
  fetchCount = 0;
  const r3 = ctx.execute({ id: '24715050', fresh: true });
  assert.strictEqual(r3.status, 'ok');
  assert.ok(fetchCount >= 1, 'Must bypass cache when fresh: true');
  assert.ok(r3.data.url.includes('stream_2.m3u8'));

  // 4. Next normal call: receives updated cache
  fetchCount = 0;
  const r4 = ctx.execute({ id: '24715050' });
  assert.strictEqual(r4.status, 'ok');
  assert.strictEqual(fetchCount, 0);
  assert.ok(r4.data.url.includes('stream_2.m3u8'));

  // 5. fresh: true call that fails: evicts old cache
  mockStatus = 404;
  fetchCount = 0;
  const r5 = ctx.execute({ id: '24715050', fresh: true });
  assert.strictEqual(r5.status, 'scriptError');
  assert.strictEqual(ctx.cacheGet('st:24715050'), null, 'Old cache entry must be evicted on fresh failure');

  // 6. Next call after eviction must attempt network
  fetchCount = 0;
  const r6 = ctx.execute({ id: '24715050' });
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

// 7. Live integration test with real SoundCloud API
test('Live integration test: search and stream resolution', () => {
  // Search live tracks
  const searchResult = runScript('search.js', { query: 'alan walker' });
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
  assert.ok(streamResult.result.data.bitrate >= 96000);
  console.log(`  Live stream resolved: ${streamResult.result.data.url.slice(0, 70)}...`);
});

console.log(`\nAll ${passedTests} SoundCloud tests passed successfully.`);
