// Smoke test and offline unit test for Radio Browser source plugin: `node tools/check_radio_browser_source.js`
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const { runScript } = require('./source_harness');

const pluginDir = path.join(__dirname, '..', 'src', 'radio-browser');
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
  assert.strictEqual(manifest.metadata.name, 'Radio Browser');
  assert.strictEqual(typeof manifest.metadata.version, 'number');
  assert.ok(Array.isArray(manifest.metadata.hosts));
  assert.strictEqual(manifest.script.search, 'search.js');
  assert.strictEqual(manifest.script.stream, 'stream.js');
});

// 2. Unit tests for common helpers
test('common.js: station card parsing and metadata format', () => {
  const sandbox = {
    fetch: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);

  const mockStation = {
    stationuuid: '047fcd05-775a-462f-97ba-37b21d170964',
    name: 'VOV1 - Thời sự',
    country: 'Vietnam',
    tags: 'news,talk',
    codec: 'MP3',
    bitrate: 128,
    favicon: 'https://vov.vn/favicon.ico',
    homepage: 'https://vov.vn',
  };

  const card = ctx.parseRadioCard(mockStation);
  assert.strictEqual(card.id, '047fcd05-775a-462f-97ba-37b21d170964');
  assert.strictEqual(card.title, 'VOV1 - Thời sự');
  assert.strictEqual(card.artist, 'Vietnam • news • MP3');
  assert.strictEqual(card.durationMs, 0); // Live streams have 0 duration
  assert.strictEqual(card.artworkUrl, 'https://vov.vn/favicon.ico');
  assert.strictEqual(card.webUrl, 'https://vov.vn');
});

// 3. search.js parser & query handling
test('search.js: offline search parsing, direct link resolve, and pagination', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  const sandbox = {
    Response: mockResponse,
    load: () => {},
    localConfig: { getItem: () => 'Vietnam' },
    cacheStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console: console,
    fetch: (url) => {
      const dummyStations = [];
      for (let i = 0; i < 20; i++) {
        dummyStations.push({
          stationuuid: `uuid_${i}`,
          name: `Radio Station ${i}`,
          country: 'Vietnam',
          codec: 'MP3',
        });
      }
      return {
        status: 200,
        ok: true,
        text: () => JSON.stringify(dummyStations),
      };
    },
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(searchCode, ctx);

  // 3a. Direct HTTP stream URL
  const directRes = ctx.execute({ query: 'http://stream.vov.vn:8000/vov1' });
  assert.strictEqual(directRes.status, 'ok');
  assert.strictEqual(directRes.data.items.length, 1);
  assert.strictEqual(directRes.data.items[0].id, 'http://stream.vov.vn:8000/vov1');

  // 3b. Station search with pagination token
  const searchRes = ctx.execute({ query: 'vov' });
  assert.strictEqual(searchRes.status, 'ok');
  assert.strictEqual(searchRes.data.items.length, 20);
  assert.strictEqual(searchRes.data.next, '20');
});

// 4. stream.js resolution & metadata handling
test('stream.js: resolves live stream URL with Icy-MetaData header', () => {
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
    fetch: () => ({
      status: 200,
      ok: true,
      text: () => JSON.stringify([
        {
          stationuuid: '047fcd05-775a-462f-97ba-37b21d170964',
          name: 'VOV1',
          url_resolved: 'http://stream.vov.vn:8000/vov1',
          codec: 'AAC',
          bitrate: 64,
        },
      ]),
    }),
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  const res = ctx.execute({ id: '047fcd05-775a-462f-97ba-37b21d170964' });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.data.url, 'http://stream.vov.vn:8000/vov1');
  assert.strictEqual(res.data.headers['Icy-MetaData'], '1');
  assert.strictEqual(res.data.mimeType, 'audio/aac');
  assert.strictEqual(res.data.bitrate, 64000);
  assert.strictEqual(res.data.expiresAtMs, 0); // Continuous live stream
});

// 5. stream.js cache contract
test('stream.js: cache hit on repeat call', () => {
  let responseData = null;
  const mockResponse = {
    success: (d) => { responseData = { status: 'ok', data: d }; return responseData; },
    error: (m, o) => { responseData = { status: 'scriptError', message: m, opts: o }; return responseData; },
  };

  const memStore = {};
  let fetchCount = 0;

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
        status: 200,
        ok: true,
        text: () => JSON.stringify([
          { stationuuid: 'test_uuid', url_resolved: 'http://radio.stream/live' },
        ]),
      };
    },
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(commonCode, ctx);
  vm.runInContext(streamCode, ctx);

  const r1 = ctx.execute({ id: 'test_uuid' });
  assert.strictEqual(r1.status, 'ok');
  assert.strictEqual(fetchCount, 1);

  fetchCount = 0;
  const r2 = ctx.execute({ id: 'test_uuid' });
  assert.strictEqual(r2.status, 'ok');
  assert.strictEqual(fetchCount, 0, 'Must hit cache');
});

// 6. Live integration test with real Radio Browser API
test('Live integration test: search and stream resolution', () => {
  const searchResult = runScript('search.js', { query: 'jazz' }, { pluginSlug: 'radio-browser' });
  assert.strictEqual(searchResult.result.status, 'ok');
  const items = searchResult.result.data.items;
  assert.ok(items.length > 0, 'Live search should return stations');
  const firstStation = items[0];
  assert.ok(firstStation.id);
  assert.ok(firstStation.title);
  console.log(`  Live station found: "${firstStation.title}" (uuid: ${firstStation.id})`);

  const streamResult = runScript('stream.js', { id: firstStation.id }, { pluginSlug: 'radio-browser' });
  assert.strictEqual(streamResult.result.status, 'ok');
  assert.ok(streamResult.result.data.url.startsWith('http'), 'Stream URL must be valid HTTP URL');
  assert.strictEqual(streamResult.result.data.headers['Icy-MetaData'], '1');
  console.log(`  Live stream resolved: ${streamResult.result.data.url.slice(0, 60)}...`);
});

console.log(`\nAll ${passedTests} Radio Browser tests passed successfully.`);
