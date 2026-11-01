// Smoke test of src/musixmatch/src/lyrics.js and search.js: `node tools/check_musixmatch_lyrics.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const pluginDir = path.join(__dirname, '..', 'src', 'musixmatch');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8'));
const commonCode = fs.readFileSync(path.join(pluginDir, 'src', 'common.js'), 'utf8');
const searchCode = fs.readFileSync(path.join(pluginDir, 'src', 'search.js'), 'utf8');
const lyricsCode = fs.readFileSync(path.join(pluginDir, 'src', 'lyrics.js'), 'utf8');

let n = 0;
function test(name, fn) {
  fn();
  n++;
  console.log(`✓ ${name}`);
}

async function testAsync(name, fn) {
  await fn();
  n++;
  console.log(`✓ ${name}`);
}

// 1. Manifest structure check
test('plugin.json structure and fields', () => {
  assert.strictEqual(manifest.metadata.apiVersion, 1);
  assert.strictEqual(manifest.metadata.type, 'lyrics');
  assert.strictEqual(manifest.metadata.name, 'Musixmatch');
  assert.strictEqual(typeof manifest.metadata.version, 'number');
  assert.ok(Array.isArray(manifest.metadata.hosts));
  assert.ok(manifest.metadata.hosts.includes('apic-appmobile.musixmatch.com'));
  assert.strictEqual(manifest.script.search, 'search.js');
  assert.strictEqual(manifest.script.lyrics, 'lyrics.js');
});

// 2. Token management
test('token management: config override > storage > default', () => {
  const store = {};
  const mockConfig = {};
  const Response = {
    error: (msg, opts) => ({ error: msg, ...opts }),
    success: (v) => ({ ok: v }),
  };
  const g = {
    Response,
    localConfig: { getItem: (k) => mockConfig[k] || null },
    localStorage: {
      getItem: (k) => store[k] || null,
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    fetch: () => ({ status: 401 }),
  };

  const env = new Function(...Object.keys(g), commonCode + '\nreturn { getToken, DEFAULT_TOKEN };')(...Object.values(g));
  
  // Default fallback when fetch fails and no cache/config
  const tok1 = env.getToken(false);
  assert.strictEqual(tok1, env.DEFAULT_TOKEN);
  assert.strictEqual(store.mxm_token, env.DEFAULT_TOKEN);

  // Cached token in localStorage
  store.mxm_token = 'cached_token_123';
  const tok2 = env.getToken(false);
  assert.strictEqual(tok2, 'cached_token_123');

  // Config override takes priority
  mockConfig.userToken = 'custom_user_token';
  const tok3 = env.getToken(false);
  assert.strictEqual(tok3, 'custom_user_token');
});

// 3. stripCredits and cleanLrc
test('stripCredits removes disclaimers and headers but preserves content', () => {
  const Response = {
    error: (msg, opts) => ({ error: msg, ...opts }),
    success: (v) => ({ ok: v }),
  };
  const g = {
    Response,
    localConfig: { getItem: () => null },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };

  const env = new Function(...Object.keys(g), commonCode + '\nreturn { stripCredits, cleanLrc };')(...Object.values(g));

  const sample = 
`[ti:Song Title]
[ar:Artist]
[00:01.00] Lyrics by: John Doe
[00:04.00] Hello world
[00:08.00] In the end
[00:15.00] ******* This Lyrics is NOT for Commercial use *******
[00:20.00] (1409618588523)`;

  const cleaned = env.stripCredits(sample);
  assert.ok(cleaned.includes('[00:04.00] Hello world'));
  assert.ok(cleaned.includes('[00:08.00] In the end'));
  assert.ok(!cleaned.includes('Lyrics by: John Doe'));
  assert.ok(!cleaned.includes('This Lyrics is NOT for Commercial use'));
  assert.ok(!cleaned.includes('1409618588523'));
});

// 4. search.js mapping and filtering
test('search.js maps tracks and filters tracks without lyrics', () => {
  const mockTrackList = [
    {
      track: {
        commontrack_id: 101,
        track_name: 'Has Lyrics',
        artist_name: 'Artist 1',
        album_name: 'Album 1',
        track_length: 180,
        has_subtitles: 1,
        has_lyrics: 1,
        instrumental: 0,
      }
    },
    {
      track: {
        commontrack_id: 102,
        track_name: 'Instrumental Track',
        artist_name: 'Artist 2',
        track_length: 210,
        has_subtitles: 0,
        has_lyrics: 0,
        instrumental: 1,
      }
    },
    {
      track: {
        commontrack_id: 103,
        track_name: 'No Lyrics At All',
        artist_name: 'Artist 3',
        has_subtitles: 0,
        has_lyrics: 0,
        instrumental: 0,
      }
    }
  ];

  const Response = {
    success: (v) => ({ ok: v }),
    error: (m, o) => ({ error: m, ...o }),
  };

  const g = {
    load() {},
    Response,
    localConfig: { getItem: () => null },
    localStorage: { getItem: () => 'valid_token', setItem: () => {}, removeItem: () => {} },
    fetch: (url, opts) => ({
      status: 200,
      json: () => ({
        message: {
          header: { status_code: 200 },
          body: { track_list: mockTrackList }
        }
      })
    })
  };

  const fullSearch = commonCode + '\n' + searchCode;
  const fn = new Function(...Object.keys(g), fullSearch + '\nreturn execute;')(...Object.values(g));
  const res = fn({ title: 'Song', artist: 'Artist' });

  assert.strictEqual(res.ok.length, 2);
  assert.deepStrictEqual(res.ok[0], {
    id: '101',
    title: 'Has Lyrics',
    artist: 'Artist 1',
    album: 'Album 1',
    durationMs: 180000,
  });
  assert.deepStrictEqual(res.ok[1], {
    id: '102',
    title: 'Instrumental Track',
    artist: 'Artist 2',
    durationMs: 210000,
  });
});

// 5. lyrics.js execution (timed, plain, instrumental, null)
test('lyrics.js correctly handles timed, plain, instrumental, and 404', () => {
  const Response = {
    success: (v) => ({ ok: v }),
    error: (m, o) => ({ error: m, ...o }),
  };

  function createEnv(fetchFn) {
    const g = {
      load() {},
      Response,
      localConfig: { getItem: () => null },
      localStorage: { getItem: () => 'token_123', setItem: () => {}, removeItem: () => {} },
      fetch: fetchFn,
    };
    const fullLyrics = commonCode + '\n' + lyricsCode;
    return new Function(...Object.keys(g), fullLyrics + '\nreturn execute;')(...Object.values(g));
  }

  // Case A: Timed subtitle available
  {
    const fn = createEnv((url) => {
      if (url.includes('track.subtitle.get')) {
        return {
          status: 200,
          json: () => ({
            message: {
              header: { status_code: 200 },
              body: { subtitle: { subtitle_body: '[00:05.00] Hello\n[00:10.00] World' } }
            }
          })
        };
      }
      return { status: 404, json: () => ({ message: { header: { status_code: 404 } } }) };
    });
    const res = fn('101');
    assert.deepStrictEqual(res, { ok: { data: '[00:05.00] Hello\n[00:10.00] World', type: 'lrc' } });
  }

  // Case B: Instrumental header in subtitle response
  {
    const fn = createEnv((url) => {
      if (url.includes('track.subtitle.get')) {
        return {
          status: 200,
          json: () => ({
            message: {
              header: { status_code: 404, instrumental: 1 },
              body: {}
            }
          })
        };
      }
      return { status: 404, json: () => ({ message: { header: { status_code: 404 } } }) };
    });
    const res = fn('102');
    assert.deepStrictEqual(res, { ok: { instrumental: true } });
  }

  // Case C: Subtitle 404, plain lyrics available
  {
    const fn = createEnv((url) => {
      if (url.includes('track.subtitle.get')) {
        return {
          status: 200,
          json: () => ({ message: { header: { status_code: 404 } }, body: {} })
        };
      }
      if (url.includes('track.lyrics.get')) {
        return {
          status: 200,
          json: () => ({
            message: {
              header: { status_code: 200 },
              body: { lyrics: { lyrics_body: 'Line 1\nLine 2', instrumental: 0 } }
            }
          })
        };
      }
      return { status: 404, json: () => ({ message: { header: { status_code: 404 } } }) };
    });
    const res = fn('103');
    assert.deepStrictEqual(res, { ok: { data: 'Line 1\nLine 2', type: 'txt' } });
  }

  // Case D: Both 404
  {
    const fn = createEnv(() => ({
      status: 200,
      json: () => ({ message: { header: { status_code: 404 } }, body: {} })
    }));
    const res = fn('104');
    assert.deepStrictEqual(res, { ok: null });
  }
});

// 6. Live network smoke test
const cp = require('child_process');
function syncLiveFetch(url, opts = {}) {
  let fullUrl = url;
  if (opts.queries) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(opts.queries)) {
      u.searchParams.set(k, v);
    }
    fullUrl = u.toString();
  }
  const args = ['-s', '-i'];
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) {
      args.push('-H', `${k}: ${v}`);
    }
  }
  args.push(fullUrl);
  const raw = cp.execFileSync('curl', args, { encoding: 'utf8' });
  const parts = raw.split(/\r?\n\r?\n/);
  // Find the last HTTP header section in case of 100 Continue
  let headerIndex = 0;
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i].startsWith('HTTP/')) headerIndex = i;
  }
  const headerLines = parts[headerIndex].split(/\r?\n/);
  const statusLine = headerLines[0] || '';
  const statusMatch = statusLine.match(/HTTP\/\S+\s+(\d+)/);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
  const headers = {};
  for (let i = 1; i < headerLines.length; i++) {
    const idx = headerLines[i].indexOf(':');
    if (idx > 0) {
      const k = headerLines[i].slice(0, idx).trim().toLowerCase();
      const v = headerLines[i].slice(idx + 1).trim();
      headers[k] = v;
    }
  }
  const body = parts.slice(headerIndex + 1).join('\n\n');
  return {
    status,
    header: (h) => headers[h.toLowerCase()] || null,
    text: () => body,
    json: () => JSON.parse(body),
  };
}

test('live Musixmatch API search and lyrics smoke test', () => {
  const Response = {
    success: (v) => ({ ok: v }),
    error: (m, o) => ({ error: m, ...o }),
  };

  const storage = {};
  const g = {
    load() {},
    Response,
    localConfig: { getItem: () => null },
    localStorage: {
      getItem: (k) => storage[k] || null,
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; },
    },
    fetch: syncLiveFetch,
  };

  // Run search for "Yesterday - The Beatles"
  const searchFn = new Function(...Object.keys(g), commonCode + '\n' + searchCode + '\nreturn execute;')(...Object.values(g));
  const searchRes = searchFn({ title: 'Yesterday', artist: 'The Beatles' });
  assert.ok(searchRes && searchRes.ok && searchRes.ok.length > 0, 'Should find tracks for Yesterday');
  const firstTrack = searchRes.ok[0];
  assert.ok(firstTrack.id, 'Should have track id');
  assert.strictEqual(firstTrack.artist, 'The Beatles');

  // Run lyrics for the found track
  const lyricsFn = new Function(...Object.keys(g), commonCode + '\n' + lyricsCode + '\nreturn execute;')(...Object.values(g));
  const lyrRes = lyricsFn(firstTrack.id);
  assert.ok(lyrRes && lyrRes.ok && lyrRes.ok.data, 'Should return lyrics data');
  assert.strictEqual(lyrRes.ok.type, 'lrc');
  assert.ok(lyrRes.ok.data.includes('Yesterday'), 'Lyrics should contain "Yesterday"');

  // Test instrumental: "River Flows In You - Yiruma"
  const instSearch = searchFn({ title: 'River Flows In You', artist: 'Yiruma' });
  assert.ok(instSearch && instSearch.ok && instSearch.ok.length > 0);
  const instLyr = lyricsFn(instSearch.ok[0].id);
  assert.ok(instLyr && instLyr.ok && (instLyr.ok.instrumental === true || instLyr.ok.data), 'Instrumental track handled');
});

console.log(`\nAll ${n} tests passed successfully!`);

