// Offline tests for src/baidu-translate/: `node tools/check_baidu_translate.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadPlugin, makeResponse } = require('./translate_harness');

const DIR = path.join(__dirname, '..', 'src', 'baidu-translate');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'plugin.json'), 'utf8'));

const mockAnswer = (items) => makeResponse(200, {
  from: 'en',
  to: 'vie',
  trans_result: items.map(([src, dst]) => ({ src, dst })),
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
  const plugin = loadPlugin(DIR, { fetch, config: { appId: 'test_app_id', appSecret: 'test_secret', ...config } });
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
  assert.strictEqual(manifest.metadata.name, 'Baidu Translate');
  assert.strictEqual(manifest.metadata.type, 'translate');
  assert(manifest.metadata.hosts.includes('fanyi-api.baidu.com'));
  assert.strictEqual(manifest.script.translate, 'translate.js');
  assert(manifest.translate.languages.includes('vi'));
  assert(manifest.translate.languages.includes('zh-Hans'));
});

t('requires appId and appSecret', () => {
  const { result } = run({ lines: ['hello'], to: 'vi' }, { replies: [], config: { appId: '', appSecret: '' } });
  assert.strictEqual(result.kind, 'auth');
  assert(result.error.includes('App ID'));
});

t('translates lines with MD5 signature, sign calculation and detected language mapping', () => {
  const echo = (req) => {
    const lines = req.formParams.q.split('\n');
    return mockAnswer(lines.map((l) => [l, '[vi] ' + l]));
  };
  const { result, calls } = run({
    lines: ['Hello world', '', '♪ ♪', '(x2)', 'How are you?'],
    to: 'vi',
  }, { replies: echo });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].method, 'POST');
  assert.strictEqual(calls[0].url, 'https://fanyi-api.baidu.com/api/trans/vip/translate');
  assert.strictEqual(calls[0].formParams.appid, 'test_app_id');
  assert.strictEqual(calls[0].formParams.to, 'vie');
  assert(calls[0].formParams.sign && calls[0].formParams.sign.length === 32);
  assert.deepStrictEqual(result.ok, [
    { text: '[vi] Hello world', detected: 'en' },
    { text: '' },
    { text: '♪ ♪' },
    { text: '(x2)' },
    { text: '[vi] How are you?', detected: 'en' },
  ]);
});

t('target language mapping: zh-Hans (zh), zh-Hant (cht), ja (jp), ko (kor)', () => {
  const echo = (req) => mockAnswer([['hello', 'ok']]);
  const zhHans = run({ lines: ['hello'], to: 'zh-Hans' }, { replies: echo });
  assert.strictEqual(zhHans.calls[0].formParams.to, 'zh');

  const zhHant = run({ lines: ['hello'], to: 'zh-Hant' }, { replies: echo });
  assert.strictEqual(zhHant.calls[0].formParams.to, 'cht');

  const ja = run({ lines: ['hello'], to: 'ja' }, { replies: echo });
  assert.strictEqual(ja.calls[0].formParams.to, 'jp');

  const ko = run({ lines: ['hello'], to: 'ko' }, { replies: echo });
  assert.strictEqual(ko.calls[0].formParams.to, 'kor');
});

t('error handling: 52003 (auth), 54003 (rate limit), 54004 (quota)', () => {
  const rAuth = run({ lines: ['hello'], to: 'vi' }, { replies: makeResponse(200, { error_code: '52003', error_msg: 'Unauthorized' }) });
  assert.strictEqual(rAuth.result.kind, 'auth');

  const rRate = run({ lines: ['hello'], to: 'vi' }, { replies: makeResponse(200, { error_code: '54003', error_msg: 'Limited' }) });
  assert.strictEqual(rRate.result.kind, 'rateLimited');

  const rQuota = run({ lines: ['hello'], to: 'vi' }, { replies: makeResponse(200, { error_code: '54004', error_msg: 'Quota exhausted' }) });
  assert.strictEqual(rQuota.result.kind, 'quota');
});

console.log('check_baidu_translate: ' + n + ' tests passed');
