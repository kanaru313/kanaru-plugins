// Offline unit tests for src/vocaloidlyrics: `node tools/check_vocaloidlyrics_lyrics.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DIR = path.join(__dirname, '..', 'src', 'vocaloidlyrics');
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
  const factory = new Function('Response', 'fetch', 'localConfig', inlined + '\nreturn { execute, cleanWikitext };');
  return factory(Response, fetch, localConfig);
}

const mockResponse = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
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
  assert.strictEqual(manifest.metadata.name, 'Vocaloid Lyrics Wiki');
  assert.strictEqual(manifest.metadata.type, 'lyrics');
  assert.ok(manifest.metadata.hosts.includes('vocaloidlyrics.miraheze.org'));
  assert.strictEqual(manifest.script.search, 'search.js');
  assert.strictEqual(manifest.script.lyrics, 'lyrics.js');
});

t('search maps search results and filters non-songs', () => {
  const fetch = (url) => {
    assert.ok(url.includes('srsearch=Melt'));
    return mockResponse(200, {
      query: {
        search: [
          { pageid: 1234, title: 'Melt (ryo)' },
          { pageid: 5678, title: 'Supercell (album)' }, // filter
          { pageid: 9012, title: 'Melt feat. Hatsune Miku' },
        ],
      },
    });
  };
  const mod = loadModule(searchCode, { fetch });
  const res = mod.execute({ title: 'Melt' });

  assert.strictEqual(res.ok.length, 2);
  assert.strictEqual(res.ok[0].id, '1234');
  assert.strictEqual(res.ok[0].title, 'Melt');
  assert.strictEqual(res.ok[1].id, '9012');
});

t('lyrics.js parses 3-column wikitext table and formats all sections', () => {
  const sampleWikitext = `==Lyrics==
{| class="wikitable"
|-
|大胆不敵にハイカラ革命
|daitanfuteki ni haikara kakumei
|Bold and fearless revolution<ref>test</ref>
|-
|{{ruby|反戦|はんせん}}国家
|hansen kokka
|Pacifist nation
|}`;

  const fetch = () => mockResponse(200, {
    parse: {
      wikitext: {
        '*': sampleWikitext,
      },
    },
  });

  const modAll = loadModule(lyricsCode, { fetch, config: { preferredSection: 'all' } });
  const resAll = modAll.execute('180528');
  assert.ok(resAll.ok.data.includes('[Japanese]'));
  assert.ok(resAll.ok.data.includes('大胆不敵にハイカラ革命'));
  assert.ok(resAll.ok.data.includes('[Romaji]'));
  assert.ok(resAll.ok.data.includes('daitanfuteki ni haikara kakumei'));
  assert.ok(resAll.ok.data.includes('[English]'));
  assert.ok(resAll.ok.data.includes('Bold and fearless revolution'));
  assert.ok(!resAll.ok.data.includes('<ref>'));

  const modRom = loadModule(lyricsCode, { fetch, config: { preferredSection: 'romaji' } });
  const resRom = modRom.execute('180528');
  assert.strictEqual(resRom.ok.data, 'daitanfuteki ni haikara kakumei\nhansen kokka');
});

console.log('check_vocaloidlyrics_lyrics: ' + n + ' tests passed');
