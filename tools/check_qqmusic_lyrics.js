// Smoke test of src/qqmusic/src/lyrics.js and search.js: `node tools/check_qqmusic_lyrics.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const cp = require('child_process');

const pluginDir = path.join(__dirname, '..', 'src', 'qqmusic');
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

// 1. Manifest structure check
test('plugin.json structure and fields', () => {
  assert.strictEqual(manifest.metadata.apiVersion, 1);
  assert.strictEqual(manifest.metadata.type, 'lyrics');
  assert.strictEqual(manifest.metadata.name, 'QQ Music');
  assert.strictEqual(typeof manifest.metadata.version, 'number');
  assert.ok(Array.isArray(manifest.metadata.hosts));
  assert.ok(manifest.metadata.hosts.includes('c.y.qq.com'));
  assert.strictEqual(manifest.script.search, 'search.js');
  assert.strictEqual(manifest.script.lyrics, 'lyrics.js');
});

// 2. htmlDecode, stripCredits and realLines
test('htmlDecode and stripCredits handle entities and credit lines', () => {
  const Response = {
    error: (msg, opts) => ({ error: msg, ...opts }),
    success: (v) => ({ ok: v }),
  };
  const g = { Response };
  const env = new Function(...Object.keys(g), commonCode + '\nreturn { htmlDecode, stripCredits, realLines, PURE_MUSIC };')(...Object.values(g));

  assert.strictEqual(env.htmlDecode('Rock &amp; Roll &#39;n&#39; &quot;Soul&quot;'), "Rock & Roll 'n' \"Soul\"");

  const sample =
`[ti:晴天]
[ar:周杰伦]
[al:叶惠美]
[00:00.00]词：周杰伦
[00:02.00]曲：周杰伦
[00:04.00]编曲：周杰伦
[00:10.00]故事的小黄花
[00:15.00]从出生那年就飘着
[03:50.00]制作人：周杰伦
[03:55.00]混音：杨大纬`;

  const cleaned = env.stripCredits(sample);
  assert.ok(cleaned.includes('[00:10.00]故事的小黄花'));
  assert.ok(cleaned.includes('[00:15.00]从出生那年就飘着'));
  assert.ok(!cleaned.includes('词：周杰伦'));
  assert.ok(!cleaned.includes('曲：周杰伦'));
  assert.ok(!cleaned.includes('混音：杨大纬'));

  assert.ok(env.PURE_MUSIC.test('此歌曲为没有填词的纯音乐，请您欣赏'));
  assert.ok(env.PURE_MUSIC.test('纯音乐，请欣赏'));
});

// 3. search.js mapping and deduplication
test('search.js maps songs correctly', () => {
  const mockSongList = [
    {
      songmid: 'mid_001',
      songname: 'Song &amp; One',
      singer: [{ name: 'Artist &apos;A&apos;' }, { name: 'Artist B' }],
      albumname: 'Album &quot;X&quot;',
      interval: 200,
    },
    {
      songmid: 'mid_001', // duplicate, should be skipped
      songname: 'Song One Duplicate',
      singer: [{ name: 'Artist A' }],
      interval: 200,
    },
    {
      songmid: 'mid_002',
      songname: 'Song Two',
      singer: [{ name: 'Artist C' }],
      interval: 150,
    }
  ];

  const Response = {
    success: (v) => ({ ok: v }),
    error: (m, o) => ({ error: m, ...o }),
  };

  const g = {
    load() {},
    Response,
    fetch: () => ({
      status: 200,
      json: () => ({
        code: 0,
        data: {
          song: {
            list: mockSongList
          }
        }
      })
    })
  };

  const fullSearch = commonCode + '\n' + searchCode;
  const fn = new Function(...Object.keys(g), fullSearch + '\nreturn execute;')(...Object.values(g));
  const res = fn({ title: 'Song', artist: 'Artist' });

  assert.strictEqual(res.ok.length, 2);
  assert.deepStrictEqual(res.ok[0], {
    id: 'mid_001',
    title: 'Song & One',
    artist: "Artist 'A', Artist B",
    album: 'Album "X"',
    durationMs: 200000,
  });
  assert.deepStrictEqual(res.ok[1], {
    id: 'mid_002',
    title: 'Song Two',
    artist: 'Artist C',
    durationMs: 150000,
  });
});

// 4. lyrics.js execution (timed, plain, instrumental, null)
test('lyrics.js handles synced, plain, instrumental, and no-lyrics', () => {
  const Response = {
    success: (v) => ({ ok: v }),
    error: (m, o) => ({ error: m, ...o }),
  };

  function createEnv(resJson) {
    const g = {
      load() {},
      Response,
      fetch: () => ({
        status: 200,
        json: () => resJson,
      }),
    };
    const fullLyrics = commonCode + '\n' + lyricsCode;
    return new Function(...Object.keys(g), fullLyrics + '\nreturn execute;')(...Object.values(g));
  }

  // Case A: Synced lyric
  {
    const fn = createEnv({
      code: 0,
      lyric: '[00:01.00]词：作者\n[00:05.00]Line One\n[00:10.00]Line Two'
    });
    const res = fn('mid_001');
    assert.deepStrictEqual(res, { ok: { data: '[00:05.00]Line One\n[00:10.00]Line Two', type: 'lrc' } });
  }

  // Case B: Instrumental text
  {
    const fn = createEnv({
      code: 0,
      lyric: '[00:00:00]此歌曲为没有填词的纯音乐，请您欣赏'
    });
    const res = fn('mid_002');
    assert.deepStrictEqual(res, { ok: { instrumental: true } });
  }

  // Case C: Placeholder "暂无歌词"
  {
    const fn = createEnv({
      code: 0,
      lyric: '[00:00.00]暂无歌词'
    });
    const res = fn('mid_003');
    assert.deepStrictEqual(res, { ok: null });
  }

  // Case D: Code 1101 (not found)
  {
    const fn = createEnv({ code: 1101 });
    const res = fn('mid_004');
    assert.deepStrictEqual(res, { ok: null });
  }
});

// 5. Live network test
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

test('live QQ Music API search and lyrics smoke test', () => {
  const Response = {
    success: (v) => ({ ok: v }),
    error: (m, o) => ({ error: m, ...o }),
  };

  const g = {
    load() {},
    Response,
    fetch: syncLiveFetch,
  };

  // Search "晴天 周杰伦"
  const searchFn = new Function(...Object.keys(g), commonCode + '\n' + searchCode + '\nreturn execute;')(...Object.values(g));
  const searchRes = searchFn({ title: '晴天', artist: '周杰伦' });
  assert.ok(searchRes && searchRes.ok && searchRes.ok.length > 0, 'Should find tracks for 晴天');
  const firstTrack = searchRes.ok[0];
  assert.ok(firstTrack.id, 'Should have song mid');
  assert.strictEqual(firstTrack.title, '晴天');
  assert.ok(firstTrack.artist.includes('周杰伦'));

  // Lyrics for the found track
  const lyricsFn = new Function(...Object.keys(g), commonCode + '\n' + lyricsCode + '\nreturn execute;')(...Object.values(g));
  const lyrRes = lyricsFn(firstTrack.id);
  assert.ok(lyrRes && lyrRes.ok && lyrRes.ok.data, 'Should return lyrics data');
  assert.strictEqual(lyrRes.ok.type, 'lrc');
  assert.ok(lyrRes.ok.data.includes('故事的小黄花'), 'Lyrics should contain "故事的小黄花"');

  // Instrumental test: "River Flows in You - 李闰珉"
  const instSearch = searchFn({ title: 'River Flows in You', artist: '李闰珉' });
  assert.ok(instSearch && instSearch.ok && instSearch.ok.length > 0);
  const instLyr = lyricsFn(instSearch.ok[0].id);
  assert.ok(instLyr && instLyr.ok && instLyr.ok.instrumental === true, 'Instrumental track should return instrumental: true');
});

console.log(`\nAll ${n} tests passed successfully!`);
