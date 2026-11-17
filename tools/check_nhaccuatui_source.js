// Smoke test and offline unit test for NhacCuaTui source plugin: `node tools/check_nhaccuatui_source.js`
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const pluginDir = path.join(__dirname, '..', 'src', 'streaming', 'nhaccuatui-source');
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
  assert.strictEqual(manifest.metadata.name, 'NhacCuaTui');
  assert.strictEqual(typeof manifest.metadata.version, 'number');
  assert.ok(Array.isArray(manifest.metadata.hosts));
  assert.ok(manifest.metadata.hosts.includes('graph.nhaccuatui.com'));
  assert.ok(manifest.metadata.hosts.includes('stream.nct.vn'));
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
  assert.ok(manifest.config && manifest.config.quality);
});

// 2. Unit tests for common helpers & key extraction
test('common.js: extractNctKey and card parsers', () => {
  const sandbox = {
    fetch: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);

  // Key extraction
  assert.strictEqual(ctx.extractNctKey('CTCrPh2Yblky'), 'CTCrPh2Yblky');
  assert.strictEqual(ctx.extractNctKey('https://www.nhaccuatui.com/bai-hat/waiting-for-love-avicii.CTCrPh2Yblky.html'), 'CTCrPh2Yblky');
  assert.strictEqual(ctx.extractNctKey('https://www.nhaccuatui.com/song/CTCrPh2Yblky'), 'CTCrPh2Yblky');
  assert.strictEqual(ctx.extractNctKey('https://www.nhaccuatui.com/playlist/top-100-pop.1704876910JwGr.html'), '1704876910JwGr');
  assert.strictEqual(ctx.extractNctKey('https://www.nhaccuatui.com/playlist/1704876910JwGr'), '1704876910JwGr');
  assert.strictEqual(ctx.extractNctKey('https://www.nhaccuatui.com/artist/432378'), '432378');
  assert.strictEqual(ctx.extractNctKey('invalid_short'), '');

  // Card parser: track
  const track = ctx.parseTrackCard({
    key: 'CTCrPh2Yblky',
    name: 'Waiting For Love',
    artistName: 'Avicii',
    duration: 230,
    image: 'https://image-cdn.nct.vn/song/test.jpg'
  });
  assert.strictEqual(track.kind, 'track');
  assert.strictEqual(track.id, 'CTCrPh2Yblky');
  assert.strictEqual(track.title, 'Waiting For Love');
  assert.strictEqual(track.artist, 'Avicii');
  assert.strictEqual(track.durationMs, 230000);
  assert.strictEqual(track.artworkUrl, 'https://image-cdn.nct.vn/song/test.jpg');

  // Card parser: playlist
  const pl = ctx.parsePlaylistCard({
    key: '1704876910JwGr',
    name: 'Top 100',
    totalSongs: 100,
    artistName: 'NCT'
  });
  assert.strictEqual(pl.kind, 'playlist');
  assert.strictEqual(pl.id, '1704876910JwGr');
  assert.strictEqual(pl.title, 'Top 100');
});

// 3. stream.js quality selection and expiration parsing
test('stream.js: audio stream extraction, quality selector, and expire timestamp', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  const mockSongData = {
    key: 'CTCrPh2Yblky',
    name: 'Waiting For Love',
    streamURL: [
      {
        download: 'https://stream.nct.vn/audio_128.mp3?e=1795444260',
        stream: 'https://stream.nct.vn/audio_128.mp3?e=1795444260',
        type: '128',
        onlyVIP: false
      },
      {
        download: 'https://stream.nct.vn/audio_320.mp3?e=1795444260',
        stream: 'https://stream.nct.vn/audio_320.mp3?e=1795444260',
        type: '320',
        onlyVIP: false
      }
    ]
  };

  const sandbox = {
    Response: mockResponse,
    load: (f) => {
      if (f === 'common.js') vm.runInContext(commonCode, ctx);
    },
    localConfig: { getItem: () => '320 kbps' },
    cacheStorage: null,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: (url) => {
      if (url.includes('/song/detail/CTCrPh2Yblky')) {
        return {
          status: 200,
          ok: true,
          header: () => null,
          json: () => ({ code: 0, data: mockSongData })
        };
      }
      return { status: 404, ok: false, header: () => null, json: () => ({ code: 224 }) };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  // Preferred 320 kbps
  const res320 = ctx.execute({ id: 'CTCrPh2Yblky' });
  assert.strictEqual(res320.status, 'ok');
  assert.strictEqual(res320.data.bitrate, 320000);
  assert.strictEqual(res320.data.url, 'https://stream.nct.vn/audio_320.mp3?e=1795444260');
  assert.strictEqual(res320.data.expiresAtMs, 1795444260 * 1000);

  // Preferred 128 kbps
  sandbox.localConfig.getItem = () => '128 kbps';
  const res128 = ctx.execute({ id: 'CTCrPh2Yblky', fresh: true });
  assert.strictEqual(res128.status, 'ok');
  assert.strictEqual(res128.data.bitrate, 128000);
  assert.strictEqual(res128.data.url, 'https://stream.nct.vn/audio_128.mp3?e=1795444260');
});

// 4. search.js parser & unified multi-section results
test('search.js: offline search parsing for all categories and filters', () => {
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
      if (url.includes('/search/all')) {
        return {
          status: 200,
          ok: true,
          header: () => null,
          json: () => ({
            code: 0,
            data: {
              songs: [{ key: 'song1', name: 'Song 1', artistName: 'Artist 1', duration: 180 }],
              playlists: [{ key: 'pl1', name: 'Playlist 1', totalSongs: 10, artistName: 'Artist 1' }],
              artists: [{ key: 'art1', name: 'Artist 1', national: 'Vietnam' }]
            }
          })
        };
      }
      return { status: 404, ok: false, header: () => null, json: () => ({ code: 224 }) };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(searchCode, ctx);

  const res = ctx.execute({ query: 'Artist 1' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.sections.length, 3);
  assert.strictEqual(res.data.sections[0].title, 'Bài hát');
  assert.strictEqual(res.data.sections[1].title, 'Danh sách phát');
  assert.strictEqual(res.data.sections[2].title, 'Nghệ sĩ');
  assert.strictEqual(res.data.items.length, 3);
});

// 5. playlist.js & album.js verification
test('playlist.js and album.js parsing', () => {
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
      if (url.includes('/playlist/detail/1704876910JwGr')) {
        return {
          status: 200,
          ok: true,
          header: () => null,
          json: () => ({
            code: 0,
            data: {
              key: '1704876910JwGr',
              name: 'Top 100 Pop',
              artistName: 'Various Artists',
              listSong: [
                { key: 's1', name: 'Track 1', artistName: 'Singer 1', duration: 200 }
              ]
            }
          })
        };
      }
      return { status: 404, ok: false, header: () => null, json: () => ({ code: 224 }) };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);

  // Test playlist.js
  vm.runInContext(playlistCode, ctx);
  const pRes = ctx.execute({ id: '1704876910JwGr' });
  assert.strictEqual(pRes.status, 'ok');
  assert.strictEqual(pRes.data.title, 'Top 100 Pop');
  assert.strictEqual(pRes.data.items.length, 1);

  // Test album.js
  vm.runInContext(albumCode, ctx);
  const aRes = ctx.execute({ id: '1704876910JwGr' });
  assert.strictEqual(aRes.status, 'ok');
  assert.strictEqual(aRes.data.info.title, 'Top 100 Pop');
  assert.strictEqual(aRes.data.tracks.length, 1);
});

// 6. related.js and home.js
test('related.js and home.js parsing', () => {
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
      if (url.includes('/song/similar/CTCrPh2Yblky')) {
        return {
          status: 200,
          ok: true,
          header: () => null,
          json: () => ({
            code: 0,
            data: {
              list: [{ key: 'sim1', name: 'Similar Track', artistName: 'Avicii', duration: 190 }]
            }
          })
        };
      }
      if (url.includes('/app/playlist/top-100')) {
        return {
          status: 200,
          ok: true,
          header: () => null,
          json: () => ({
            code: 0,
            data: [
              {
                area: 'US-UK',
                data: [{ key: 'top1', name: 'Top 100 US-UK', artistName: 'Various Artists' }]
              }
            ]
          })
        };
      }
      return { status: 404, ok: false, header: () => null, json: () => ({ code: 224 }) };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);

  // Related
  vm.runInContext(relatedCode, ctx);
  const relRes = ctx.execute({ id: 'CTCrPh2Yblky' });
  assert.strictEqual(relRes.status, 'ok');
  assert.strictEqual(relRes.data.items.length, 1);
  assert.strictEqual(relRes.data.items[0].title, 'Similar Track');

  // Home
  vm.runInContext(homeCode, ctx);
  const homeRes = ctx.execute({});
  assert.strictEqual(homeRes.status, 'ok');
  assert.strictEqual(homeRes.data.sections.length, 1);
  assert.ok(homeRes.data.sections[0].title.includes('US-UK'));
});

// 7. resolve.js URL parser
test('resolve.js parses NhacCuaTui URLs', () => {
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
      if (url.includes('/song/detail/CTCrPh2Yblky')) {
        return {
          status: 200,
          ok: true,
          header: () => null,
          json: () => ({
            code: 0,
            data: { key: 'CTCrPh2Yblky', name: 'Waiting For Love', artistName: 'Avicii' }
          })
        };
      }
      return { status: 404, ok: false, header: () => null, json: () => ({ code: 224 }) };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(resolveCode, ctx);

  const res = ctx.execute({ url: 'https://www.nhaccuatui.com/bai-hat/waiting-for-love-avicii.CTCrPh2Yblky.html' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.id, 'CTCrPh2Yblky');
  assert.strictEqual(res.data.title, 'Waiting For Love');
});

console.log(`\nAll ${passedTests} tests passed successfully.`);
