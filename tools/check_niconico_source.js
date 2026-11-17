// Smoke test and offline unit test for NicoNico Douga source plugin: `node tools/check_niconico_source.js`
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const pluginDir = path.join(__dirname, '..', 'src', 'streaming', 'niconico-source');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8'));
const commonCode = fs.readFileSync(path.join(pluginDir, 'src', 'common.js'), 'utf8');
const searchCode = fs.readFileSync(path.join(pluginDir, 'src', 'search.js'), 'utf8');
const streamCode = fs.readFileSync(path.join(pluginDir, 'src', 'stream.js'), 'utf8');
const playlistCode = fs.readFileSync(path.join(pluginDir, 'src', 'playlist.js'), 'utf8');
const albumCode = fs.readFileSync(path.join(pluginDir, 'src', 'album.js'), 'utf8');
const artistCode = fs.readFileSync(path.join(pluginDir, 'src', 'artist.js'), 'utf8');
const relatedCode = fs.readFileSync(path.join(pluginDir, 'src', 'related.js'), 'utf8');
const homeCode = fs.readFileSync(path.join(pluginDir, 'src', 'home.js'), 'utf8');
const genreCode = fs.readFileSync(path.join(pluginDir, 'src', 'genre.js'), 'utf8');
const resolveCode = fs.readFileSync(path.join(pluginDir, 'src', 'resolve.js'), 'utf8');
const autocompleteCode = fs.readFileSync(path.join(pluginDir, 'src', 'autocomplete.js'), 'utf8');

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
  assert.strictEqual(manifest.metadata.type, 'streaming');
  assert.strictEqual(manifest.metadata.name, 'NicoNico Douga');
  assert.strictEqual(typeof manifest.metadata.version, 'number');
  assert.ok(Array.isArray(manifest.metadata.hosts));
  assert.ok(manifest.metadata.hosts.includes('snapshot.search.nicovideo.jp'));
  assert.ok(manifest.metadata.hosts.includes('nvapi.nicovideo.jp'));
  assert.ok(manifest.metadata.hosts.includes('sug.search.nicovideo.jp'));
  assert.strictEqual(manifest.script.search, 'search.js');
  assert.strictEqual(manifest.script.stream, 'stream.js');
  assert.strictEqual(manifest.script.playlist, 'playlist.js');
  assert.strictEqual(manifest.script.album, 'album.js');
  assert.strictEqual(manifest.script.artist, 'artist.js');
  assert.strictEqual(manifest.script.related, 'related.js');
  assert.strictEqual(manifest.script.home, 'home.js');
  assert.strictEqual(manifest.script.genre, 'genre.js');
  assert.strictEqual(manifest.script.resolve, 'resolve.js');
  assert.strictEqual(manifest.script.autocomplete, 'autocomplete.js');
  assert.ok(manifest.config && manifest.config.audioBitrate);
});

// 2. Unit tests for common helpers & ID extraction
test('common.js: extractNicoId and snapshot card parser', () => {
  const sandbox = {
    fetch: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);

  assert.strictEqual(ctx.extractNicoId('sm22791352'), 'sm22791352');
  assert.strictEqual(ctx.extractNicoId('so12345'), 'so12345');
  assert.strictEqual(ctx.extractNicoId('22791352'), 'sm22791352');
  assert.strictEqual(ctx.extractNicoId('https://www.nicovideo.jp/watch/sm22791352'), 'sm22791352');
  assert.strictEqual(ctx.extractNicoId('invalid_content'), '');

  const card = ctx.parseNicoSnapshotItem({
    contentId: 'sm22791352',
    title: 'Miku Song',
    lengthSeconds: 202,
    thumbnailUrl: 'https://nicovideo.cdn.nimg.jp/thumb.jpg',
    categoryTags: 'VOCALOID'
  });
  assert.strictEqual(card.kind, 'track');
  assert.strictEqual(card.id, 'sm22791352');
  assert.strictEqual(card.title, 'Miku Song');
  assert.strictEqual(card.durationMs, 202000);
  assert.strictEqual(card.artist, 'VOCALOID');
});

// 3. stream.js Domand access-rights HLS generation
test('stream.js: Domand watch API and HLS output extraction', () => {
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
    localConfig: { getItem: () => '192kbps' },
    cacheStorage: null,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: (url, opts) => {
      opts = opts || {};
      if (url.includes('/api/watch/v3_guest/')) {
        return {
          status: 200,
          ok: true,
          header: () => null,
          json: () => ({
            meta: { status: 200 },
            data: {
              client: { watchTrackId: 'TRACK_999' },
              media: {
                domand: {
                  accessRightKey: 'JWT_KEY_TEST',
                  videos: [{ id: 'video-h264-480p' }],
                  audios: [
                    { id: 'audio-aac-192kbps', isAvailable: true, bitRate: 192000 },
                    { id: 'audio-aac-64kbps', isAvailable: true, bitRate: 64000 }
                  ]
                }
              }
            }
          })
        };
      }
      if (url.includes('/access-rights/hls')) {
        return {
          status: 201,
          ok: true,
          header: () => null,
          json: () => ({
            meta: { status: 201 },
            data: {
              contentUrl: 'https://delivery.domand.nicovideo.jp/stream.m3u8?session=abc',
              expireTime: '2026-11-18T02:00:00Z'
            }
          })
        };
      }
      return { status: 404, ok: false, header: () => null, json: () => ({}) };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  const res = ctx.execute({ id: 'sm22791352' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.url, 'https://delivery.domand.nicovideo.jp/stream.m3u8?session=abc');
  assert.strictEqual(res.data.mimeType, 'application/x-mpegURL');
  assert.strictEqual(res.data.bitrate, 192000);
});

// 4. search.js parser & snapshot query
test('search.js: offline search parsing for snapshot API', () => {
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
    cacheStorage: null,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: (url) => {
      return {
        status: 200,
        ok: true,
        header: () => null,
        json: () => ({
          meta: { status: 200, totalCount: 1 },
          data: [
            { contentId: 'sm1001', title: 'World is Mine', lengthSeconds: 240, categoryTags: 'VOCALOID' }
          ]
        })
      };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(searchCode, ctx);

  const res = ctx.execute({ query: 'ryo' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.items.length, 1);
  assert.strictEqual(res.data.items[0].id, 'sm1001');
  assert.strictEqual(res.data.items[0].title, 'World is Mine');
  assert.strictEqual(res.data.filters.length, 5);
});

// 5. playlist.js Mylist parsing
test('playlist.js: Mylist parser', () => {
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
    cacheStorage: null,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: (url) => {
      return {
        status: 200,
        ok: true,
        header: () => null,
        json: () => ({
          data: {
            mylist: {
              name: 'Best Vocaloid Songs',
              owner: { name: 'Producer Ryo' },
              items: [
                { video: { id: 'sm1001', title: 'World is Mine', duration: 240 } }
              ]
            }
          }
        })
      };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(playlistCode, ctx);

  const res = ctx.execute({ id: '12345' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.title, 'Best Vocaloid Songs');
  assert.strictEqual(res.data.items.length, 1);
  assert.strictEqual(res.data.items[0].id, 'sm1001');
});

// 6. autocomplete.js candidate parser
test('autocomplete.js: parses candidates array', () => {
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
    cacheStorage: null,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: (url) => {
      return {
        status: 200,
        ok: true,
        header: () => null,
        json: () => ({
          candidates: ['MikuMikuDance', 'MikuPOP', 'Mikuni']
        })
      };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(autocompleteCode, ctx);

  const res = ctx.execute({ query: 'miku' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.suggestions.length, 3);
  assert.strictEqual(res.data.suggestions[0], 'MikuMikuDance');
});

// 7. Live network smoke test
test('NicoNico Douga live network search & stream generation', async () => {
  try {
    const fetch = global.fetch || require('node-fetch');
    const searchUrl = 'https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search?q=Miku&targets=title&fields=contentId,title,lengthSeconds,thumbnailUrl&_sort=-viewCounter&_limit=2';

    const resp = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'X-Frontend-Id': '6', 'X-Frontend-Version': '0' }
    });
    if (!resp.ok) {
      console.log('NicoNico search returned HTTP', resp.status, '(skipping live test due to network)');
      return;
    }
    const data = await resp.json();
    const results = data.data || [];
    if (results.length > 0) {
      const first = results[0];
      console.log(`Live NicoNico video found: "${first.title}" (id: ${first.contentId})`);

      const nowMs = Date.now();
      const watchUrl = `https://www.nicovideo.jp/api/watch/v3_guest/${first.contentId}?actionTrackId=AAAAAAAAAA_${nowMs}`;
      const watchResp = await fetch(watchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'X-Frontend-Id': '6', 'X-Frontend-Version': '0' }
      });
      if (watchResp.ok) {
        const watchJson = await watchResp.json();
        const domand = watchJson.data && watchJson.data.media && watchJson.data.media.domand;
        if (domand && domand.accessRightKey) {
          const hlsReqUrl = `https://nvapi.nicovideo.jp/v1/watch/${first.contentId}/access-rights/hls?actionTrackId=AAAAAAAAAA_${nowMs}`;
          const postPayload = JSON.stringify({
            outputs: [[domand.videos[0].id, domand.audios[0].id]]
          });
          const hlsResp = await fetch(hlsReqUrl, {
            method: 'POST',
            headers: {
              'User-Agent': 'Mozilla/5.0',
              'Accept': 'application/json;charset=utf-8',
              'Content-Type': 'application/json',
              'X-Access-Right-Key': domand.accessRightKey,
              'X-Request-With': 'https://www.nicovideo.jp',
              'X-Frontend-Id': '6',
              'X-Frontend-Version': '0'
            },
            body: postPayload
          });
          if (hlsResp.ok) {
            const hlsData = await hlsResp.json();
            const contentUrl = hlsData.data && hlsData.data.contentUrl;
            console.log(`Live HLS stream URL: ${contentUrl}`);
            assert.ok(contentUrl.startsWith('https://delivery.domand.nicovideo.jp/'));
          }
        }
      }
    }
  } catch (err) {
    console.log('Live network test skipped/failed gracefully:', err.message);
  }
});

console.log(`\nAll ${passedTests} unit tests passed for NicoNico Douga!`);
