// Smoke test of src/petitlyrics/src/lyrics.js and search.js: `node tools/check_petitlyrics_lyrics.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const cp = require('child_process');

const pluginDir = path.join(__dirname, '..', 'src', 'petitlyrics');
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
  assert.strictEqual(manifest.metadata.name, 'PetitLyrics');
  assert.strictEqual(typeof manifest.metadata.version, 'number');
  assert.ok(Array.isArray(manifest.metadata.hosts));
  assert.ok(manifest.metadata.hosts.includes('on.petitlyrics.com'));
  assert.strictEqual(manifest.script.search, 'search.js');
  assert.strictEqual(manifest.script.lyrics, 'lyrics.js');
});

// 2. Unit tests for Base64, UTF-8, WSY and LSY decoders
test('decoders: base64, utf-8, WSY and LSY', () => {
  const Response = {
    error: (msg, opts) => ({ error: msg, ...opts }),
    success: (v) => ({ ok: v }),
  };
  const g = { Response };
  const env = new Function(...Object.keys(g), commonCode + '\nreturn { formatTime, base64ToBytes, decodeUtf8, parseWsy, decodeLsy, decodeLyricsData };')(...Object.values(g));

  // Time formatter
  assert.strictEqual(env.formatTime(1184), '[00:01.18]');
  assert.strictEqual(env.formatTime(65430), '[01:05.43]');

  // Base64 & UTF-8
  const sampleText = '夢ならばどれほどよかったでしょう 🌸';
  const sampleB64 = Buffer.from(sampleText, 'utf8').toString('base64');
  const decodedStr = env.decodeUtf8(env.base64ToBytes(sampleB64));
  assert.strictEqual(decodedStr, sampleText);

  // WSY XML parser
  const sampleWsy = '<wsy><line><linestring>Hello World</linestring><word><starttime>1500</starttime></word></line></wsy>';
  const parsedWsy = env.parseWsy(sampleWsy);
  assert.strictEqual(parsedWsy, '[00:01.50] Hello World');

  // decodeLyricsData type 3
  const wsyB64 = Buffer.from(sampleWsy, 'utf8').toString('base64');
  const res3 = env.decodeLyricsData('3', wsyB64);
  assert.deepStrictEqual(res3, { data: '[00:01.50] Hello World', type: 'lrc' });

  // decodeLyricsData type 1
  const plainB64 = Buffer.from('Plain lyrics line', 'utf8').toString('base64');
  const res1 = env.decodeLyricsData('1', plainB64);
  assert.deepStrictEqual(res1, { data: 'Plain lyrics line', type: 'txt' });
});

// 3. search.js mapping and embedded lyrics
test('search.js maps songs from XML and embeds WSY lyrics', () => {
  const sampleWsy = '<wsy><line><linestring>Sample Lyrics Line</linestring><word><starttime>2000</starttime></word></line></wsy>';
  const wsyB64 = Buffer.from(sampleWsy, 'utf8').toString('base64');

  const mockXml = `<?xml version='1.0' encoding='UTF-8' ?>
<response>
  <status>00000000</status>
  <songs>
    <matchedCount>2</matchedCount>
    <returnedCount>2</returnedCount>
    <song>
      <lyricsId>101</lyricsId>
      <title>Song &amp; One</title>
      <artist>Artist &apos;A&apos;</artist>
      <album>Album &quot;X&quot;</album>
      <duration>180000</duration>
      <lyricsType>3</lyricsType>
      <lyricsData>${wsyB64}</lyricsData>
    </song>
    <song>
      <lyricsId>102</lyricsId>
      <title>Song Two</title>
      <artist>Artist B</artist>
      <duration>210000</duration>
      <lyricsType>1</lyricsType>
      <lyricsData>someData</lyricsData>
    </song>
  </songs>
</response>`;

  const Response = {
    success: (v) => ({ ok: v }),
    error: (m, o) => ({ error: m, ...o }),
  };

  const g = {
    load() {},
    Response,
    fetch: () => ({
      status: 200,
      text: () => mockXml,
    })
  };

  const fullSearch = commonCode + '\n' + searchCode;
  const fn = new Function(...Object.keys(g), fullSearch + '\nreturn execute;')(...Object.values(g));
  const res = fn({ title: 'Song', artist: 'Artist' });

  assert.strictEqual(res.ok.length, 2);
  assert.strictEqual(res.ok[0].id, '101');
  assert.strictEqual(res.ok[0].title, 'Song & One');
  assert.strictEqual(res.ok[0].artist, "Artist 'A'");
  assert.strictEqual(res.ok[0].album, 'Album "X"');
  assert.strictEqual(res.ok[0].durationMs, 180000);
  assert.strictEqual(res.ok[0].lyrics, '[00:02.00] Sample Lyrics Line');

  assert.strictEqual(res.ok[1].id, '102');
  assert.strictEqual(res.ok[1].title, 'Song Two');
  assert.strictEqual(res.ok[1].artist, 'Artist B');
  assert.strictEqual(res.ok[1].durationMs, 210000);
  assert.strictEqual(res.ok[1].lyrics, undefined);
});

// 4. lyrics.js execution
test('lyrics.js executes and decodes lyrics by lyricsId', () => {
  const sampleWsy = '<wsy><line><linestring>Line from lyrics.js</linestring><word><starttime>3500</starttime></word></line></wsy>';
  const wsyB64 = Buffer.from(sampleWsy, 'utf8').toString('base64');

  const mockXml = `<?xml version='1.0' encoding='UTF-8' ?>
<response>
  <status>00000000</status>
  <songs>
    <song>
      <lyricsId>101</lyricsId>
      <title>Song Title</title>
      <artist>Artist Name</artist>
      <lyricsType>3</lyricsType>
      <lyricsData>${wsyB64}</lyricsData>
    </song>
  </songs>
</response>`;

  const Response = {
    success: (v) => ({ ok: v }),
    error: (m, o) => ({ error: m, ...o }),
  };

  const g = {
    load() {},
    Response,
    fetch: () => ({
      status: 200,
      text: () => mockXml,
    })
  };

  const fullLyrics = commonCode + '\n' + lyricsCode;
  const fn = new Function(...Object.keys(g), fullLyrics + '\nreturn execute;')(...Object.values(g));
  const res = fn('101');

  assert.deepStrictEqual(res, { ok: { data: '[00:03.50] Line from lyrics.js', type: 'lrc' } });
});

// 5. Live network test
function syncLiveFetch(url, opts = {}) {
  const args = ['-s', '-i'];
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) {
      args.push('-H', `${k}: ${v}`);
    }
  }
  if (opts.body) {
    args.push('--data', opts.body);
  }
  args.push(url);
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
  };
}

test('live PetitLyrics API search and lyrics smoke test', () => {
  const Response = {
    success: (v) => ({ ok: v }),
    error: (m, o) => ({ error: m, ...o }),
  };

  const g = {
    load() {},
    Response,
    fetch: syncLiveFetch,
  };

  // Search "Lemon 米津玄師"
  const searchFn = new Function(...Object.keys(g), commonCode + '\n' + searchCode + '\nreturn execute;')(...Object.values(g));
  const searchRes = searchFn({ title: 'Lemon', artist: '米津玄師' });
  assert.ok(searchRes && searchRes.ok && searchRes.ok.length > 0, 'Should find tracks for Lemon');
  const firstTrack = searchRes.ok[0];
  assert.ok(firstTrack.id, 'Should have lyricsId');
  assert.strictEqual(firstTrack.title, 'Lemon');
  assert.strictEqual(firstTrack.artist, '米津玄師');

  // Verify lyrics directly returned or through lyrics.js
  const lyricsFn = new Function(...Object.keys(g), commonCode + '\n' + lyricsCode + '\nreturn execute;')(...Object.values(g));
  const lyrRes = lyricsFn(firstTrack.id);
  assert.ok(lyrRes && lyrRes.ok && lyrRes.ok.data, 'Should return lyrics data');
  assert.strictEqual(lyrRes.ok.type, 'lrc');
  assert.ok(lyrRes.ok.data.includes('夢ならばどれほどよかったでしょう'), 'Lyrics should contain first line of Lemon');
});

console.log(`\nAll ${n} tests passed successfully!`);
