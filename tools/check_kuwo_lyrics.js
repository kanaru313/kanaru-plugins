// Offline unit tests for src/kuwo: `node tools/check_kuwo_lyrics.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DIR = path.join(__dirname, '..', 'src', 'kuwo');
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
  const factory = new Function('Response', 'fetch', inlined + '\nreturn { execute, formatLrcTime, isCredit };');
  return factory(Response, fetch);
}

const mockResponse = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: () => (typeof body === 'string' ? JSON.parse(body) : body),
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
  assert.strictEqual(manifest.metadata.name, 'Kuwo Music');
  assert.strictEqual(manifest.metadata.type, 'lyrics');
  assert.ok(manifest.metadata.hosts.includes('search.kuwo.cn'));
  assert.ok(manifest.metadata.hosts.includes('kuwo.cn'));
  assert.strictEqual(manifest.script.search, 'search.js');
  assert.strictEqual(manifest.script.lyrics, 'lyrics.js');
});

t('formatLrcTime converts seconds float to [mm:ss.xx]', () => {
  const mod = loadModule(searchCode, { fetch: () => {} });
  assert.strictEqual(mod.formatLrcTime('0.0'), '[00:00.00]');
  assert.strictEqual(mod.formatLrcTime('2.25'), '[00:02.25]');
  assert.strictEqual(mod.formatLrcTime('125.75'), '[02:05.75]');
});

t('search maps abslist and decodes entities', () => {
  const fetch = (url) => {
    assert.ok(url.includes('all=%E6%99%B4%E5%A4%A9'));
    return mockResponse(200, {
      abslist: [
        {
          DC_TARGETID: '228908',
          SONGNAME: '&#26228;&#22825;',
          ARTIST: '&#21608;&#26480;&#20262;',
          ALBUM: '&#21494;&#24800;&#32654;',
          DURATION: '269',
        },
      ],
    });
  };
  const mod = loadModule(searchCode, { fetch });
  const res = mod.execute({ title: '晴天' });

  assert.strictEqual(res.ok.length, 1);
  assert.strictEqual(res.ok[0].id, '228908');
  assert.strictEqual(res.ok[0].title, '晴天');
  assert.strictEqual(res.ok[0].artist, '周杰伦');
  assert.strictEqual(res.ok[0].album, '叶惠美');
  assert.strictEqual(res.ok[0].durationMs, 269000);
});

t('lyrics.js converts lrclist into synced LRC and strips opening credits', () => {
  const fetch = () => mockResponse(200, {
    data: {
      lrclist: [
        { lineLyric: '词：周杰伦', time: '0.0' },
        { lineLyric: '曲：周杰伦', time: '2.0' },
        { lineLyric: '故事的小黄花', time: '4.5' },
        { lineLyric: '从出生那年就飘着', time: '8.2' },
      ],
    },
  });
  const mod = loadModule(lyricsCode, { fetch });
  const res = mod.execute('228908');

  assert.strictEqual(res.ok.type, 'lrc');
  assert.ok(!res.ok.data.includes('词：周杰伦'));
  assert.ok(res.ok.data.includes('[00:04.50] 故事的小黄花'));
  assert.ok(res.ok.data.includes('[00:08.20] 从出生那年就飘着'));
});

t('lyrics.js detects instrumental tracks', () => {
  const fetch = () => mockResponse(200, {
    data: {
      lrclist: [
        { lineLyric: '纯音乐，请欣赏', time: '0.0' },
      ],
    },
  });
  const mod = loadModule(lyricsCode, { fetch });
  const res = mod.execute('999');
  assert.deepStrictEqual(res.ok, { instrumental: true });
});

console.log('check_kuwo_lyrics: ' + n + ' tests passed');
