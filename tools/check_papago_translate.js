// Offline tests for src/papago-translate/: `node tools/check_papago_translate.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadPlugin, makeResponse } = require('./translate_harness');

const DIR = path.join(__dirname, '..', 'src', 'papago-translate');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'plugin.json'), 'utf8'));

const mockAnswer = (translatedText, srcLang = 'ko', tarLang = 'vi') => makeResponse(200, {
  message: {
    result: {
      srcLangType: srcLang,
      tarLangType: tarLang,
      translatedText: translatedText,
    },
  },
});

function run(input, { replies, config = {} }) {
  const calls = [];
  const queue = Array.isArray(replies) ? replies.slice() : null;
  const fetch = (url, options) => {
    let body = options.body;
    let formParams = {};
    if (typeof body === 'string') {
      const parts = body.split('&');
      for (const p of parts) {
        const [k, v] = p.split('=');
        formParams[k] = decodeURIComponent(v || '');
      }
    }
    const req = { url, method: options.method, headers: options.headers, body, formParams };
    calls.push(req);
    const next = queue ? queue.shift() : replies;
    if (!next) throw new Error('unexpected fetch #' + calls.length);
    return typeof next === 'function' ? next(req) : next;
  };
  const plugin = loadPlugin(DIR, { fetch, config: { clientId: 'test_client_id', clientSecret: 'test_client_secret', ...config } });
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
  assert.strictEqual(manifest.metadata.name, 'Naver Papago Translate');
  assert.strictEqual(manifest.metadata.type, 'translate');
  assert(manifest.metadata.hosts.includes('papago.apigw.ntruss.com'));
  assert(manifest.metadata.hosts.includes('openapi.naver.com'));
  assert.strictEqual(manifest.script.translate, 'translate.js');
  assert(manifest.translate.languages.includes('vi'));
  assert(manifest.translate.languages.includes('ko'));
  assert(manifest.translate.languages.includes('ja'));
  assert(manifest.translate.languages.includes('zh-Hans'));
});

t('requires clientId and clientSecret', () => {
  const { result } = run({ lines: ['hello'], to: 'vi' }, { replies: [], config: { clientId: '', clientSecret: '' } });
  assert.strictEqual(result.kind, 'auth');
  assert(result.error.includes('Client ID'));
});

t('translates lines with NCP service by default, preserving symbols', () => {
  const echo = (req) => {
    const lines = req.formParams.text.split('\n');
    return mockAnswer(lines.map((l) => '[vi] ' + l).join('\n'), 'ko', 'vi');
  };
  const { result, calls } = run({
    lines: ['안녕하세요', '', '♪ ♪', '(x2)', '반갑습니다'],
    to: 'vi',
  }, { replies: echo });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].method, 'POST');
  assert.strictEqual(calls[0].url, 'https://papago.apigw.ntruss.com/nmt/v1/translation');
  assert.strictEqual(calls[0].headers['X-NCP-APIGW-API-KEY-ID'], 'test_client_id');
  assert.strictEqual(calls[0].headers['X-NCP-APIGW-API-KEY'], 'test_client_secret');
  assert.strictEqual(calls[0].formParams.source, 'auto');
  assert.strictEqual(calls[0].formParams.target, 'vi');
  assert.deepStrictEqual(result.ok, [
    { text: '[vi] 안녕하세요', detected: 'ko' },
    { text: '' },
    { text: '♪ ♪' },
    { text: '(x2)' },
    { text: '[vi] 반갑습니다', detected: 'ko' },
  ]);
});

t('translates with Naver Developers endpoint when apiType is developers', () => {
  const echo = (req) => mockAnswer('[en] ' + req.formParams.text, 'ko', 'en');
  const { result, calls } = run({
    lines: ['안녕하세요'],
    to: 'en',
  }, { replies: echo, config: { apiType: 'developers' } });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://openapi.naver.com/v1/papago/n2mt');
  assert.strictEqual(calls[0].headers['X-Naver-Client-Id'], 'test_client_id');
  assert.strictEqual(calls[0].headers['X-Naver-Client-Secret'], 'test_client_secret');
  assert.deepStrictEqual(result.ok, [
    { text: '[en] 안녕하세요', detected: 'ko' },
  ]);
});

t('target language mapping: zh-Hans (zh-CN), zh-Hant (zh-TW)', () => {
  const echo = (req) => mockAnswer('ok', 'en', req.formParams.target);
  const zhHans = run({ lines: ['hello'], to: 'zh-Hans' }, { replies: echo });
  assert.strictEqual(zhHans.calls[0].formParams.target, 'zh-CN');

  const zhHant = run({ lines: ['hello'], to: 'zh-Hant' }, { replies: echo });
  assert.strictEqual(zhHant.calls[0].formParams.target, 'zh-TW');
});

t('sends honorific=true when translating into Korean with honorific enabled', () => {
  const echo = (req) => mockAnswer('안녕하세요', 'en', 'ko');
  const res = run({ lines: ['hello'], to: 'ko' }, { replies: echo, config: { honorific: true } });
  assert.strictEqual(res.calls[0].formParams.honorific, 'true');
});

t('falls back to line-by-line translation when batch line count mismatches', () => {
  // First batch returns 1 line instead of 2 lines
  const replies = [
    mockAnswer('Single merged line', 'ja', 'vi'), // batch call (mismatch)
    mockAnswer('Dòng 1', 'ja', 'vi'),             // fallback call 1
    mockAnswer('Dòng 2', 'ja', 'vi'),             // fallback call 2
  ];
  const { result, calls } = run({
    lines: ['Line 1', 'Line 2'],
    to: 'vi',
  }, { replies });

  assert.strictEqual(calls.length, 3);
  assert.deepStrictEqual(result.ok, [
    { text: 'Dòng 1', detected: 'ja' },
    { text: 'Dòng 2', detected: 'ja' },
  ]);
});

t('handles authentication errors (401)', () => {
  const { result } = run({ lines: ['hello'], to: 'vi' }, {
    replies: [makeResponse(401, { errorMessage: 'Authentication failed', errorCode: '024' })],
  });
  assert.strictEqual(result.kind, 'auth');
});

t('handles quota exceeded error (010)', () => {
  const { result } = run({ lines: ['hello'], to: 'vi' }, {
    replies: [makeResponse(429, { error: { errorCode: '010', message: 'Quota exceeded' } })],
  });
  assert.strictEqual(result.kind, 'quota');
});

console.log('check_papago_translate: ' + n + ' tests passed');
