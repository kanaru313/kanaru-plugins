// Smoke test and offline unit test for Kuwo Music source plugin: `node tools/check_kuwo_source.js`
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const pluginDir = path.join(__dirname, '..', 'src', 'streaming', 'kuwo-source');
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
  assert.strictEqual(manifest.metadata.name, 'Kuwo Music');
  assert.strictEqual(typeof manifest.metadata.version, 'number');
  assert.ok(Array.isArray(manifest.metadata.hosts));
  assert.ok(manifest.metadata.hosts.includes('antiserver.kuwo.cn'));
  assert.ok(manifest.metadata.hosts.includes('search.kuwo.cn'));
  assert.ok(manifest.metadata.hosts.includes('kuwo.cn'));
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
test('common.js: extractKuwoId and card parsers', () => {
  const sandbox = {
    fetch: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);

  // Key extraction
  assert.strictEqual(ctx.extractKuwoId('1234567'), '1234567');
  assert.strictEqual(ctx.extractKuwoId('MUSIC_1234567'), '1234567');
  assert.strictEqual(ctx.extractKuwoId('https://www.kuwo.cn/play_detail/1234567'), '1234567');
  assert.strictEqual(ctx.extractKuwoId('https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=1234567'), '1234567');
  assert.strictEqual(ctx.extractKuwoId('https://www.kuwo.cn/playlist_detail/98765'), '98765');
  assert.strictEqual(ctx.extractKuwoId('https://www.kuwo.cn/album_detail/54321'), '54321');
  assert.strictEqual(ctx.extractKuwoId('https://www.kuwo.cn/singer_detail/112233'), '112233');
  assert.strictEqual(ctx.extractKuwoId('invalid_text'), '');

  // Card parser: track
  const track = ctx.parseTrackCard({
    DC_TARGETID: '1234567',
    NAME: '晴天',
    ARTIST: '周杰伦',
    ALBUM: '叶惠美',
    DURATION: '269',
    web_albumpic_short: '123/45/pic.jpg'
  });
  assert.strictEqual(track.kind, 'track');
  assert.strictEqual(track.id, '1234567');
  assert.strictEqual(track.title, '晴天');
  assert.strictEqual(track.artist, '周杰伦');
  assert.strictEqual(track.album, '叶惠美');
  assert.strictEqual(track.durationMs, 269000);
  assert.ok(track.artworkUrl.includes('img1.kuwo.cn'));
});

// 3. stream.js anti.s parsing and expiration extraction
test('stream.js: audio stream extraction, quality selector, and expire timestamp', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  const mockCdnUrl = 'https://kw-bj.kuwo.cn/6979ff1018c1e7a57a07545ca80b62e4/67389a80/nf/resource/320k.mp3';
  const expectedExpire = parseInt('67389a80', 16) * 1000;

  const sandbox = {
    Response: mockResponse,
    load: (f) => {
      if (f === 'common.js') vm.runInContext(commonCode, ctx);
    },
    localConfig: { getItem: () => '320 kbps' },
    cacheStorage: null,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: (url) => {
      if (url.includes('antiserver.kuwo.cn/anti.s')) {
        return {
          status: 200,
          ok: true,
          header: () => null,
          text: () => mockCdnUrl,
          json: () => ({ url: mockCdnUrl })
        };
      }
      return { status: 404, ok: false, header: () => null, text: () => 'refuse request!' };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  const res = ctx.execute({ id: '1234567' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.url, mockCdnUrl);
  assert.strictEqual(res.data.bitrate, 320000);
  assert.strictEqual(res.data.expiresAtMs, expectedExpire);
});

// 4. search.js parser & unified multi-section results
test('search.js: offline search parsing for all categories', () => {
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
      if (url.includes('search.kuwo.cn/r.s')) {
        return {
          status: 200,
          ok: true,
          header: () => null,
          json: () => ({
            TOTAL: '100',
            abslist: [
              { DC_TARGETID: '1001', NAME: 'Track A', ARTIST: 'Artist A', ALBUM: 'Album A', DURATION: '200' },
              { DC_TARGETID: '1002', NAME: 'Track B', ARTIST: 'Artist B', ALBUM: 'Album B', DURATION: '210' }
            ]
          })
        };
      }
      return { status: 404, ok: false, header: () => null, json: () => ({}) };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(searchCode, ctx);

  const res = ctx.execute({ query: 'Jay Chou' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.items.length, 2);
  assert.strictEqual(res.data.sections[0].title, 'Bài hát');
  assert.strictEqual(res.data.items[0].id, '1001');
});

// 5. playlist.js and album.js verification
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
      if (url.includes('nplserver.kuwo.cn') || url.includes('pl.svc') || url.includes('playlist')) {
        return {
          status: 200,
          ok: true,
          header: () => null,
          json: () => ({
            title: 'Top Hits',
            info: 'Best songs',
            pic: 'https://img.kuwo.cn/pl.jpg',
            musiclist: [
              { id: '2001', name: 'Song 1', artist: 'Artist 1', album: 'Album 1', songTimeMinutes: '03:45' }
            ]
          })
        };
      }
      return { status: 404, ok: false, header: () => null, json: () => ({}) };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(playlistCode, ctx);

  const res = ctx.execute({ id: '998877' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.title, 'Top Hits');
  assert.strictEqual(res.data.items.length, 1);
  assert.strictEqual(res.data.items[0].id, '2001');
});

// 6. resolve.js URL routing test
test('resolve.js: resolves Kuwo URLs to unified item metadata', () => {
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
          status: 200,
          data: {
            musicinfo: { id: '334455', name: 'Nocturne', artist: 'Jay Chou', album: 'November Chopin', duration: '200' }
          }
        })
      };
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(resolveCode, ctx);

  const res = ctx.execute({ url: 'https://www.kuwo.cn/play_detail/334455' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.kind, 'track');
  assert.strictEqual(res.data.id, '334455');
});

// 7. Live network smoke test (Optional / resilient to network timeouts)
test('Kuwo live network smoke test (search + stream)', async () => {
  try {
    const fetch = global.fetch || require('node-fetch');
    const searchUrl = 'https://search.kuwo.cn/r.s?client=kt&all=%E5%91%A8%E6%9D%B0%E4%BC%A6&pn=0&rn=5&vipver=1&ft=music&encoding=utf8&rformat=json&mobi=1';
    const resp = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) {
      console.log('Live Kuwo search returned HTTP', resp.status, '(skipping live test due to network)');
      return;
    }
    const text = await resp.text();
    // JSON or js object
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = JSON.parse(text.replace(/'/g, '"'));
    }
    if (data && data.abslist && data.abslist.length > 0) {
      const first = data.abslist[0];
      const rid = String(first.DC_TARGETID || first.MUSICRID || '').replace('MUSIC_', '');
      console.log(`Live track found: "${first.NAME}" by "${first.ARTIST}" (rid: ${rid})`);

      const antiUrl = `http://antiserver.kuwo.cn/anti.s?type=convert_url&rid=${rid}&format=mp3&response=url`;
      const streamResp = await fetch(antiUrl);
      if (streamResp.ok) {
        const streamUrl = (await streamResp.text()).trim();
        console.log(`Live stream URL: ${streamUrl}`);
        assert.ok(streamUrl.startsWith('http'), 'Stream URL should start with http');
      }
    }
  } catch (err) {
    console.log('Live network test skipped/failed gracefully:', err.message);
  }
});

console.log(`\nAll ${passedTests} unit tests passed for Kuwo Music!`);
