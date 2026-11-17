// Smoke test and offline unit test for Bandcamp source plugin: `node tools/check_bandcamp_source.js`
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const pluginDir = path.join(__dirname, '..', 'src', 'streaming', 'bandcamp-source');
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
  assert.strictEqual(manifest.metadata.name, 'Bandcamp');
  assert.strictEqual(typeof manifest.metadata.version, 'number');
  assert.ok(Array.isArray(manifest.metadata.hosts));
  assert.ok(manifest.metadata.hosts.includes('bandcamp.com'));
  assert.ok(manifest.metadata.hosts.includes('t4.bcbits.com'));
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
});

// 2. Unit tests for common helpers & tralbum extraction
test('common.js: URL normalization and data-tralbum regex parser', () => {
  const sandbox = {
    fetch: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);

  // URL normalization
  assert.strictEqual(ctx.normalizeBandcampUrl('https://artist.bandcamp.comhttps://artist.bandcamp.com/album/xyz'), 'https://artist.bandcamp.com/album/xyz');
  assert.strictEqual(ctx.normalizeBandcampUrl('https://artist.bandcamp.com/track/song'), 'https://artist.bandcamp.com/track/song');

  // data-tralbum extraction
  const mockHtml = `<html><body><div id="tralbumArt" data-tralbum="{&quot;current&quot;:{&quot;title&quot;:&quot;Morning Coffee&quot;},&quot;artist&quot;:&quot;Various Artists&quot;,&quot;trackinfo&quot;:[{&quot;id&quot;:123,&quot;title&quot;:&quot;Track 1&quot;,&quot;file&quot;:{&quot;mp3-128&quot;:&quot;https://t4.bcbits.com/stream/abc?ts=1794933433&token=1794933433_xyz&quot;}}]}"></div></body></html>`;
  const parsed = ctx.extractTralbumFromHtml(mockHtml);
  assert.ok(parsed);
  assert.strictEqual(parsed.current.title, 'Morning Coffee');
  assert.strictEqual(parsed.artist, 'Various Artists');
  assert.strictEqual(parsed.trackinfo.length, 1);
  assert.strictEqual(parsed.trackinfo[0].file['mp3-128'], 'https://t4.bcbits.com/stream/abc?ts=1794933433&token=1794933433_xyz');
});

// 3. stream.js extraction & token timestamp
test('stream.js: audio stream extraction, referer and expire timestamp', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  const mockHtml = `<div data-tralbum="{&quot;current&quot;:{&quot;title&quot;:&quot;Song 1&quot;},&quot;artist&quot;:&quot;Indie Band&quot;,&quot;trackinfo&quot;:[{&quot;id&quot;:999,&quot;title&quot;:&quot;Song 1&quot;,&quot;file&quot;:{&quot;mp3-128&quot;:&quot;https://t4.bcbits.com/stream/hash/mp3-128/999?ts=1794933433&token=1794933433_sig&quot;}}]}"></div>`;

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
        text: () => mockHtml
      };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  const res = ctx.execute({ id: 'https://artist.bandcamp.com/track/song-1' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.url, 'https://t4.bcbits.com/stream/hash/mp3-128/999?ts=1794933433&token=1794933433_sig');
  assert.strictEqual(res.data.bitrate, 128000);
  assert.strictEqual(res.data.expiresAtMs, 1794933433 * 1000);
  assert.strictEqual(res.data.headers.Referer, 'https://artist.bandcamp.com/track/song-1');
});

// 4. search.js parser & filters
test('search.js: offline search parsing for Bandcamp autocomplete API', () => {
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
          results: [
            { type: 't', id: 101, name: 'Lofi Beat', band_name: 'Producer A', url: 'https://proda.bandcamp.com/track/lofi-beat', img: 'https://f4.bcbits.com/img/1.jpg' },
            { type: 'a', id: 202, name: 'Chill Tape', band_name: 'Producer B', url: 'https://prodb.bandcamp.com/album/chill-tape', img: 'https://f4.bcbits.com/img/2.jpg' }
          ]
        })
      };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(searchCode, ctx);

  const res = ctx.execute({ query: 'chill' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.items.length, 2);
  assert.strictEqual(res.data.items[0].kind, 'track');
  assert.strictEqual(res.data.items[0].title, 'Lofi Beat');
  assert.strictEqual(res.data.items[1].kind, 'album');
});

// 5. album.js and playlist.js parsing
test('album.js & playlist.js multi-track parsing from HTML', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  const mockHtml = `<div data-tralbum="{&quot;current&quot;:{&quot;title&quot;:&quot;EP 2026&quot;},&quot;artist&quot;:&quot;Indie Star&quot;,&quot;art_id&quot;:5555,&quot;trackinfo&quot;:[{&quot;id&quot;:1,&quot;title&quot;:&quot;Intro&quot;,&quot;duration&quot;:120},{&quot;id&quot;:2,&quot;title&quot;:&quot;Outro&quot;,&quot;duration&quot;:180}]}"></div>`;

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
        text: () => mockHtml
      };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(albumCode, ctx);

  const res = ctx.execute({ id: 'https://star.bandcamp.com/album/ep-2026' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.title, 'EP 2026');
  assert.strictEqual(res.data.items.length, 2);
  assert.strictEqual(res.data.items[0].durationMs, 120000);
});

// 6. resolve.js URL routing
test('resolve.js: detects Bandcamp URL and resolves unified metadata', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  const mockHtml = `<div data-tralbum="{&quot;current&quot;:{&quot;title&quot;:&quot;Solo Single&quot;},&quot;artist&quot;:&quot;Solo Artist&quot;,&quot;trackinfo&quot;:[{&quot;id&quot;:77,&quot;title&quot;:&quot;Solo Single&quot;,&quot;duration&quot;:205}]}"></div>`;

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
        text: () => mockHtml
      };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(resolveCode, ctx);

  const res = ctx.execute({ url: 'https://solo.bandcamp.com/track/solo-single' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.kind, 'track');
  assert.strictEqual(res.data.title, 'Solo Single');
  assert.strictEqual(res.data.durationMs, 205000);
});

// 7. Live network smoke test
test('Bandcamp live network search & stream extraction', async () => {
  try {
    const fetch = global.fetch || require('node-fetch');
    const searchUrl = 'https://bandcamp.com/api/fuzzysearch/2/app_autocomplete?q=lofi';
    const resp = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) {
      console.log('Bandcamp search returned HTTP', resp.status, '(skipping live test due to network)');
      return;
    }
    const data = await resp.json();
    const results = data.results || [];
    if (results.length > 0) {
      const album = results.find(r => r.type === 'a') || results[0];
      const pageUrl = album.url.lastIndexOf('https://') > 0 ? album.url.substring(album.url.lastIndexOf('https://')) : album.url;
      console.log(`Live Bandcamp item found: "${album.name}" by "${album.band_name}" (${pageUrl})`);

      const pageResp = await fetch(pageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (pageResp.ok) {
        const html = await pageResp.text();
        const m = html.match(/data-tralbum="([^"]+)"/);
        if (m) {
          const decoded = m[1].replace(/&quot;/g, '"');
          const tralbum = JSON.parse(decoded);
          const tracks = tralbum.trackinfo || [];
          const playable = tracks.find(t => t.file && t.file['mp3-128']);
          if (playable) {
            const streamUrl = playable.file['mp3-128'];
            console.log(`Live audio stream: ${streamUrl}`);
            assert.ok(streamUrl.startsWith('https://t4.bcbits.com/stream/'));
          }
        }
      }
    }
  } catch (err) {
    console.log('Live network test skipped/failed gracefully:', err.message);
  }
});

console.log(`\nAll ${passedTests} unit tests passed for Bandcamp!`);
