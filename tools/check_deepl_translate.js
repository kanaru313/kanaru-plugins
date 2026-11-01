// Offline tests of src/deepl-translate/: `node tools/check_deepl_translate.js`.
// DeepL is stubbed; each test scripts the HTTP answers the plugin gets.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadPlugin, makeResponse } = require('./translate_harness');

const DIR = path.join(__dirname, '..', 'src', 'deepl-translate');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'plugin.json'), 'utf8'));

const answer = (items) => makeResponse(200, { translations: items });
/** Echo translator: "[x] <line>" detected as English. */
const echo = (req) => answer(req.body.text.map((t) => ({ text: '[x] ' + t, detected_source_language: 'EN' })));

function run(input, { replies, config = {} }) {
  const calls = [];
  const queue = Array.isArray(replies) ? replies.slice() : null;
  const fetch = (url, options) => {
    const req = { url, headers: options.headers, body: JSON.parse(options.body), method: options.method };
    calls.push(req);
    const next = queue ? queue.shift() : replies;
    if (!next) throw new Error('unexpected fetch #' + calls.length);
    return typeof next === 'function' ? next(req) : next;
  };
  const plugin = loadPlugin(DIR, { fetch, config: { apiKey: 'secret-key', ...config } });
  return { result: plugin.execute(input), calls };
}

let n = 0;
const t = (name, f) => { try { f(); n++; } catch (e) { console.error('FAIL', name); throw e; } };

t('one item per line; blank and symbol lines kept and not sent; detected lower-cased', () => {
  const { result, calls } = run({ lines: ['Hello there', '', '♪ ♪', '(x2)', 'Goodbye'], to: 'vi' }, { replies: echo });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].method, 'POST');
  assert.strictEqual(calls[0].url, 'https://api.deepl.com/v2/translate');
  assert.deepStrictEqual(calls[0].body.text, ['Hello there', 'Goodbye']);
  assert.strictEqual(calls[0].body.target_lang, 'VI');
  assert.deepStrictEqual(result.ok, [
    { text: '[x] Hello there', detected: 'en' }, { text: '' }, { text: '♪ ♪' }, { text: '(x2)' },
    { text: '[x] Goodbye', detected: 'en' }]);
});

t('auth header, free host for a :fx key, pro host otherwise', () => {
  const free = run({ lines: ['hi there'], to: 'vi' }, { replies: echo, config: { apiKey: 'abc:fx' } }).calls[0];
  assert.strictEqual(free.url, 'https://api-free.deepl.com/v2/translate');
  assert.strictEqual(free.headers.authorization, 'DeepL-Auth-Key abc:fx');
  const pro = run({ lines: ['hi there'], to: 'vi' }, { replies: echo, config: { apiKey: ' abc ' } }).calls[0];
  assert.strictEqual(pro.url, 'https://api.deepl.com/v2/translate');
  assert.strictEqual(pro.headers.authorization, 'DeepL-Auth-Key abc');
});

t('target codes: variants, Chinese, Norwegian; unknown language', () => {
  const to = (code, config) => run({ lines: ['hi there'], to: code }, { replies: echo, config }).calls[0].body.target_lang;
  assert.strictEqual(to('en'), 'EN-US');
  assert.strictEqual(to('en', { englishVariant: 'en-GB' }), 'EN-GB');
  assert.strictEqual(to('pt'), 'PT-BR');
  assert.strictEqual(to('pt', { portugueseVariant: 'pt-PT' }), 'PT-PT');
  assert.strictEqual(to('zh-Hans'), 'ZH-HANS');
  assert.strictEqual(to('zh-Hant'), 'ZH-HANT');
  assert.strictEqual(to('no'), 'NB');
  const { result, calls } = run({ lines: ['hi there'], to: 'mi' }, { replies: [] });
  assert.strictEqual(calls.length, 0);
  assert.match(result.error, /"mi"/);
});

t('formality sent only when set; context from title and artist, toggle off drops it', () => {
  const song = { title: 'Sakura', artist: 'Folk', lyrics: 'a\nb' };
  const a = run({ lines: ['hi there'], to: 'de', song }, { replies: echo, config: { formality: 'prefer_less' } }).calls[0].body;
  assert.strictEqual(a.formality, 'prefer_less');
  assert.strictEqual(a.context, 'Song lyrics: "Sakura" by Folk');
  assert.ok(!JSON.stringify(a).includes('"a\\nb"'));
  const b = run({ lines: ['hi there'], to: 'de', song }, { replies: echo, config: { useSongContext: 'false' } }).calls[0].body;
  assert.strictEqual(b.formality, undefined);
  assert.strictEqual(b.context, undefined);
  const c = run({ lines: ['hi there'], to: 'de' }, { replies: echo }).calls[0].body;
  assert.strictEqual(c.context, undefined);
});

t('detected: Norwegian NB becomes no, bare ZH stays zh, missing stays undefined', () => {
  const { result } = run({ lines: ['a b', 'c d', 'e f'], to: 'vi' }, {
    replies: [answer([{ text: 'x', detected_source_language: 'NB' }, { text: 'y', detected_source_language: 'ZH' }, { text: 'z' }])],
  });
  assert.deepStrictEqual(result.ok.map((x) => x.detected), ['no', 'zh', undefined]);
});

t('only lines without letters: no request', () => {
  const { result, calls } = run({ lines: ['', '...'], to: 'vi' }, { replies: [] });
  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual(result.ok.map((x) => x.text), ['', '...']);
});

t('no key: kind auth, nothing sent', () => {
  const { result, calls } = run({ lines: ['hi there'], to: 'vi' }, { replies: [], config: { apiKey: '' } });
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(result.kind, 'auth');
});

t('HTTP errors map to kinds', () => {
  const kind = (status, headers) => run({ lines: ['hi there'], to: 'vi' }, {
    replies: [makeResponse(status, { message: 'm' }, headers)],
  }).result;
  assert.strictEqual(kind(403).kind, 'auth');
  assert.strictEqual(kind(456).kind, 'quota');
  assert.strictEqual(kind(400).kind, 'invalidResponse');
  assert.strictEqual(kind(500).kind, 'server');
  assert.strictEqual(kind(504).kind, 'server');
  const limited = kind(429, { 'Retry-After': '7' });
  assert.strictEqual(limited.kind, 'rateLimited');
  assert.strictEqual(limited.retryAfterSec, 7);
  assert.strictEqual(kind(529).kind, 'rateLimited');
  assert.strictEqual(kind(529).retryAfterSec, undefined);
  assert.match(kind(403).error, /HTTP 403: m/);
});

t('one send per chunk, never more', () => {
  const { calls } = run({ lines: ['hi there', 'you too'], to: 'vi' }, { replies: [makeResponse(503, {})] });
  assert.strictEqual(calls.length, 1);
});

t('wrong count, non-JSON and missing text are invalid responses', () => {
  const bad = (reply) => run({ lines: ['hi there', 'you too'], to: 'vi' }, { replies: [reply] }).result;
  assert.strictEqual(bad(answer([{ text: 'x' }])).kind, 'invalidResponse');
  assert.strictEqual(bad(makeResponse(200, 'not json')).kind, 'invalidResponse');
  assert.strictEqual(bad(answer([{ text: 'x' }, {}])).kind, 'invalidResponse');
});

t('the key never appears in an error message', () => {
  const { result } = run({ lines: ['hi there'], to: 'vi' }, { replies: [makeResponse(403, { message: 'Forbidden' })] });
  assert.ok(!JSON.stringify(result).includes('secret-key'));
});

t('manifest: contract limits, languages map to targets, config valid', () => {
  const m = manifest.translate;
  assert.strictEqual(manifest.metadata.type, 'translate');
  assert.strictEqual(manifest.metadata.supportUrl, undefined);
  assert.strictEqual(manifest.script.translate, 'translate.js');
  assert.deepStrictEqual(manifest.metadata.hosts, ['api-free.deepl.com', 'api.deepl.com']);
  assert.ok(m.maxLines <= 50 && m.maxLines >= 10 && m.maxChars >= 1000 && m.timeoutSec <= 90);
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'gemini-translate', 'plugin.json'), 'utf8')).translate.languages;
  const languages = fs.readFileSync(path.join(DIR, 'src', 'languages.js'), 'utf8');
  for (const code of m.languages) {
    assert.ok(app.includes(code), code + ' is in the app table');
    assert.ok(languages.includes(code.includes('-') ? `'${code}'` : `${code}:`), code + ' has a target');
  }
  assert.strictEqual(new Set(m.languages).size, m.languages.length);
  for (const [key, field] of Object.entries(manifest.config)) {
    assert.match(key, /^[A-Za-z0-9_]{1,40}$/);
    assert.ok(field.title.length <= 80 && (!field.subtitle || field.subtitle.length <= 300), key);
    if (field.mode === 'select') assert.ok(field.options.some((o) => o.value === field.default), key);
  }
});

console.log(`ok ${n} tests`);
