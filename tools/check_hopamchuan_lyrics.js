// Offline unit tests for src/hopamchuan: `node tools/check_hopamchuan_lyrics.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DIR = path.join(__dirname, '..', 'src', 'hopamchuan');
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
  const factory = new Function('Response', 'fetch', 'localConfig', inlined + '\nreturn { execute, parseLyricLine, extractLyricsFromHtml, parseSearchResults };');
  return factory(Response, fetch, localConfig);
}

const mockResponse = (status, text) => ({
  status,
  ok: status >= 200 && status < 300,
  text: () => text,
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
  assert.strictEqual(manifest.metadata.name, 'Hợp Âm Chuẩn');
  assert.strictEqual(manifest.metadata.type, 'lyrics');
  assert.ok(manifest.metadata.hosts.includes('hopamchuan.com'));
  assert.strictEqual(manifest.script.search, 'search.js');
  assert.strictEqual(manifest.script.lyrics, 'lyrics.js');
  assert.strictEqual(manifest.config.showChords.default, true);
});

t('search parses song list items and extracts artist/title/id', () => {
  const sampleHtml = `
    <div class="song-item">
      <div class="song-title-singers">
        <a href="https://hopamchuan.com/song/2691/con-mua-ngang-qua/?s=1" class="song-title">
          Cơn Mưa Ngang Qua
        </a>
        <span class="song-singers"> -
          <a href="https://hopamchuan.com/artist/9940/m-tp" class="author-item">M-TP</a>
        </span>
      </div>
    </div>
    <div class="song-item">
      <div class="song-title-singers">
        <a href="https://hopamchuan.com/song/31898/mashup-con-mua-ngang-qua" class="song-title">
          Mashup Cơn Mưa Ngang Qua
        </a>
        <span class="song-singers"> -
          <a href="/artist/1" class="author-item">Sơn Tùng M-TP</a>,
          <a href="/artist/2" class="author-item">Yanbi</a>
        </span>
      </div>
    </div>
  `;
  const fetch = () => mockResponse(200, sampleHtml);
  const mod = loadModule(searchCode, { fetch });
  const res = mod.execute({ title: 'Cơn Mưa Ngang Qua' });

  assert.strictEqual(res.ok.length, 2);
  assert.strictEqual(res.ok[0].id, '2691/con-mua-ngang-qua');
  assert.strictEqual(res.ok[0].name, 'Cơn Mưa Ngang Qua');
  assert.deepStrictEqual(res.ok[0].artists, ['M-TP']);

  assert.strictEqual(res.ok[1].id, '31898/mashup-con-mua-ngang-qua');
  assert.strictEqual(res.ok[1].name, 'Mashup Cơn Mưa Ngang Qua');
  assert.deepStrictEqual(res.ok[1].artists, ['Sơn Tùng M-TP', 'Yanbi']);
});

t('lyrics extracts chord annotations by default', () => {
  const samplePage = `
    <div id="song-lyric" class="no-column">
      <div class="pre">
        <div class="chord_lyric_line text_only">Eh..Eh..Eh..</div>
        <div class="chord_lyric_line"><span class="hopamchuan_lyric">Cơn mưa ngang </span><span class="hopamchuan_chord_inline"><i>[</i><span class="hopamchuan_chord">Am</span><i>]</i></span><span class="hopamchuan_lyric">qua…..</span></div>
        <div class="chord_lyric_line"><span class="hopamchuan_lyric">Cơn mưa đi ngang </span><span class="hopamchuan_chord_inline"><i>[</i><span class="hopamchuan_chord">F</span><i>]</i></span><span class="hopamchuan_lyric">qua…</span></div>
        <div class="chord_lyric_line empty_line">&nbsp;</div>
        <div class="chord_lyric_line"><span class="hopamchuan_lyric">Đừng làm rơi </span><span class="hopamchuan_chord_inline"><i>[</i><span class="hopamchuan_chord">C</span><i>]</i></span><span class="hopamchuan_lyric">thêm giọt lệ </span><span class="hopamchuan_chord_inline"><i>[</i><span class="hopamchuan_chord">G</span><i>]</i></span></div>
      </div>
    </div>
    <div id="song-leftover-space"></div>
  `;
  const fetch = () => mockResponse(200, samplePage);
  const mod = loadModule(lyricsCode, { fetch, config: { showChords: true } });
  const res = mod.execute('2691/con-mua-ngang-qua');

  assert.strictEqual(res.ok.type, 'txt');
  assert.ok(res.ok.data.includes('Cơn mưa ngang [Am]qua…..'));
  assert.ok(res.ok.data.includes('Cơn mưa đi ngang [F]qua…'));
  assert.ok(res.ok.data.includes('Đừng làm rơi [C]thêm giọt lệ [G]'));
});

t('lyrics strips chords when showChords is false', () => {
  const samplePage = `
    <div id="song-lyric" class="no-column">
      <div class="pre">
        <div class="chord_lyric_line text_only">Eh..Eh..Eh..</div>
        <div class="chord_lyric_line"><span class="hopamchuan_lyric">Cơn mưa ngang </span><span class="hopamchuan_chord_inline"><i>[</i><span class="hopamchuan_chord">Am</span><i>]</i></span><span class="hopamchuan_lyric">qua…..</span></div>
        <div class="chord_lyric_line"><span class="hopamchuan_lyric">Cơn mưa đi ngang </span><span class="hopamchuan_chord_inline"><i>[</i><span class="hopamchuan_chord">F</span><i>]</i></span><span class="hopamchuan_lyric">qua…</span></div>
      </div>
    </div>
    <div id="song-leftover-space"></div>
  `;
  const fetch = () => mockResponse(200, samplePage);
  const mod = loadModule(lyricsCode, { fetch, config: { showChords: false } });
  const res = mod.execute('2691/con-mua-ngang-qua');

  assert.strictEqual(res.ok.type, 'txt');
  assert.ok(res.ok.data.includes('Cơn mưa ngang qua…..'));
  assert.ok(res.ok.data.includes('Cơn mưa đi ngang qua…'));
  assert.ok(!res.ok.data.includes('[Am]'));
  assert.ok(!res.ok.data.includes('[F]'));
});

console.log(`Passed ${n}/4 tests.`);
