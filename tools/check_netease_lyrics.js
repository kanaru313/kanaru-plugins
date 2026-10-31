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
t('lyrics kept, leading credits dropped, -1 stamps normalized', () => {
  const r = run(lrc('[00:00.00-1] 作曲 : x\n[00:00.00-1] 作词 : y\n[00:12.34]hello\n[00:15.5-2]world\n'));
  assert.deepStrictEqual(r, { ok: { type: 'lrc', data: '[00:12.34]hello\n[00:15.5]world' } });
});
t('trailing credits dropped', () => {
  assert.deepStrictEqual(run(lrc('[00:01.00]a\n[00:02.00]b\n[03:00.00] 混音 : m\n[03:01.00-1]制作人：p\n')),
    { ok: { type: 'lrc', data: '[00:01.00]a\n[00:02.00]b' } });
});
t('mid-song credit-looking line kept', () => {
  const text = '[00:01.00]a\n[00:30.00]词：x\n[00:40.00]b';
  assert.deepStrictEqual(run(lrc(text)), { ok: { type: 'lrc', data: text } });
});
t('leading and trailing credits around a mid line', () => {
  assert.deepStrictEqual(run(lrc('[00:00.00]作词 : a\n[00:01.00]x\n[00:30.00]曲：m\n[00:40.00]y\n[04:00.00]编曲 : e')),
    { ok: { type: 'lrc', data: '[00:01.00]x\n[00:30.00]曲：m\n[00:40.00]y' } });
});
t('plain text with leading credits is txt without them', () => {
  assert.deepStrictEqual(run(lrc('作词 : a\n作曲 : b\nline one\nline two')),
    { ok: { type: 'txt', data: 'line one\nline two' } });
});
// Rule: the leading block is every credit/metadata/blank line before the first
// real line, cut after its last credit line. Metadata or blanks before or
// between credits go with it; metadata after the last credit stays.
t('metadata and blanks before and inside the credit block are dropped', () => {
  assert.deepStrictEqual(run(lrc('[ti:t]\n[ar:a]\n\n[00:00.00]作词 : a\n\n[by:x]\n[00:01.00]作曲 : b\n[00:02.00]hi\n')),
    { ok: { type: 'lrc', data: '[00:02.00]hi' } });
});
t('metadata after the credit block stays', () => {
  assert.deepStrictEqual(run(lrc('[00:00.00]作词 : a\n[offset:100]\n[00:02.00]hi')),
    { ok: { type: 'lrc', data: '[offset:100]\n[00:02.00]hi' } });
});
t('metadata without credits stays', () => {
  const text = '[ti:t]\n[00:02.00]hi';
  assert.deepStrictEqual(run(lrc(text)), { ok: { type: 'lrc', data: text } });
});
t('fullwidth colon and new roles', () => {
  assert.deepStrictEqual(run(lrc('[00:00.00]作詞：a\n[00:00.00]編曲：b\n[00:00.00]监制：c\n[00:00.00]词：d\n[00:00.00]曲：e\n[00:01.00]go')),
    { ok: { type: 'lrc', data: '[00:01.00]go' } });
});
t('a line without colon is not a credit', () => {
  const text = '[00:10.00]曲终人散\n[00:20.00]词不达意';
  assert.deepStrictEqual(run(lrc(text)), { ok: { type: 'lrc', data: text } });
});
t('CRLF input drops leading credits and the final blank', () => {
  assert.deepStrictEqual(run(lrc('[00:00.00] 作词 : a\r\n[00:01.00]hello\r\n')),
    { ok: { type: 'lrc', data: '[00:01.00]hello' } });
});
t('credit line with several stamps is stripped', () => {
  assert.deepStrictEqual(run(lrc('[00:00.00][00:20.00]词：x\n[00:01.00]la')),
    { ok: { type: 'lrc', data: '[00:01.00]la' } });
});
t('trailing credit followed by a final newline is stripped', () => {
  assert.deepStrictEqual(run(lrc('[00:01.00]la\n[03:00.00]制作人：y\n')),
    { ok: { type: 'lrc', data: '[00:01.00]la' } });
});
t('section header before a credit-looking line keeps both', () => {
  assert.deepStrictEqual(run(lrc('[Chorus]\n词：x\nla')),
    { ok: { type: 'txt', data: '[Chorus]\n词：x\nla' } });
});
t('long NetEase credit block (十年) is cut, lyrics start at the first line', () => {
  const head = '[00:00.00] 作曲 : 陈小霞\n[00:01.00] 编曲 : 梁翘柏\n[00:02.00] 制作人 : 陈奕迅\n' +
    '[00:03.00] 录音师 : 陈忠宏/亚祥 (HK)\n[00:04.00] 录音室 : 白金/AVON (HK)\n' +
    '[00:05.00] 混音工程师 : 王家栋\n[00:06.00] 混音录音室 : 节奏\n';
  assert.deepStrictEqual(run(lrc(head + '[00:15.54]如果那两个字没有颤抖\n[00:20.00]我不会发现我难受')),
    { ok: { type: 'lrc', data: '[00:15.54]如果那两个字没有颤抖\n[00:20.00]我不会发现我难受' } });
});
t('credits-only text with long roles is no lyrics', () => {
  assert.deepStrictEqual(run(lrc('[00:00.00] 录音师 : a\n[00:01.00] 混音工程师 : b\n')), { ok: null });
});
t('mid-song long-role credit-looking line kept', () => {
  const text = '[00:01.00]a\n[01:00.00]录音师 : x\n[01:10.00]b';
  assert.deepStrictEqual(run(lrc(text)), { ok: { type: 'lrc', data: text } });
});
t('single-char roles take no suffix', () => {
  const text = '[00:10.00]曲终人散\n[00:20.00]词不达意：x';
  assert.deepStrictEqual(run(lrc(text)), { ok: { type: 'lrc', data: text } });
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
