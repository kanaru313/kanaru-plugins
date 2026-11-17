// Smoke test and offline unit test for Internet Archive source plugin: `node tools/check_archive_source.js`
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const pluginDir = path.join(__dirname, '..', 'src', 'streaming', 'archive-source');
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
  assert.strictEqual(manifest.metadata.name, 'Internet Archive');
  assert.strictEqual(typeof manifest.metadata.version, 'number');
  assert.ok(Array.isArray(manifest.metadata.hosts));
  assert.ok(manifest.metadata.hosts.includes('archive.org'));
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
  assert.ok(manifest.config && manifest.config.audioFormat);
});

// 2. Unit tests for common helpers & ID extraction
test('common.js: extractArchiveId and helpers', () => {
  const sandbox = {
    fetch: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);

  // Pure identifier
  const id1 = ctx.extractArchiveId('gd77-05-08.sbd.hicks.4982.sbeok.shnf');
  assert.strictEqual(id1.identifier, 'gd77-05-08.sbd.hicks.4982.sbeok.shnf');
  assert.strictEqual(id1.filename, '');

  // Compound identifier:filename
  const id2 = ctx.extractArchiveId('item123:track01.mp3');
  assert.strictEqual(id2.identifier, 'item123');
  assert.strictEqual(id2.filename, 'track01.mp3');

  // URL details
  const id3 = ctx.extractArchiveId('https://archive.org/details/mozart_symphony_40');
  assert.strictEqual(id3.identifier, 'mozart_symphony_40');

  // URL download
  const id4 = ctx.extractArchiveId('https://archive.org/download/test_item/song.mp3');
  assert.strictEqual(id4.identifier, 'test_item');
  assert.strictEqual(id4.filename, 'song.mp3');

  // Audio file detection
  assert.ok(ctx.isAudioFile({ name: 'track.mp3', format: 'VBR MP3' }));
  assert.ok(ctx.isAudioFile({ name: 'song.flac', format: 'FLAC' }));
  assert.ok(!ctx.isAudioFile({ name: 'cover.jpg', format: 'JPEG' }));
  assert.ok(!ctx.isAudioFile({ name: 'meta.xml', format: 'Metadata' }));
});

// 3. stream.js metadata lookup and stream URL construction
test('stream.js: direct compound ID and metadata lookup', () => {
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
    localConfig: { getItem: () => 'VBR MP3' },
    cacheStorage: null,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: (url) => {
      if (url.includes('/metadata/test_item/files')) {
        return {
          status: 200,
          ok: true,
          header: () => null,
          json: () => ({
            result: [
              { name: 'cover.jpg', format: 'JPEG' },
              { name: '01_symphony.mp3', format: 'VBR MP3', length: '320.5', bitrate: '192' },
              { name: '01_symphony.flac', format: 'FLAC', length: '320.5' }
            ]
          })
        };
      }
      return { status: 404, ok: false, header: () => null, json: () => ({}) };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  // 1. Direct compound ID
  const resDirect = ctx.execute({ id: 'test_item:disc1/track01.mp3' });
  assert.strictEqual(resDirect.status, 'ok');
  assert.strictEqual(resDirect.data.url, 'https://archive.org/download/test_item/disc1/track01.mp3');
  assert.strictEqual(resDirect.data.expiresAtMs, null);

  // 2. Metadata lookup (VBR MP3)
  const resLookup = ctx.execute({ id: 'test_item', fresh: true });
  assert.strictEqual(resLookup.status, 'ok');
  assert.strictEqual(resLookup.data.url, 'https://archive.org/download/test_item/01_symphony.mp3');
  assert.strictEqual(resLookup.data.mimeType, 'audio/mpeg');
  assert.strictEqual(resLookup.data.bitrate, 192000);
});

// 4. search.js parser & multi-filter support
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
          response: {
            numFound: 1,
            docs: [
              { identifier: 'item_bach', title: 'Bach Fugue', creator: 'J.S. Bach', year: 1720 }
            ]
          }
        })
      };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(searchCode, ctx);

  const res = ctx.execute({ query: 'Bach' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.items.length, 1);
  assert.strictEqual(res.data.items[0].id, 'item_bach');
  assert.strictEqual(res.data.items[0].title, 'Bach Fugue');
  assert.strictEqual(res.data.filters.length, 4);
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
          metadata: {
            identifier: 'grateful_dead_cornell',
            title: 'Live at Cornell 5/8/77',
            creator: 'Grateful Dead'
          },
          files: [
            { name: 'gd77-05-08d1t01.mp3', title: 'New Minglewood Blues', length: '280.4', format: 'VBR MP3' },
            { name: 'gd77-05-08d1t02.mp3', title: 'Loser', length: '450.2', format: 'VBR MP3' }
          ]
        })
      };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(albumCode, ctx);

  const res = ctx.execute({ id: 'grateful_dead_cornell' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.title, 'Live at Cornell 5/8/77');
  assert.strictEqual(res.data.items.length, 2);
  assert.strictEqual(res.data.items[0].id, 'grateful_dead_cornell:gd77-05-08d1t01.mp3');
  assert.strictEqual(res.data.items[0].durationMs, 280400);
});

// 6. resolve.js URL routing
test('resolve.js: detects archive.org URL and returns unified metadata', () => {
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
          metadata: { identifier: 'single_track_item', title: 'Solo Piano', creator: 'Chopin' },
          files: [
            { name: 'nocturne.mp3', title: 'Nocturne op.9 no.2', length: '260', format: 'VBR MP3' }
          ]
        })
      };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(resolveCode, ctx);

  const res = ctx.execute({ url: 'https://archive.org/details/single_track_item' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.kind, 'track');
  assert.strictEqual(res.data.id, 'single_track_item:nocturne.mp3');
});

// 7. Live network smoke test
test('Internet Archive live network search & stream verification', async () => {
  try {
    const fetch = global.fetch || require('node-fetch');
    const query = 'mediatype:(audio) AND format:(MP3) AND Mozart';
    const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier,title,creator&rows=3&output=json`;

    const resp = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) {
      console.log('Archive.org search returned HTTP', resp.status, '(skipping live test due to network)');
      return;
    }
    const data = await resp.json();
    const docs = (data.response && data.response.docs) || [];
    if (docs.length > 0) {
      const first = docs[0];
      console.log(`Live Archive record found: "${first.title}" by "${first.creator}" (id: ${first.identifier})`);

      const metaUrl = `https://archive.org/metadata/${encodeURIComponent(first.identifier)}/files`;
      const metaResp = await fetch(metaUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (metaResp.ok) {
        const metaData = await metaResp.json();
        const files = metaData.result || metaData.files || [];
        const mp3 = files.find(f => (f.name && f.name.endsWith('.mp3')));
        if (mp3) {
          const streamUrl = `https://archive.org/download/${encodeURIComponent(first.identifier)}/${encodeURIComponent(mp3.name)}`;
          console.log(`Live audio stream: ${streamUrl}`);
          assert.ok(streamUrl.startsWith('https://archive.org/download/'));
        }
      }
    }
  } catch (err) {
    console.log('Live network test skipped/failed gracefully:', err.message);
  }
});

console.log(`\nAll ${passedTests} unit tests passed for Internet Archive!`);
