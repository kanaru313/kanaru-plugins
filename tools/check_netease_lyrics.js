// Smoke test of src/netease/src/lyrics.js: `node tools/check_netease_lyrics.js`.
// Stubs the plugin globals (load, Response, neteaseGet) and runs execute().
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = path.join(__dirname, '..', 'src', 'netease', 'src', 'lyrics.js');
const code = fs.readFileSync(src, 'utf8');

function run(json) {
  const Response = {
    success: (v) => ({ ok: v }),
    error: (m, o) => ({ error: m, ...o }),
  };
  const g = {
    load() {},
    Response,
    invalidResponse: (why) => Response.error(why, { kind: 'invalidResponse' }),
    neteaseGet: () => ({ json }),
  };
  const fn = new Function(...Object.keys(g), code + '\nreturn execute;')(...Object.values(g));
  return fn('1');
}
const lrc = (lyric, extra = {}) => ({ code: 200, lrc: { version: 1, lyric }, ...extra });

let n = 0;
function t(name, f) { f(); n++; }

t('exact reported payload is no lyrics', () => {
  assert.deepStrictEqual(
    run({ lrc: { version: 1, lyric: '[00:00.00-1] 作曲 : Châu Đăng Khoa\n' }, code: 200 }),
    { ok: null });
});
t('credits with plain stamps are no lyrics', () => {
  assert.deepStrictEqual(run(lrc('[00:00.00] 作词 : a\n[00:01.00] 作曲 : b\n')), { ok: null });
});
t('-1 stamps on several credit lines are no lyrics', () => {
  assert.deepStrictEqual(run(lrc('[00:00.00-1] 作词 : a\n[00:00.00-1] 作曲 : b')), { ok: null });
});
t('placeholder with -1 stamp is no lyrics', () => {
  assert.deepStrictEqual(run(lrc('[00:00.00-1]暂无歌词')), { ok: null });
});
t('lyrics kept, -1 stamps normalized', () => {
  const r = run(lrc('[00:00.00-1] 作曲 : x\n[00:00.00-1] 作词 : y\n[00:12.34]hello\n[00:15.5-2]world\n'));
  assert.deepStrictEqual(r, {
    ok: { type: 'lrc', data: '[00:00.00] 作曲 : x\n[00:00.00] 作词 : y\n[00:12.34]hello\n[00:15.5]world\n' },
  });
});
t('normal lyric untouched', () => {
  const text = '[00:01.00]a\n[00:02.000]b\n[01:02:03]c';
  assert.deepStrictEqual(run(lrc(text)), { ok: { type: 'lrc', data: text } });
});
t('plain text stays txt', () => {
  assert.deepStrictEqual(run(lrc('line one\nline two')), { ok: { type: 'txt', data: 'line one\nline two' } });
});
t('bracket section header is lyrics', () => {
  assert.deepStrictEqual(run(lrc('[Chorus]\nla')).ok.type, 'txt');
});
t('pure music text and flag', () => {
  assert.deepStrictEqual(run(lrc('[00:00.00-1]纯音乐，请欣赏')), { ok: { instrumental: true } });
  assert.deepStrictEqual(run({ code: 200, pureMusic: true }), { ok: { instrumental: true } });
});
t('uncollected without lrc is no lyrics', () => {
  assert.deepStrictEqual(run({ code: 200, uncollected: true }), { ok: null });
});
t('missing lrc without flag is an error', () => {
  assert.strictEqual(run({ code: 200 }).kind, 'invalidResponse');
});

console.log(`ok: ${n} cases`);
