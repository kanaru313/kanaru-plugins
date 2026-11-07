// Smoke test and offline unit test for YouTube source plugin: `node tools/check_youtube_source.js`
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const pluginDir = path.join(__dirname, '..', 'src', 'youtube');
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
  assert.strictEqual(manifest.metadata.name, 'YouTube');
  assert.strictEqual(typeof manifest.metadata.version, 'number');
  assert.ok(Array.isArray(manifest.metadata.hosts));
  assert.ok(manifest.metadata.hosts.includes('www.youtube.com'));
  assert.ok(manifest.metadata.hosts.includes('*.googlevideo.com'));
  assert.strictEqual(manifest.script.search, 'search.js');
  assert.strictEqual(manifest.script.stream, 'stream.js');
  assert.ok(manifest.config && manifest.config.quality);
});

// 2. Unit tests for common helpers
test('common.js: duration parsing, ID extraction, balanced JSON', () => {
  const sandbox = {
    fetch: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);

  // parseDurationMs
  assert.strictEqual(ctx.parseDurationMs('3:37'), 217000);
  assert.strictEqual(ctx.parseDurationMs('1:02:15'), 3735000);
  assert.strictEqual(ctx.parseDurationMs('45'), 45000);
  assert.strictEqual(ctx.parseDurationMs(120000), 120000);

  // extractVideoId
  assert.strictEqual(ctx.extractVideoId('aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
  assert.strictEqual(ctx.extractVideoId('https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=10s'), 'aqz-KE-bpKQ');
  assert.strictEqual(ctx.extractVideoId('https://youtu.be/aqz-KE-bpKQ?feature=shared'), 'aqz-KE-bpKQ');
  assert.strictEqual(ctx.extractVideoId('https://www.youtube.com/shorts/aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
  assert.strictEqual(ctx.extractVideoId('invalid query'), '');

  // extractPlaylistId
  assert.strictEqual(ctx.extractPlaylistId('https://www.youtube.com/playlist?list=PL4fGSI1pDJn6jXS'), 'PL4fGSI1pDJn6jXS');
  assert.strictEqual(ctx.extractPlaylistId('PL4fGSI1pDJn6jXS'), 'PL4fGSI1pDJn6jXS');
  assert.strictEqual(ctx.extractPlaylistId('https://www.youtube.com/watch?v=abc&list=RDabc'), 'RDabc');

  // extractBalancedJson
  const jsonSample = 'prefix {"a": {"b": [1, 2, "3}"]}} suffix';
  const balanced = ctx.extractBalancedJson(jsonSample, jsonSample.indexOf('{'));
  assert.deepStrictEqual(JSON.parse(balanced), { a: { b: [1, 2, '3}'] } });
});

// 3. search.js parser tests with offline fixtures
test('search.js: card parsing from videoRenderer and lockupViewModel', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  const sandbox = {
    Response: mockResponse,
    load: (f) => {
      if (f === 'common.js') vm.runInContext(commonCode, ctx);
    },
    localConfig: { getItem: () => null },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console: console,
    fetch: () => {},
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(searchCode, ctx);

  // Fixture: videoRenderer
  const mockVideoRenderer = {
    videoId: 'CHw1b_1LVBA',
    title: { runs: [{ text: 'MONO - Waiting For You' }] },
    ownerText: { runs: [{ text: 'Mono Official' }] },
    lengthText: { simpleText: '4:26' },
    thumbnail: {
      thumbnails: [
        { url: 'https://i.ytimg.com/vi/CHw1b_1LVBA/default.jpg' },
        { url: 'https://i.ytimg.com/vi/CHw1b_1LVBA/hq720.jpg' },
      ],
    },
  };

  const card1 = ctx.parseCardFromVideoRenderer(mockVideoRenderer);
  assert.strictEqual(card1.id, 'CHw1b_1LVBA');
  assert.strictEqual(card1.title, 'MONO - Waiting For You');
  assert.strictEqual(card1.artist, 'Mono Official');
  assert.strictEqual(card1.durationMs, 266000);
  assert.strictEqual(card1.artworkUrl, 'https://i.ytimg.com/vi/CHw1b_1LVBA/hq720.jpg');
  assert.strictEqual(card1.webUrl, 'https://www.youtube.com/watch?v=CHw1b_1LVBA');

  // Fixture: lockupViewModel
  const mockLockup = {
    contentId: 'Rt9tW3cMLhI',
    metadata: {
      lockupMetadataViewModel: {
        title: { content: 'Olivia Rodrigo - stupid song' },
        metadataRows: [{ metadataParts: [{ text: { content: 'Olivia Rodrigo' } }] }],
      },
    },
    contentImage: {
      thumbnailViewModel: {
        image: { sources: [{ url: 'https://i.ytimg.com/vi/Rt9tW3cMLhI/hqdefault.jpg' }] },
        overlays: [
          {
            thumbnailBottomOverlayViewModel: {
              badges: [{ thumbnailBadgeViewModel: { text: '3:37' } }],
            },
          },
        ],
      },
    },
  };

  const card2 = ctx.parseCardFromLockup(mockLockup);
  assert.strictEqual(card2.id, 'Rt9tW3cMLhI');
  assert.strictEqual(card2.title, 'Olivia Rodrigo - stupid song');
  assert.strictEqual(card2.artist, 'Olivia Rodrigo');
  assert.strictEqual(card2.durationMs, 217000);
  // Must NOT be hqdefault (which has 4:3 letterboxing)
  assert.ok(!card2.artworkUrl.includes('hqdefault'), 'artworkUrl must never contain hqdefault');
  assert.strictEqual(card2.artworkUrl, 'https://i.ytimg.com/vi/Rt9tW3cMLhI/hq720.jpg');

  // Square artwork priority test
  const mockSquareLockup = {
    contentId: 'sq123456789',
    metadata: {
      lockupMetadataViewModel: {
        title: { content: 'Square Art Song' },
      },
    },
    contentImage: {
      thumbnailViewModel: {
        image: {
          sources: [
            { url: 'https://i.ytimg.com/vi/sq123456789/hq720.jpg', width: 1280, height: 720 },
            { url: 'https://lh3.googleusercontent.com/album_square.jpg', width: 544, height: 544 },
          ],
        },
      },
    },
  };
  const card3 = ctx.parseCardFromLockup(mockSquareLockup);
  assert.strictEqual(card3.artworkUrl, 'https://lh3.googleusercontent.com/album_square.jpg', 'Square thumbnail should be prioritized');
});

// 4. stream.js format selection tests
test('stream.js: selectBestAudioFormat and expire parsing', () => {
  const sandbox = {
    load: (f) => {
      if (f === 'common.js') vm.runInContext(commonCode, ctx);
    },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  const mockFormats = [
    { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 129000, url: 'https://googlevideo.com/videoplayback?expire=1793955755&itag=140' },
    { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 160000, url: 'https://googlevideo.com/videoplayback?expire=1793955755&itag=251' },
    { itag: 249, mimeType: 'audio/webm; codecs="opus"', bitrate: 50000, url: 'https://googlevideo.com/videoplayback?expire=1793955755&itag=249' },
    { itag: 137, mimeType: 'video/mp4', bitrate: 2500000, url: 'https://googlevideo.com/videoplayback?expire=1793955755&itag=137' },
  ];

  // Highest quality preferred by default
  const best = ctx.selectBestAudioFormat(mockFormats, false);
  assert.strictEqual(best.itag, 251);
  assert.strictEqual(best.bitrate, 160000);

  // Low quality (data saver) preferred
  const low = ctx.selectBestAudioFormat(mockFormats, true);
  assert.strictEqual(low.itag, 140);
  assert.strictEqual(low.bitrate, 129000);

  // Expire extraction
  const expireMatch = best.url.match(/[?&]expire=(\d+)/);
  assert.strictEqual(parseInt(expireMatch[1], 10), 1793955755);
});

// 5. Offline stream error handling tests
test('stream.js: handles live, age-restricted, region-locked, invalid ID', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  const sandbox = {
    Response: mockResponse,
    load: () => {},
    localConfig: { getItem: () => null },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console: console,
    fetch: () => ({
      status: 200,
      ok: true,
      text: () => '<script>"INNERTUBE_API_KEY":"AIzaTest"</script>',
    }),
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  // Invalid ID
  ctx.execute({ id: '' });
  assert.strictEqual(responseData.status, 'scriptError');
  assert.strictEqual(responseData.opts.kind, 'unavailable');

  // Age-restricted mock
  ctx.postPlayer = () => ({
    status: 200,
    ok: true,
    json: {
      playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Đăng nhập để xác nhận tuổi của bạn' },
    },
  });
  ctx.execute({ id: '07FYdnEawAQ' });
  assert.strictEqual(responseData.status, 'scriptError');
  assert.strictEqual(responseData.opts.kind, 'auth');
  assert.ok(responseData.message.includes('giới hạn độ tuổi'));

  // Livestream mock
  ctx.postPlayer = () => ({
    status: 200,
    ok: true,
    json: {
      playabilityStatus: { status: 'OK' },
      videoDetails: { isLive: true, isLiveContent: true },
    },
  });
  ctx.execute({ id: 'jfKfPfyJRdk' });
  assert.strictEqual(responseData.status, 'scriptError');
  assert.strictEqual(responseData.opts.kind, 'unsupported');
  assert.ok(responseData.message.includes('Livestream'));

  // Region-locked mock
  ctx.postPlayer = () => ({
    status: 200,
    ok: true,
    json: {
      playabilityStatus: { status: 'UNPLAYABLE', reason: 'Video này không có sẵn ở quốc gia của bạn' },
    },
  });
  ctx.execute({ id: 'regionLck11' });
  assert.strictEqual(responseData.status, 'scriptError');
  assert.strictEqual(responseData.opts.kind, 'unavailable');
  assert.ok(responseData.message.includes('bị chặn'));

  // No audio format mock
  ctx.postPlayer = () => ({
    status: 200,
    ok: true,
    json: {
      playabilityStatus: { status: 'OK' },
      streamingData: { formats: [], adaptiveFormats: [] },
    },
  });
  ctx.execute({ id: 'noAudioFmt1' });
  assert.strictEqual(responseData.status, 'scriptError');
  assert.strictEqual(responseData.opts.kind, 'unsupported');
});

// 6. LocalStorage quota adherence test
test('localStorage quota: compact cache avoids 64 KiB QuotaExceededError', () => {
  const store = {};
  const QUOTA = 64 * 1024;
  let totalBytes = 0;

  const mockLocalStorage = {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => {
      const added = Buffer.byteLength(k, 'utf8') + Buffer.byteLength(v, 'utf8');
      if (totalBytes + added > QUOTA) {
        throw new Error('QuotaExceededError');
      }
      store[k] = v;
      totalBytes += added;
    },
    removeItem: (k) => {
      if (store[k]) {
        totalBytes -= Buffer.byteLength(k, 'utf8') + Buffer.byteLength(store[k], 'utf8');
        delete store[k];
      }
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
      totalBytes = 0;
    },
  };

  const sandbox = {
    localStorage: mockLocalStorage,
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);

  // Storing 5 search result caches and 10 stream caches
  for (let i = 0; i < 5; i++) {
    const searchData = {
      items: Array.from({ length: 20 }, (_, idx) => ({
        id: `vid_${i}_${idx}_11c`,
        title: `Song Title Number ${idx} of query ${i}`,
        artist: `Artist Channel Name ${idx}`,
        durationMs: 215000,
        artworkUrl: `https://i.ytimg.com/vi/vid_${i}_${idx}_11c/hqdefault.jpg`,
        webUrl: `https://www.youtube.com/watch?v=vid_${i}_${idx}_11c`,
      })),
      next: `token_${i}_continuation_sample`,
    };
    ctx.cacheSet(`search_${i}`, searchData, 60000);
  }

  for (let j = 0; j < 10; j++) {
    const streamData = {
      url: `https://rr1---sn-42u-i5olr.googlevideo.com/videoplayback?expire=1793955755&id=${j}`,
      headers: { 'User-Agent': 'VisionOS', Referer: 'https://www.youtube.com/' },
      mimeType: 'audio/webm; codecs="opus"',
      bitrate: 160000,
      expiresAtMs: 1793955755000,
    };
    ctx.cacheSet(`st:vid_${j}`, streamData, 300000);
  }

  assert.ok(totalBytes < QUOTA, `Storage totalBytes (${totalBytes}) must be within quota (${QUOTA})`);
  assert.ok(totalBytes > 0);
  console.log(`  Storage used by 5 search + 10 stream items: ${totalBytes} B (quota: ${QUOTA} B)`);
});

// 7. stream.js: expiresAtMs, fresh bypasses cache, and fresh error evicts cache
test('stream.js: expiresAtMs, fresh bypasses cache, and fresh error evicts cache', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  const store = {};
  let fetchCount = 0;
  const baseExpireSec = Math.floor(Date.now() / 1000) + 21600;
  let currentExpireSec = baseExpireSec;
  let currentFormatUrl = `https://rr1.googlevideo.com/videoplayback?expire=${currentExpireSec}&itag=251`;

  const sandbox = {
    Response: mockResponse,
    load: () => {},
    localConfig: { getItem: () => null },
    cacheStorage: {
      getItem: (k) => store[k] || null,
      setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; },
    },
    console: console,
    fetch: () => {
      fetchCount++;
      return {
        status: 200,
        ok: true,
        text: () => '<script>"INNERTUBE_API_KEY":"AIzaTest"</script>',
      };
    },
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  let postPlayerShouldFail = false;
  ctx.postPlayer = () => {
    fetchCount++;
    if (postPlayerShouldFail) {
      return {
        status: 200,
        ok: true,
        json: { playabilityStatus: { status: 'UNPLAYABLE', reason: 'Video bị xoá' } },
      };
    }
    return {
      status: 200,
      ok: true,
      json: {
        playabilityStatus: { status: 'OK' },
        streamingData: {
          adaptiveFormats: [
            { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 160000, url: currentFormatUrl },
          ],
        },
      },
    };
  };

  // 1. Cold call
  fetchCount = 0;
  const coldRes = ctx.execute({ id: 'CHw1b_1LVBA' });
  assert.strictEqual(coldRes.status, 'ok');
  assert.ok(fetchCount > 0, 'Cold call must fetch over network');
  assert.strictEqual(coldRes.data.expiresAtMs, baseExpireSec * 1000, 'expiresAtMs must equal expire * 1000');
  assert.strictEqual(coldRes.data.expiresAt, undefined, 'expiresAt (seconds) must not exist');

  // 2. Warm call without fresh (must use cache, 0 sends)
  fetchCount = 0;
  const warmRes = ctx.execute({ id: 'CHw1b_1LVBA' });
  assert.strictEqual(warmRes.status, 'ok');
  assert.strictEqual(fetchCount, 0, 'Warm call must return from cache with 0 sends');
  assert.strictEqual(warmRes.data.expiresAtMs, baseExpireSec * 1000);

  // 3. Fresh call with fresh: true (must bypass cache, fetch over network, overwrite cache)
  fetchCount = 0;
  const renewedExpireSec = baseExpireSec + 3600;
  currentExpireSec = renewedExpireSec;
  currentFormatUrl = `https://rr1.googlevideo.com/videoplayback?expire=${currentExpireSec}&itag=251&renewed=1`;
  const freshRes = ctx.execute({ id: 'CHw1b_1LVBA', fresh: true });
  assert.strictEqual(freshRes.status, 'ok');
  assert.ok(fetchCount > 0, 'Fresh call must bypass cache and fetch over network');
  assert.strictEqual(freshRes.data.expiresAtMs, renewedExpireSec * 1000, 'Fresh call must return newly resolved expiresAtMs');
  assert.ok(freshRes.data.url.includes('renewed=1'));

  // 3b. Next normal call should have the NEW cached result
  fetchCount = 0;
  const warmAfterFresh = ctx.execute({ id: 'CHw1b_1LVBA' });
  assert.strictEqual(warmAfterFresh.status, 'ok');
  assert.strictEqual(fetchCount, 0, 'Subsequent call must hit the updated cache');
  assert.strictEqual(warmAfterFresh.data.expiresAtMs, renewedExpireSec * 1000);

  // 4. Fresh call that fails during resolution (must delete old cache entry)
  postPlayerShouldFail = true;
  const failFreshRes = ctx.execute({ id: 'CHw1b_1LVBA', fresh: true });
  assert.strictEqual(failFreshRes.status, 'scriptError');
  assert.strictEqual(failFreshRes.opts.kind, 'unavailable');
  assert.strictEqual(ctx.cacheGet('st:CHw1b_1LVBA'), null, 'Failed fresh resolve must delete old cache entry');

  // 5. Subsequent normal call must NOT return the old URL (cache is gone)
  fetchCount = 0;
  const callAfterEvict = ctx.execute({ id: 'CHw1b_1LVBA' });
  assert.strictEqual(callAfterEvict.status, 'scriptError');
  assert.ok(fetchCount > 0, 'Cache was evicted, must attempt network instead of returning old URL');
});

// 8. Cache storage: cacheStorage vs localStorage and quota resilience
test('cacheStorage vs localStorage fallback and quota handling', () => {
  const cacheStore = {};
  const localStore = {};

  // Case A: cacheStorage is present -> uses cacheStorage, not localStorage
  const sandboxA = {
    cacheStorage: {
      getItem: (k) => cacheStore[k] || null,
      setItem: (k, v) => { cacheStore[k] = v; },
      removeItem: (k) => { delete cacheStore[k]; },
    },
    localStorage: {
      getItem: (k) => localStore[k] || null,
      setItem: (k, v) => { localStore[k] = v; },
      removeItem: (k) => { delete localStore[k]; },
    },
  };
  const ctxA = vm.createContext(sandboxA);
  vm.runInContext(commonCode, ctxA);
  ctxA.cacheSet('key1', { hello: 'world' }, 60000);
  assert.strictEqual(ctxA.cacheGet('key1')?.hello, 'world');
  assert.ok(cacheStore['yt:key1'], 'Stored in cacheStorage');
  assert.strictEqual(localStore['yt:key1'], undefined, 'Not stored in localStorage when cacheStorage present');

  // Case B: cacheStorage is undefined -> falls back to localStorage
  const sandboxB = {
    localStorage: {
      getItem: (k) => localStore[k] || null,
      setItem: (k, v) => { localStore[k] = v; },
      removeItem: (k) => { delete localStore[k]; },
    },
  };
  const ctxB = vm.createContext(sandboxB);
  vm.runInContext(commonCode, ctxB);
  ctxB.cacheSet('key2', { fallback: true }, 60000);
  assert.strictEqual(ctxB.cacheGet('key2')?.fallback, true);
  assert.ok(localStore['yt:key2'], 'Stored in localStorage when cacheStorage is missing');

  // Case C: setItem throws Quota error -> caught silently, script does not throw
  const sandboxC = {
    cacheStorage: {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {},
    },
  };
  const ctxC = vm.createContext(sandboxC);
  vm.runInContext(commonCode, ctxC);
  assert.doesNotThrow(() => {
    ctxC.cacheSet('key3', { test: 123 }, 60000);
  }, 'cacheSet must catch quota error and continue');
});

// 9. Stream URL without expire parameter defaults to now + 5 minutes
test('stream.js: defaults expiresAtMs to now + 5m if URL lacks expire', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  const sandbox = {
    Response: mockResponse,
    load: () => {},
    localConfig: { getItem: () => null },
    cacheStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    console: { log: () => {} },
    fetch: () => ({
      status: 200,
      ok: true,
      text: () => '<script>"INNERTUBE_API_KEY":"AIzaTest"</script>',
    }),
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  ctx.postPlayer = () => ({
    status: 200,
    ok: true,
    json: {
      playabilityStatus: { status: 'OK' },
      streamingData: {
        adaptiveFormats: [
          { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 160000, url: 'https://rr1.googlevideo.com/videoplayback?itag=251' },
        ],
      },
    },
  });

  const beforeMs = Date.now();
  const res = ctx.execute({ id: 'CHw1b_1LVBA', fresh: true });
  const afterMs = Date.now();
  assert.strictEqual(res.status, 'ok');
  assert.ok(res.data.expiresAtMs >= beforeMs + 5 * 60 * 1000);
  assert.ok(res.data.expiresAtMs <= afterMs + 5 * 60 * 1000 + 1000);
});

console.log(`\nAll ${passedTests} offline tests passed successfully.`);
