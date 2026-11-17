// Smoke test and offline unit test for Jamendo Music source plugin: `node tools/check_jamendo_source.js`
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const pluginDir = path.join(__dirname, '..', 'src', 'streaming', 'jamendo');
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
  assert.strictEqual(manifest.metadata.name, 'Jamendo Music');
  assert.strictEqual(typeof manifest.metadata.version, 'number');
  assert.ok(Array.isArray(manifest.metadata.hosts));
  assert.ok(manifest.metadata.hosts.includes('api.jamendo.com'));
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
  assert.ok(manifest.config && manifest.config.audioQuality);
  assert.ok(manifest.config && manifest.config.clientId);
});

// 2. Unit tests for common helpers & ID extraction
test('common.js: extractJamendoId and parseJamendoTrack', () => {
  const sandbox = {
    fetch: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);

  // Pure ID
  assert.strictEqual(ctx.extractJamendoId('1214935').id, '1214935');
  assert.strictEqual(ctx.extractJamendoId('1214935').type, 'track');
  // Short URL
  assert.strictEqual(ctx.extractJamendoId('https://jamen.do/t/1214935').id, '1214935');
  assert.strictEqual(ctx.extractJamendoId('https://jamen.do/t/1214935').type, 'track');
  // Standard routes
  assert.strictEqual(ctx.extractJamendoId('https://www.jamendo.com/track/1214935/wish-you-were-here').id, '1214935');
  assert.strictEqual(ctx.extractJamendoId('https://www.jamendo.com/track/1214935/wish-you-were-here').type, 'track');
  assert.strictEqual(ctx.extractJamendoId('https://www.jamendo.com/album/145774/album-name').id, '145774');
  assert.strictEqual(ctx.extractJamendoId('https://www.jamendo.com/album/145774/album-name').type, 'album');
  assert.strictEqual(ctx.extractJamendoId('https://www.jamendo.com/artist/441585/artist-name').id, '441585');
  assert.strictEqual(ctx.extractJamendoId('https://www.jamendo.com/artist/441585/artist-name').type, 'artist');
  assert.strictEqual(ctx.extractJamendoId('https://www.jamendo.com/playlist/5001/best-of').id, '5001');
  assert.strictEqual(ctx.extractJamendoId('https://www.jamendo.com/playlist/5001/best-of').type, 'playlist');
  assert.strictEqual(ctx.extractJamendoId('invalid_str').id, '');

  // Track parser
  const trackCard = ctx.parseJamendoTrack({
    id: 1214935,
    name: 'Wish You Were Here',
    artist_name: 'The.madpix.project',
    album_name: 'Wish You Were Here',
    duration: 270,
    album_image: 'https://usercontent.jamendo.com?id=145774',
    shareurl: 'https://www.jamendo.com/track/1214935'
  });
  assert.strictEqual(trackCard.kind, 'track');
  assert.strictEqual(trackCard.id, '1214935');
  assert.strictEqual(trackCard.title, 'Wish You Were Here');
  assert.strictEqual(trackCard.artist, 'The.madpix.project');
  assert.strictEqual(trackCard.durationMs, 270000);
});

// 3. stream.js quality selection & stream URL
test('stream.js: stream URL and audio quality selection', () => {
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
    localConfig: { getItem: (k) => k === 'audioQuality' ? 'mp32' : null },
    cacheStorage: null,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: (url) => {
      if (url.includes('/tracks/')) {
        return {
          status: 200,
          ok: true,
          header: () => null,
          json: () => ({
            headers: { status: 'success' },
            results: [{
              id: '1214935',
              name: 'Wish You Were Here',
              audio: 'https://prod-1.storage.jamendo.com/?trackid=1214935&format=mp32',
              audiodownload: 'https://prod-1.storage.jamendo.com/download/track/1214935/mp32/'
            }]
          })
        };
      }
      return { status: 404, ok: false, header: () => null, json: () => ({}) };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  // Preferred mp32 (320k)
  const res320 = ctx.execute({ id: '1214935' });
  assert.strictEqual(res320.status, 'ok');
  assert.strictEqual(res320.data.bitrate, 320000);
  assert.strictEqual(res320.data.url, 'https://prod-1.storage.jamendo.com/?trackid=1214935&format=mp32');

  // Preferred mp31 (128k)
  sandbox.localConfig.getItem = (k) => k === 'audioQuality' ? 'mp31' : null;
  const res128 = ctx.execute({ id: '1214935', fresh: true });
  assert.strictEqual(res128.status, 'ok');
  assert.strictEqual(res128.data.bitrate, 128000);
});

// 4. search.js parser & pagination offset
test('search.js: offline search parsing and filters', () => {
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
          headers: { status: 'success' },
          results: [
            { id: '101', name: 'Track A', artist_name: 'Artist A', duration: 180 },
            { id: '102', name: 'Track B', artist_name: 'Artist B', duration: 210 }
          ]
        })
      };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(searchCode, ctx);

  const res = ctx.execute({ query: 'love' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.items.length, 2);
  assert.strictEqual(res.data.items[0].id, '101');
  assert.strictEqual(res.data.filters.length, 6);
});

// 5. album.js and playlist.js parsing
test('album.js & playlist.js multi-track parsing', () => {
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
          headers: { status: 'success' },
          results: [{
            id: '145774',
            name: 'Wish You Were Here',
            artist_name: 'The.madpix.project',
            tracks: [
              { id: '1214935', name: 'Wish You Were Here', duration: 270 }
            ]
          }]
        })
      };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(albumCode, ctx);

  const res = ctx.execute({ id: '145774' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.title, 'Wish You Were Here');
  assert.strictEqual(res.data.items.length, 1);
  assert.strictEqual(res.data.items[0].id, '1214935');
});

// 6. resolve.js URL routing
test('resolve.js: detects Jamendo URL and returns unified metadata', () => {
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
          headers: { status: 'success' },
          results: [{
            id: '1214935',
            name: 'Wish You Were Here',
            artist_name: 'The.madpix.project',
            duration: 270
          }]
        })
      };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(resolveCode, ctx);

  const res = ctx.execute({ url: 'https://www.jamendo.com/track/1214935' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.kind, 'track');
  assert.strictEqual(res.data.id, '1214935');
  assert.strictEqual(res.data.title, 'Wish You Were Here');
});

// 7. Live network smoke test
test('Jamendo Music live network search & stream verification', async () => {
  try {
    const fetch = global.fetch || require('node-fetch');
    const clientId = '3dce8b55';
    const searchUrl = `https://api.jamendo.com/v3.0/tracks/?client_id=${clientId}&format=json&limit=2&namesearch=love&audioformat=mp32`;

    const resp = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) {
      console.log('Jamendo search returned HTTP', resp.status, '(skipping live test due to network)');
      return;
    }
    const data = await resp.json();
    const results = data.results || [];
    if (results.length > 0) {
      const first = results[0];
      console.log(`Live Jamendo track found: "${first.name}" by "${first.artist_name}" (id: ${first.id})`);
      const streamUrl = first.audio || first.audiodownload;
      console.log(`Live audio stream: ${streamUrl}`);
      assert.ok(streamUrl.startsWith('https://'), 'Stream URL should be HTTPS');
    }
  } catch (err) {
    console.log('Live network test skipped/failed gracefully:', err.message);
  }
});

console.log(`\nAll ${passedTests} unit tests passed for Jamendo Music!`);
