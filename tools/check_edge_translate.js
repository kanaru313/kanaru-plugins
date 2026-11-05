// Offline tests for src/edge-translate/: `node tools/check_edge_translate.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadPlugin, makeResponse } = require('./translate_harness');

const DIR = path.join(__dirname, '..', 'src', 'edge-translate');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'plugin.json'), 'utf8'));

const mockAnswer = (items) => makeResponse(200, items.map(([text, lang]) => ({
  detectedLanguage: { language: lang || 'en', score: 1.0 },
  translations: [{ text, to: 'vi' }],
})));

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
  assert.strictEqual(manifest.metadata.name, 'Edge Translate');
  assert.strictEqual(manifest.metadata.type, 'translate');
  assert(manifest.metadata.hosts.includes('edge.microsoft.com'));
  assert.strictEqual(manifest.script.translate, 'translate.js');
  assert(manifest.translate.languages.includes('vi'));
});

t('translates lines with symbol preservation and detected language mapping', () => {
  const echo = (req) => mockAnswer(req.jsonBody.map((l) => ['[vi] ' + l, 'en']));
  const { result, calls } = run({
    lines: ['Hello world', '', '♪ ♪', '(x2)', 'How are you?'],
    to: 'vi',
  }, { replies: echo });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].method, 'POST');
  assert(calls[0].url.includes('to=vi'));
  assert.deepStrictEqual(calls[0].jsonBody, ['Hello world', 'How are you?']);
  assert.strictEqual(calls[0].headers['sec-mesh-client-edge-channel'], 'stable');
  assert.deepStrictEqual(result.ok, [
    { text: '[vi] Hello world', detected: 'en' },
    { text: '' },
    { text: '♪ ♪' },
    { text: '(x2)' },
    { text: '[vi] How are you?', detected: 'en' },
  ]);
});

t('target language mapping: zh-Hans, zh-Hant, no', () => {
  const echo = (req) => mockAnswer(req.jsonBody.map((l) => ['ok', 'en']));
  const zhHans = run({ lines: ['hello'], to: 'zh-Hans' }, { replies: echo });
  assert(zhHans.calls[0].url.includes('to=zh-Hans'));

  const zhHant = run({ lines: ['hello'], to: 'zh-Hant' }, { replies: echo });
  assert(zhHant.calls[0].url.includes('to=zh-Hant'));

  const no = run({ lines: ['hello'], to: 'no' }, { replies: echo });
  assert(no.calls[0].url.includes('to=nb'));
});

t('unsupported language returns error', () => {
  const { result, calls } = run({ lines: ['hello'], to: 'invalid-lang' }, { replies: [] });
  assert.strictEqual(calls.length, 0);
  assert(result.error);
});

t('handles error status: 429, 400', () => {
  const res429 = makeResponse(429, 'Rate limited');
  const r429 = run({ lines: ['hello'], to: 'vi' }, { replies: res429 });
  assert.strictEqual(r429.result.kind, 'rateLimited');

  const res400 = makeResponse(400, 'Bad request');
  const r400 = run({ lines: ['hello'], to: 'vi' }, { replies: res400 });
  assert.strictEqual(r400.result.kind, 'invalidResponse');
});

console.log('check_edge_translate: ' + n + ' tests passed');
