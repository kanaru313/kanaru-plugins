// Smoke test of J-Lyric plugin: `node tools/check_jlyric_lyrics.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const cp = require('child_process');

const pluginDir = path.join(__dirname, '..', 'src', 'jlyric');
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
  assert.strictEqual(manifest.metadata.name, 'J-Lyric');
  assert.strictEqual(typeof manifest.metadata.version, 'number');
  assert.ok(Array.isArray(manifest.metadata.hosts));
  assert.ok(manifest.metadata.hosts.includes('j-lyric.net'));
  assert.strictEqual(manifest.script.search, 'search.js');
  assert.strictEqual(manifest.script.lyrics, 'lyrics.js');
});

// 2. Unit tests for htmlDecode and cleanLyrics
test('htmlDecode and cleanLyrics remove ruby reading tags and format text', () => {
  const g = {};
  const env = new Function(...Object.keys(g), commonCode + '\nreturn { htmlDecode, cleanLyrics };')(...Object.values(g));

  assert.strictEqual(env.htmlDecode('&amp; &lt; &gt; &quot; &#039;'), "& < > \" '");

  const rawHtml = `無敵の笑顔で荒らすメディア<br>知りたいその秘密ミステリアス<br><ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby><br><br>完璧で嘘つきな君は<br>`;
  const cleaned = env.cleanLyrics(rawHtml);
  assert.ok(cleaned.includes('無敵の笑顔で荒らすメディア'));
  assert.ok(cleaned.includes('知りたいその秘密ミステリアス'));
  assert.ok(cleaned.includes('漢字'));
  assert.ok(!cleaned.includes('かん'));
  assert.ok(!cleaned.includes('じ'));
  assert.strictEqual(cleaned.split('\n').length, 5); // 4 text lines + 1 empty separator
});

// 3. search.js candidate mapping
test('search.js maps song search results correctly', () => {
  const sampleSearchHtml = `
    <div id="mnb">
      <div class="cap"><h2>検索結果.</h2></div>
      <div class="bdy">
        <p class="mid"><a href="/artist/a061652/l05c79f.html" title="YOASOBI アイドル 歌詞">アイドル</a></p>
        <p class="sml">歌：<a href="/artist/a061652/" title="YOASOBI 歌詞リスト">YOASOBI</a></p>
      </div>
      <div class="bdy">
        <p class="mid"><a href="/artist/a002b56/l05d189.html" title="筋肉少女帯 50を過ぎたらバンドはアイドル 歌詞">50を過ぎたらバンドはアイドル</a></p>
        <p class="sml">歌：筋肉少女帯</p>
      </div>
    </div>
  `;

  const Response = {
    success: (v) => ({ ok: true, data: v }),
    error: (m, o) => ({ ok: false, message: m, ...(o || {}) })
  };

  const g = {
    load: () => {},
    Response,
    fetch: () => ({
      status: 200,
      text: () => sampleSearchHtml,
      header: () => null
    })
  };

  const fullSearch = commonCode + '\n' + searchCode;
  const fn = new Function(...Object.keys(g), fullSearch + '\nreturn execute;')(...Object.values(g));

  const res = fn({ title: 'アイドル', artist: 'YOASOBI' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.data.length, 2);
  assert.deepStrictEqual(res.data[0], {
    id: '/artist/a061652/l05c79f.html',
    title: 'アイドル',
    artist: 'YOASOBI'
  });
  assert.deepStrictEqual(res.data[1], {
    id: '/artist/a002b56/l05d189.html',
    title: '50を過ぎたらバンドはアイドル',
    artist: '筋肉少女帯'
  });
});

// 4. lyrics.js execution (valid text, 404)
test('lyrics.js fetches and parses lyric body', () => {
  const sampleSongHtml = `
    <!DOCTYPE html><html><body>
    <div id="mnb">
      <p id="Lyric">無敵の笑顔で荒らすメディア<br>知りたいその秘密ミステリアス<br><br>天才的なアイドル様</p>
    </div>
    </body></html>
  `;

  const Response = {
    success: (v) => ({ ok: true, data: v }),
    error: (m, o) => ({ ok: false, message: m, ...(o || {}) })
  };

  function createEnv(status, html) {
    const g = {
      load: () => {},
      Response,
      fetch: () => ({
        status: status,
        text: () => html || '',
        header: () => null
      })
    };
    const fullLyrics = commonCode + '\n' + lyricsCode;
    return new Function(...Object.keys(g), fullLyrics + '\nreturn execute;')(...Object.values(g));
  }

  // Case A: 200 OK
  const fn200 = createEnv(200, sampleSongHtml);
  const res200 = fn200('/artist/a061652/l05c79f.html');
  assert.strictEqual(res200.ok, true);
  assert.strictEqual(res200.data.type, 'txt');
  assert.ok(res200.data.data.includes('無敵の笑顔で荒らすメディア'));
  assert.ok(res200.data.data.includes('天才的なアイドル様'));

  // Case B: 404 Not Found
  const fn404 = createEnv(404, '');
  const res404 = fn404('/artist/nonexistent.html');
  assert.strictEqual(res404.ok, true);
  assert.strictEqual(res404.data, null);
});

// 5. Live network smoke test
function syncLiveFetch(url) {
  const args = ['-s', '-i', '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', url];
  const raw = cp.execFileSync('curl', args, { encoding: 'utf8' });
  const parts = raw.split(/\r?\n\r?\n/);
  const headerLines = parts[0].split(/\r?\n/);
  const statusLine = headerLines[0] || '';
  const statusMatch = statusLine.match(/HTTP\/\S+\s+(\d+)/);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
  const body = parts.slice(1).join('\n\n');
  return {
    status,
    text: () => body,
    header: () => null
  };
}

test('live J-Lyric API search and lyrics smoke test', () => {
  const Response = {
    success: (v) => ({ ok: true, data: v }),
    error: (m, o) => ({ ok: false, message: m, ...(o || {}) })
  };

  const g = {
    load: () => {},
    Response,
    fetch: syncLiveFetch
  };

  const fullSearch = commonCode + '\n' + searchCode;
  const searchFn = new Function(...Object.keys(g), fullSearch + '\nreturn execute;')(...Object.values(g));

  const fullLyrics = commonCode + '\n' + lyricsCode;
  const lyricsFn = new Function(...Object.keys(g), fullLyrics + '\nreturn execute;')(...Object.values(g));

  // Search "YOASOBI" - "アイドル"
  const searchRes = searchFn({ title: 'アイドル', artist: 'YOASOBI' });
  assert.ok(searchRes.ok && searchRes.data.length > 0, 'Should find tracks for アイドル');
  const first = searchRes.data[0];
  assert.strictEqual(first.title, 'アイドル');
  assert.strictEqual(first.artist, 'YOASOBI');

  // Fetch lyrics
  const lyrRes = lyricsFn(first.id);
  assert.ok(lyrRes.ok && lyrRes.data && lyrRes.data.data, 'Should return lyrics');
  assert.strictEqual(lyrRes.data.type, 'txt');
  assert.ok(lyrRes.data.data.includes('無敵の笑顔で荒らすメディア'));

  // Search "Lemon" - "米津玄師"
  const lemonSearch = searchFn({ title: 'Lemon', artist: '米津玄師' });
  assert.ok(lemonSearch.ok && lemonSearch.data.length > 0, 'Should find tracks for Lemon');
  const lemonFirst = lemonSearch.data[0];
  const lemonLyr = lyricsFn(lemonFirst.id);
  assert.ok(lemonLyr.ok && lemonLyr.data && lemonLyr.data.data);
  assert.ok(lemonLyr.data.data.includes('夢ならばどれほどよかったでしょう'));
});

console.log(`\nAll ${n} tests passed successfully!`);
