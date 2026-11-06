// Offline unit tests for src/megalobiz: `node tools/check_megalobiz_lyrics.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DIR = path.join(__dirname, '..', 'src', 'megalobiz');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'plugin.json'), 'utf8'));
const commonCode = fs.readFileSync(path.join(DIR, 'src', 'common.js'), 'utf8');
const searchCode = fs.readFileSync(path.join(DIR, 'src', 'search.js'), 'utf8');
const lyricsCode = fs.readFileSync(path.join(DIR, 'src', 'lyrics.js'), 'utf8');

const Response = {
  success: (data) => ({ ok: data === undefined ? null : data }),
  error: (message, options) => ({ error: String(message), ...(options || {}) }),
};

function loadModule(code, { fetch, config = {} }) {
  const inlined = code.replace(/^\s*load\(['"]common\.js['"]\);?\s*$/gm, commonCode);
  const localConfig = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(config, key) ? config[key] : null),
  };
  const factory = new Function('Response', 'fetch', 'localConfig', inlined + '\nreturn { execute, cleanLrc };');
  return factory(Response, fetch, localConfig);
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
  assert.strictEqual(manifest.metadata.name, 'Megalobiz');
  assert.strictEqual(manifest.metadata.type, 'lyrics');
  assert.strictEqual(manifest.metadata.apiVersion, 1);
  assert.ok(manifest.metadata.hosts.includes('api.megalobiz.com'));
  assert.strictEqual(manifest.script.search, 'search.js');
  assert.strictEqual(manifest.script.lyrics, 'lyrics.js');
});

t('search by text query', () => {
  const calls = [];
  const fetch = (url, opts) => {
    calls.push({ url, opts });
    return mockResponse(200, {
      count: 1,
      results: [
        {
          id: 731,
          title: 'Shape of You',
          artist: 'Ed Sheeran',
          duration: 235.13,
        },
      ],
    });
  };
  const mod = loadModule(searchCode, { fetch });
  const res = mod.execute({ text: 'Shape of You' });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://api.megalobiz.com/api/public/v1/search?q=Shape%20of%20You');
  assert.deepStrictEqual(res.ok, [
    {
      id: '731',
      title: 'Shape of You',
      artist: 'Ed Sheeran',
      durationMs: 235130,
    },
  ]);
});

t('search by tags with duration and apiKey header', () => {
  const calls = [];
  const fetch = (url, opts) => {
    calls.push({ url, opts });
    return mockResponse(200, {
      count: 1,
      results: [
        {
          id: 505,
          title: 'Hello',
          artist: 'Adele',
          duration: 295.0,
        },
      ],
    });
  };
  const mod = loadModule(searchCode, { fetch, config: { apiKey: 'my-megalobiz-key' } });
  const res = mod.execute({ title: 'Hello', artist: 'Adele', durationMs: 295000 });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://api.megalobiz.com/api/public/v1/search?title=Hello&artist=Adele&duration=295');
  assert.strictEqual(calls[0].opts.headers['Authorization'], 'Bearer my-megalobiz-key');
  assert.strictEqual(res.ok[0].title, 'Hello');
});

t('lyrics.js fetches and cleans lrc text', () => {
  const fetch = (url) => {
    assert.strictEqual(url, 'https://api.megalobiz.com/api/public/v1/lrc/731?format=lrc');
    return mockResponse(200, '[re:Megalobiz]\n[00:10.00] Line one\n[00:15.00] Line two');
  };
  const mod = loadModule(lyricsCode, { fetch });
  const res = mod.execute('731');

  assert.deepStrictEqual(res.ok, {
    data: '[00:10.00] Line one\n[00:15.00] Line two',
    type: 'lrc',
  });
});

t('lyrics.js handles 404 not found', () => {
  const fetch = () => mockResponse(404, 'Not found');
  const mod = loadModule(lyricsCode, { fetch });
  const res = mod.execute('99999');
  assert.strictEqual(res.ok, null);
});

t('lyrics.js handles 429 rate limit', () => {
  const fetch = () => mockResponse(429, 'Rate limited', { 'retry-after': '10' });
  const mod = loadModule(lyricsCode, { fetch });
  const res = mod.execute('731');
  assert.strictEqual(res.kind, 'rateLimited');
  assert.strictEqual(res.retryAfterSec, 10);
});

console.log('check_megalobiz_lyrics: ' + n + ' tests passed');
