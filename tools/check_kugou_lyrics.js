// Smoke test of src/kugou/src/lyrics.js and search.js: `node tools/check_kugou_lyrics.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const cp = require('child_process');

const pluginDir = path.join(__dirname, '..', 'src', 'kugou');
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
  assert.strictEqual(manifest.metadata.name, 'Kugou Music');
  assert.strictEqual(typeof manifest.metadata.version, 'number');
  assert.ok(Array.isArray(manifest.metadata.hosts));
  assert.ok(manifest.metadata.hosts.includes('lyrics.kugou.com'));
  assert.strictEqual(manifest.script.search, 'search.js');
  assert.strictEqual(manifest.script.lyrics, 'lyrics.js');
});

// 2. Unit tests for Base64, UTF-8, and stripCredits
test('base64ToString, stripCredits and PURE_MUSIC', () => {
  const Response = {
    error: (msg, opts) => ({ error: msg, ...opts }),
    success: (v) => ({ ok: v }),
  };
  const g = { Response };
  const env = new Function(...Object.keys(g), commonCode + '\nreturn { base64ToString, stripCredits, PURE_MUSIC };')(...Object.values(g));

  const sampleText = '故事的小黄花 晴天 🌸';
  const sampleB64 = Buffer.from(sampleText, 'utf8').toString('base64');
  assert.strictEqual(env.base64ToString(sampleB64), sampleText);

  const sample =
`[id:$00000000]
[ti:晴天]
[ar:周杰伦]
[by:krc转qrc工具]
[00:00.00]词：周杰伦
[00:02.00]曲：周杰伦
[00:05.00]故事的小黄花
[00:10.00]从出生那年就飘着
[03:50.00]混音：杨大纬`;

  const cleaned = env.stripCredits(sample);
  assert.ok(cleaned.includes('[00:05.00]故事的小黄花'));
  assert.ok(cleaned.includes('[00:10.00]从出生那年就飘着'));
  assert.ok(!cleaned.includes('词：周杰伦'));
  assert.ok(!cleaned.includes('曲：周杰伦'));
  assert.ok(!cleaned.includes('混音：杨大纬'));

  assert.ok(env.PURE_MUSIC.test('此歌曲为没有填词的纯音乐，请您欣赏'));
  assert.ok(env.PURE_MUSIC.test('纯音乐，请欣赏'));
});

// 3. search.js candidate mapping and deduplication
test('search.js maps candidates correctly', () => {
  const mockCandidates = [
    {
      id: 101,
      accesskey: 'KEY_AAA',
      song: 'Song &amp; One',
      singer: 'Singer A',
      duration: 180000,
    },
    {
      id: 101, // duplicate id and key
      accesskey: 'KEY_AAA',
      song: 'Song One Duplicate',
      singer: 'Singer A',
      duration: 180000,
    },
    {
      id: 102,
      accesskey: 'KEY_BBB',
      song: 'Song Two',
      singer: 'Singer B',
      duration: 210000,
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
        status: 200,
        candidates: mockCandidates,
      })
    })
  };

  const fullSearch = commonCode + '\n' + searchCode;
  const fn = new Function(...Object.keys(g), fullSearch + '\nreturn execute;')(...Object.values(g));
  const res = fn({ title: 'Song', artist: 'Singer' });

  assert.strictEqual(res.ok.length, 2);
  assert.deepStrictEqual(res.ok[0], {
    id: '101_KEY_AAA',
    title: 'Song & One',
    artist: 'Singer A',
    durationMs: 180000,
  });
  assert.deepStrictEqual(res.ok[1], {
    id: '102_KEY_BBB',
    title: 'Song Two',
    artist: 'Singer B',
    durationMs: 210000,
  });
});

// 4. lyrics.js execution (timed, instrumental, null)
test('lyrics.js executes and decodes lyrics by id_accesskey', () => {
  const sampleLrc = '[00:01.00]Line One\n[00:05.00]Line Two';
  const lrcB64 = Buffer.from(sampleLrc, 'utf8').toString('base64');

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

  // Case A: Valid LRC
  {
    const fn = createEnv({ status: 200, content: lrcB64 });
    const res = fn('101_KEY_AAA');
    assert.deepStrictEqual(res, { ok: { data: sampleLrc, type: 'lrc' } });
  }

  // Case B: Instrumental text
  {
    const instB64 = Buffer.from('[00:00.00]此歌曲为没有填词的纯音乐，请您欣赏', 'utf8').toString('base64');
    const fn = createEnv({ status: 200, content: instB64 });
    const res = fn('102_KEY_BBB');
    assert.deepStrictEqual(res, { ok: { instrumental: true } });
  }

  // Case C: Status != 200 / not found
  {
    const fn = createEnv({ status: 404 });
    const res = fn('103_KEY_CCC');
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

test('live Kugou Music API search and lyrics smoke test', () => {
  const Response = {
    success: (v) => ({ ok: v }),
    error: (m, o) => ({ error: m, ...o }),
  };

  const g = {
    load() {},
    Response,
    fetch: syncLiveFetch,
  };

  // Search "The Beatles - Yesterday"
  const searchFn = new Function(...Object.keys(g), commonCode + '\n' + searchCode + '\nreturn execute;')(...Object.values(g));
  const searchRes = searchFn({ title: 'Yesterday', artist: 'The Beatles', durationMs: 125000 });
  assert.ok(searchRes && searchRes.ok && searchRes.ok.length > 0, 'Should find tracks for Yesterday');
  const firstTrack = searchRes.ok[0];
  assert.ok(firstTrack.id.includes('_'), 'Should contain id_accesskey');
  assert.strictEqual(firstTrack.title, 'Yesterday');
  assert.strictEqual(firstTrack.artist, 'The Beatles');

  // Lyrics for the found track
  const lyricsFn = new Function(...Object.keys(g), commonCode + '\n' + lyricsCode + '\nreturn execute;')(...Object.values(g));
  const lyrRes = lyricsFn(firstTrack.id);
  assert.ok(lyrRes && lyrRes.ok && lyrRes.ok.data, 'Should return lyrics data');
  assert.strictEqual(lyrRes.ok.type, 'lrc');
  assert.ok(lyrRes.ok.data.includes('Yesterday'), 'Lyrics should contain "Yesterday"');

  // Test "晴天 - 周杰伦"
  const qingTianSearch = searchFn({ title: '晴天', artist: '周杰伦', durationMs: 269000 });
  assert.ok(qingTianSearch && qingTianSearch.ok && qingTianSearch.ok.length > 0);
  const qingTianLyr = lyricsFn(qingTianSearch.ok[0].id);
  assert.ok(qingTianLyr && qingTianLyr.ok && qingTianLyr.ok.data);
});

console.log(`\nAll ${n} tests passed successfully!`);
