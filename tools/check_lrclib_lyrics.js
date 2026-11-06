// Offline unit tests for src/lrclib: `node tools/check_lrclib_lyrics.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DIR = path.join(__dirname, '..', 'src', 'lrclib');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'plugin.json'), 'utf8'));
const commonCode = fs.readFileSync(path.join(DIR, 'src', 'common.js'), 'utf8');
const searchCode = fs.readFileSync(path.join(DIR, 'src', 'search.js'), 'utf8');
const lyricsCode = fs.readFileSync(path.join(DIR, 'src', 'lyrics.js'), 'utf8');

const Response = {
  success: (data) => ({ ok: data === undefined ? null : data }),
  error: (message, options) => ({ error: String(message), ...(options || {}) }),
};

function loadModule(code, { fetch }) {
  const inlined = code.replace(/^\s*load\(['"]common\.js['"]\);?\s*$/gm, commonCode);
  const factory = new Function('Response', 'fetch', inlined + '\nreturn { execute };');
  return factory(Response, fetch);
}

const mockResponse = (status, body, headers = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers,
  header: (name) => headers[name.toLowerCase()] || null,
  json: () => (typeof body === 'string' ? JSON.parse(body) : body),
  text: () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

let n = 0;
const t = (name, f) => {
  try {
    f();
    n++;
  } catch (e) {
    console.error('FAIL', name);
    throw e;
  }
};

t('plugin manifest structure and hosts', () => {
  assert.strictEqual(manifest.metadata.name, 'LRCLIB');
  assert.strictEqual(manifest.metadata.type, 'lyrics');
  assert.strictEqual(manifest.metadata.apiVersion, 1);
  assert.ok(manifest.metadata.hosts.includes('lrclib.net'));
  assert.strictEqual(manifest.script.search, 'search.js');
  assert.strictEqual(manifest.script.lyrics, 'lyrics.js');
});

t('search by text query', () => {
  const calls = [];
  const fetch = (url, opts) => {
    calls.push({ url, opts });
    return mockResponse(200, [
      {
        id: 101,
        trackName: 'Shape of You',
        artistName: 'Ed Sheeran',
        albumName: 'Divide',
        duration: 235.1,
        syncedLyrics: '[00:10.00] Club line',
        plainLyrics: 'Club line',
      },
    ]);
  };
  const mod = loadModule(searchCode, { fetch });
  const res = mod.execute({ text: 'Shape of You' });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://lrclib.net/api/search?q=Shape%20of%20You');
  assert.deepStrictEqual(res.ok, [
    {
      id: '101',
      title: 'Shape of You',
      artist: 'Ed Sheeran',
      album: 'Divide',
      durationMs: 235100,
      lyrics: {
        data: '[00:10.00] Club line',
        type: 'lrc',
      },
    },
  ]);
});

t('search by tags fallback chain', () => {
  const calls = [];
  const fetch = (url) => {
    calls.push(url);
    if (url.includes('track_name=')) {
      return mockResponse(200, []); // empty first
    }
    return mockResponse(200, [
      {
        id: 202,
        trackName: 'Bad Habits',
        artistName: 'Ed Sheeran',
        instrumental: false,
        plainLyrics: 'Bad habits lead to late nights',
      },
    ]);
  };
  const mod = loadModule(searchCode, { fetch });
  const res = mod.execute({ title: 'Bad Habits', artist: 'Ed Sheeran' });

  assert.strictEqual(calls.length, 2);
  assert.strictEqual(res.ok.length, 1);
  assert.strictEqual(res.ok[0].title, 'Bad Habits');
  assert.strictEqual(res.ok[0].lyrics.type, 'txt');
});

t('lyrics.js fetches synced lyrics', () => {
  const fetch = (url) => {
    assert.strictEqual(url, 'https://lrclib.net/api/get/101');
    return mockResponse(200, {
      id: 101,
      trackName: 'Song',
      syncedLyrics: '[00:05.00] Hello world',
    });
  };
  const mod = loadModule(lyricsCode, { fetch });
  const res = mod.execute('101');
  assert.deepStrictEqual(res.ok, {
    data: '[00:05.00] Hello world',
    type: 'lrc',
  });
});

t('lyrics.js handles instrumental', () => {
  const fetch = () => mockResponse(200, { id: 303, instrumental: true });
  const mod = loadModule(lyricsCode, { fetch });
  const res = mod.execute('303');
  assert.deepStrictEqual(res.ok, { instrumental: true });
});

t('lyrics.js handles 404 not found', () => {
  const fetch = () => mockResponse(404, { message: 'Not found' });
  const mod = loadModule(lyricsCode, { fetch });
  const res = mod.execute('999999');
  assert.strictEqual(res.ok, null);
});

t('handles rate limit 429', () => {
  const fetch = () => mockResponse(429, {}, { 'retry-after': '5' });
  const mod = loadModule(lyricsCode, { fetch });
  const res = mod.execute('101');
  assert.strictEqual(res.kind, 'rateLimited');
  assert.strictEqual(res.retryAfterSec, 5);
});

console.log('check_lrclib_lyrics: ' + n + ' tests passed');
