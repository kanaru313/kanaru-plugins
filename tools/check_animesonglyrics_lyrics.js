// Offline unit tests for src/animesonglyrics: `node tools/check_animesonglyrics_lyrics.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DIR = path.join(__dirname, '..', 'src', 'animesonglyrics');
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
  const factory = new Function('Response', 'fetch', 'localConfig', inlined + '\nreturn { execute, cleanHtml };');
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
  assert.strictEqual(manifest.metadata.name, 'Anime Song Lyrics');
  assert.strictEqual(manifest.metadata.type, 'lyrics');
  assert.ok(manifest.metadata.hosts.includes('www.animesonglyrics.com'));
  assert.strictEqual(manifest.script.search, 'search.js');
  assert.strictEqual(manifest.script.lyrics, 'lyrics.js');
});

t('search parses song list items and extracts artist/title', () => {
  const sampleHtml = `
    <a href="https://www.animesonglyrics.com/kimetsu-no-yaiba" class="list-group-item">Anime Series (filter)</a>
    <a href="https://www.animesonglyrics.com/kimetsu-no-yaiba/gurenge" class="list-group-item">
      Demon Slayer : LiSA - Gurenge
      [TV Version] Tsuyoku nareru
    </a>
  `;
  const fetch = () => mockResponse(200, sampleHtml);
  const mod = loadModule(searchCode, { fetch });
  const res = mod.execute({ title: 'Gurenge' });

  assert.strictEqual(res.ok.length, 1);
  assert.strictEqual(res.ok[0].id, 'kimetsu-no-yaiba/gurenge');
  assert.strictEqual(res.ok[0].title, 'Gurenge');
  assert.strictEqual(res.ok[0].artist, 'LiSA');
});

t('lyrics.js extracts Romaji, Kanji, and English sections', () => {
  const samplePage = `
    <div class="romajilyrics-sbs">Tsuyoku nareru riyuu wo shitta<br />Boku wo tsurete susume</div>
    <div class="kanjilyrics-sbs">強くなれる理由を知った<br />僕を連れて進め</div>
    <div class="englishlyrics-sbs">I have discovered why I can be strong<br />Take me along and advance</div>
  `;
  const fetch = () => mockResponse(200, samplePage);

  const modAll = loadModule(lyricsCode, { fetch, config: { preferredSection: 'all' } });
  const resAll = modAll.execute('kimetsu-no-yaiba/gurenge');
  assert.ok(resAll.ok.data.includes('[Romaji]\nTsuyoku nareru riyuu wo shitta'));
  assert.ok(resAll.ok.data.includes('[Kanji]\n強くなれる理由を知った'));
  assert.ok(resAll.ok.data.includes('[English]\nI have discovered why I can be strong'));

  const modRom = loadModule(lyricsCode, { fetch, config: { preferredSection: 'romaji' } });
  const resRom = modRom.execute('kimetsu-no-yaiba/gurenge');
  assert.strictEqual(resRom.ok.data, 'Tsuyoku nareru riyuu wo shitta\nBoku wo tsurete susume');
});

console.log('check_animesonglyrics_lyrics: ' + n + ' tests passed');
