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
  assert.strictEqual(card2.artworkUrl, 'https://i.ytimg.com/vi/Rt9tW3cMLhI/hqdefault.jpg');
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
  assert.strictEqual(responseData.opts.kind, 'invalidResponse');

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
  assert.ok(responseData.message.includes('bị chặn'));
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
      expiresAt: 1793955755,
    };
    ctx.cacheSet(`st:vid_${j}`, streamData, 300000);
  }

  assert.ok(totalBytes < QUOTA, `Storage totalBytes (${totalBytes}) must be within quota (${QUOTA})`);
  assert.ok(totalBytes > 0);
  console.log(`  Storage used by 5 search + 10 stream items: ${totalBytes} B (quota: ${QUOTA} B)`);
});

console.log(`\nAll ${passedTests} offline tests passed successfully.`);
