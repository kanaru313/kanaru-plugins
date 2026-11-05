// Offline tests of src/google-translate/: `node tools/check_google_translate.js`.
// Google Translate is stubbed; each test scripts the HTTP answers the plugin gets.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadPlugin, makeResponse } = require('./translate_harness');

const DIR = path.join(__dirname, '..', 'src', 'google-translate');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'plugin.json'), 'utf8'));

/** Helper to generate mock response for free Google Translate endpoint. */
const freeAnswer = (items) => makeResponse(200, items);

/** Helper to generate mock response for Google Cloud Translation API v2. */
const cloudAnswer = (items) => makeResponse(200, {
  data: {
    translations: items.map(([text, lang]) => ({
      translatedText: text,
      detectedSourceLanguage: lang,
    })),
  },
});

function run(input, { replies, config = {} }) {
  const calls = [];
  const queue = Array.isArray(replies) ? replies.slice() : null;
  const fetch = (url, options) => {
    let body = options.body;
    let jsonBody = null;
    let formParams = {};
    if (options.headers && options.headers['content-type'] && options.headers['content-type'].includes('application/json')) {
      try { jsonBody = JSON.parse(body); } catch (e) {}
    } else if (typeof body === 'string') {
      const q = [];
      const parts = body.split('&');
      for (const p of parts) {
        const [k, v] = p.split('=');
        if (k === 'q') q.push(decodeURIComponent(v || ''));
      }
      formParams.q = q;
    }
    const req = {
      url,
      method: options.method,
      headers: options.headers,
      body,
      jsonBody,
      formParams,
    };
    calls.push(req);
    const next = queue ? queue.shift() : replies;
    if (!next) throw new Error('unexpected fetch #' + calls.length);
    return typeof next === 'function' ? next(req) : next;
  };
  const plugin = loadPlugin(DIR, { fetch, config });
  return { result: plugin.execute(input), calls };
}

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

t('plugin manifest structure and fields', () => {
  assert.strictEqual(manifest.metadata.name, 'Google Translate');
  assert.strictEqual(manifest.metadata.type, 'translate');
  assert.strictEqual(manifest.metadata.apiVersion, 1);
  assert(manifest.metadata.hosts.includes('translate.googleapis.com'));
  assert(manifest.metadata.hosts.includes('translate.google.com'));
  assert(manifest.metadata.hosts.includes('translation.googleapis.com'));
  assert.strictEqual(manifest.script.translate, 'translate.js');
  assert(Array.isArray(manifest.translate.languages));
  assert(manifest.translate.languages.includes('vi'));
  assert(manifest.translate.languages.includes('en'));
  assert(manifest.translate.languages.includes('zh-Hans'));
});

t('free endpoint: one item per line; blanks and symbols kept; detected source mapped', () => {
  const echo = (req) => freeAnswer(req.formParams.q.map((text) => ['[vi] ' + text, 'en']));
  const { result, calls } = run({
    lines: ['Hello world', '', '♪ ♪', '(x2)', 'How are you?'],
    to: 'vi',
  }, { replies: echo });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].method, 'POST');
  assert(calls[0].url.startsWith('https://translate.googleapis.com/translate_a/t?client=gtx&sl=auto&tl=vi'));
  assert.deepStrictEqual(calls[0].formParams.q, ['Hello world', 'How are you?']);
  assert.deepStrictEqual(result.ok, [
    { text: '[vi] Hello world', detected: 'en' },
    { text: '' },
    { text: '♪ ♪' },
    { text: '(x2)' },
    { text: '[vi] How are you?', detected: 'en' },
  ]);
});

t('free endpoint: serviceHost selection', () => {
  const echo = (req) => freeAnswer(req.formParams.q.map((text) => ['dịch: ' + text, 'en']));
  const { calls } = run({
    lines: ['Test line'],
    to: 'vi',
  }, {
    replies: echo,
    config: { serviceHost: 'translate.google.com' },
  });

  assert.strictEqual(calls.length, 1);
  assert(calls[0].url.startsWith('https://translate.google.com/translate_a/t'));
});

t('target code mapping and detected tag mapping', () => {
  const echoZhHans = (req) => freeAnswer(req.formParams.q.map((text) => ['[cn] ' + text, 'zh-cn']));
  const zhHans = run({ lines: ['hello'], to: 'zh-Hans' }, { replies: echoZhHans });
  assert(zhHans.calls[0].url.includes('&tl=zh-CN'));
  assert.strictEqual(zhHans.result.ok[0].detected, 'zh-Hans');

  const echoZhHant = (req) => freeAnswer(req.formParams.q.map((text) => ['[tw] ' + text, 'zh-tw']));
  const zhHant = run({ lines: ['hello'], to: 'zh-Hant' }, { replies: echoZhHant });
  assert(zhHant.calls[0].url.includes('&tl=zh-TW'));
  assert.strictEqual(zhHant.result.ok[0].detected, 'zh-Hant');

  const echoHe = (req) => freeAnswer(req.formParams.q.map((text) => ['[he] ' + text, 'iw']));
  const he = run({ lines: ['hello'], to: 'he' }, { replies: echoHe });
  assert(he.calls[0].url.includes('&tl=he'));
  assert.strictEqual(he.result.ok[0].detected, 'he');

  const echoJv = (req) => freeAnswer(req.formParams.q.map((text) => ['[jv] ' + text, 'jw']));
  const jv = run({ lines: ['hello'], to: 'id' }, { replies: echoJv });
  assert.strictEqual(jv.result.ok[0].detected, 'jv');
});

t('unsupported target language reports clear error', () => {
  const { result, calls } = run({ lines: ['hello'], to: 'unsupported-lang' }, { replies: [] });
  assert.strictEqual(calls.length, 0);
  assert(result.error);
  assert(result.error.includes('unsupported-lang'));
});

t('empty lines array returns empty immediately without HTTP request', () => {
  const { result, calls } = run({ lines: [], to: 'vi' }, { replies: [] });
  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual(result.ok, []);
});

t('all blank or symbol lines return immediately without HTTP request', () => {
  const { result, calls } = run({ lines: ['', '   ', '♪ ♪', '(x3)'], to: 'vi' }, { replies: [] });
  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual(result.ok, [
    { text: '' },
    { text: '   ' },
    { text: '♪ ♪' },
    { text: '(x3)' },
  ]);
});

t('free endpoint: handles HTML entities decoding', () => {
  const answerWithEntities = freeAnswer([
    ['&quot;Hello&quot; &amp; &#39;World&#39; &lt;3&gt;', 'en'],
  ]);
  const { result } = run({ lines: ['test'], to: 'vi' }, { replies: answerWithEntities });
  assert.strictEqual(result.ok[0].text, '"Hello" & \'World\' <3>');
});

t('free endpoint: 429 rate limit with Retry-After header', () => {
  const rateLimitRes = makeResponse(429, 'Too many requests', { 'retry-after': '15' });
  const { result } = run({ lines: ['test'], to: 'vi' }, { replies: rateLimitRes });
  assert.strictEqual(result.kind, 'rateLimited');
  assert.strictEqual(result.retryAfterSec, 15);
});

t('cloud endpoint: used when apiKeys are provided', () => {
  const echo = (req) => cloudAnswer(req.jsonBody.q.map((text) => ['[cloud] ' + text, 'en']));
  const { result, calls } = run({
    lines: ['Hello cloud', 'Another line'],
    to: 'vi',
  }, {
    replies: echo,
    config: { apiKeys: ['my-key-1'] },
  });

  assert.strictEqual(calls.length, 1);
  assert(calls[0].url.startsWith('https://translation.googleapis.com/language/translate/v2?key=my-key-1'));
  assert.strictEqual(calls[0].jsonBody.target, 'vi');
  assert.deepStrictEqual(calls[0].jsonBody.q, ['Hello cloud', 'Another line']);
  assert.deepStrictEqual(result.ok, [
    { text: '[cloud] Hello cloud', detected: 'en' },
    { text: '[cloud] Another line', detected: 'en' },
  ]);
});

t('cloud endpoint: key rotation on 401/403 auth failure', () => {
  const fail403 = makeResponse(403, { error: { message: 'API key not valid' } });
  const success = (req) => cloudAnswer(req.jsonBody.q.map((text) => ['ok ' + text, 'en']));

  const { result, calls } = run({
    lines: ['Hello world'],
    to: 'vi',
  }, {
    replies: [fail403, success],
    config: { apiKeys: ['bad-key', 'good-key'] },
  });

  assert.strictEqual(calls.length, 2);
  assert(calls[0].url.includes('key=bad-key'));
  assert(calls[1].url.includes('key=good-key'));
  assert.strictEqual(result.ok[0].text, 'ok Hello world');
});

t('cloud endpoint: all keys failing returns auth error', () => {
  const fail401 = makeResponse(401, { error: { message: 'Unauthorized key' } });
  const fail403 = makeResponse(403, { error: { message: 'Forbidden key' } });

  const { result, calls } = run({
    lines: ['Hello world'],
    to: 'vi',
  }, {
    replies: [fail401, fail403],
    config: { apiKeys: ['key1', 'key2'] },
  });

  assert.strictEqual(calls.length, 2);
  assert.strictEqual(result.kind, 'auth');
});

console.log('check_google_translate: ' + n + ' tests passed');
