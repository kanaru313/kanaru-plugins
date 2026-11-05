// Offline tests for src/immersive-translate/: `node tools/check_immersive_translate.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadPlugin, makeResponse } = require('./translate_harness');

const DIR = path.join(__dirname, '..', 'src', 'immersive-translate');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'plugin.json'), 'utf8'));

function run(input, { replies, config = {} }) {
  const calls = [];
  const queue = Array.isArray(replies) ? replies.slice() : null;
  const fetch = (url, options) => {
    let jsonBody = null;
    if (options.body) {
      try { jsonBody = JSON.parse(options.body); } catch (_) {}
    }
    const req = { url, method: options.method, headers: options.headers, body: options.body, jsonBody };
    calls.push(req);
    const next = queue ? queue.shift() : replies;
    if (!next) throw new Error('unexpected fetch #' + calls.length);
    return typeof next === 'function' ? next(req) : next;
  };
  const plugin = loadPlugin(DIR, { fetch, config: { userToken: 'test-token', ...config } });
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
  assert.strictEqual(manifest.metadata.name, 'Immersive Translate');
  assert.strictEqual(manifest.metadata.type, 'translate');
  assert(manifest.metadata.hosts.includes('api2.immersivetranslate.com'));
  assert.strictEqual(manifest.script.translate, 'translate.js');
  assert(manifest.translate.languages.includes('vi'));
});

t('requires user token', () => {
  const { result } = run({ lines: ['hello'], to: 'vi' }, { replies: [], config: { userToken: '' } });
  assert.strictEqual(result.kind, 'auth');
  assert(result.error.includes('token'));
});

t('BabelFast Pro SSE translation', () => {
  const sseResponse = [
    'data: {"tr":[{"k":"ok","id":0,"tr":[{"k":"p","cnt":"Xin chào"}]}]}',
    'data: {"tr":[{"k":"ok","id":1,"tr":[{"k":"p","cnt":"Thế giới"}]}]}',
    'data: [DONE]'
  ].join('\n');

  const { result, calls } = run({
    lines: ['Hello', '', '♪', 'World'],
    to: 'vi',
  }, {
    replies: makeResponse(200, sseResponse),
    config: { model: 'babelfast-pro' }
  });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].headers.token, 'test-token');
  assert.strictEqual(calls[0].jsonBody.to, 'vi');
  assert.deepStrictEqual(result.ok, [
    { text: 'Xin chào' },
    { text: '' },
    { text: '♪' },
    { text: 'Thế giới' }
  ]);
});

t('DeepL Pro model translation', () => {
  const deepLAnswer = makeResponse(200, {
    translations: [
      { text: 'Xin chào', detected_source_language: 'EN' },
      { text: 'Tạm biệt', detected_source_language: 'EN' }
    ]
  });

  const { result, calls } = run({
    lines: ['Hello', 'Goodbye'],
    to: 'vi'
  }, {
    replies: deepLAnswer,
    config: { model: 'deepl-pro' }
  });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://api2.immersivetranslate.com/deepl/translate');
  assert.deepStrictEqual(result.ok, [
    { text: 'Xin chào', detected: 'en' },
    { text: 'Tạm biệt', detected: 'en' }
  ]);
});

t('LLM model translation with numbered lines', () => {
  const llmAnswer = makeResponse(200, {
    choices: [
      {
        message: {
          content: '[1] Xin chào bạn\n[2] Chúc một ngày tốt lành'
        }
      }
    ]
  });

  const { result, calls } = run({
    lines: ['Hello friend', 'Have a nice day'],
    to: 'vi'
  }, {
    replies: llmAnswer,
    config: { model: 'openai-pro' }
  });

  assert.strictEqual(calls.length, 1);
  assert(calls[0].url.includes('openai/v1/chat/completions'));
  assert.deepStrictEqual(result.ok, [
    { text: 'Xin chào bạn' },
    { text: 'Chúc một ngày tốt lành' }
  ]);
});

console.log('check_immersive_translate: ' + n + ' tests passed');
