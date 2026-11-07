// Offline tests of src/qwen-translate/: `node tools/check_qwen_translate.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadPlugin, makeResponse } = require('./translate_harness');

const DIR = path.join(__dirname, '..', 'src', 'qwen-translate');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'plugin.json'), 'utf8'));

/** A Qwen 200 answer returning JSON */
const answer = (items, extra = {}) => makeResponse(200, {
  choices: [{
    message: { role: 'assistant', content: JSON.stringify({ lines: items }) },
    finish_reason: 'stop',
    ...extra,
  }],
});

/** Echo translator */
const echo = (req) => {
  const parsed = JSON.parse(req.body.messages[1].content);
  return answer(parsed.lines.map(({ i, t }) => ({ i, t: '[vi] ' + t, l: 'en' })));
};

function run(input, { replies, config = {} }) {
  const calls = [];
  const queue = Array.isArray(replies) ? replies.slice() : null;
  const fetch = (url, options) => {
    const req = { url, headers: options.headers, body: JSON.parse(options.body) };
    calls.push(req);
    const next = queue ? queue.shift() : replies;
    if (!next) throw new Error('unexpected fetch #' + calls.length);
    return typeof next === 'function' ? next(req) : next;
  };
  const plugin = loadPlugin(DIR, { fetch, config: { apiKeys: 'k1', ...config } });
  return { result: plugin.execute(input), calls, plugin };
}

let n = 0;
const t = (name, f) => { try { f(); n++; } catch (e) { console.error('FAIL', name); throw e; } };

t('manifest integrity and default options', () => {
  assert.strictEqual(manifest.metadata.type, 'ai-translate');
  assert.strictEqual(manifest.metadata.apiVersion, 1);
  assert.strictEqual(manifest.metadata.name, 'Qwen Translate');
  assert.strictEqual(manifest.script.translate, 'translate.js');
  assert.ok(manifest.metadata.hosts.includes('dashscope-intl.aliyuncs.com'));
  assert.ok(manifest.metadata.hosts.includes('dashscope.aliyuncs.com'));
  assert.ok(manifest.config.model.options.some((o) => o.value === manifest.config.model.default));
});

t('one item per line, blanks and symbols kept and not sent', () => {
  const { result, calls } = run({ lines: ['Hello there', '', '♪ ♪', 'Goodbye'], to: 'vi' }, { replies: echo });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions');
  const sent = JSON.parse(calls[0].body.messages[1].content);
  assert.deepStrictEqual(sent.lines, [{ i: 0, t: 'Hello there' }, { i: 3, t: 'Goodbye' }]);
  assert.deepStrictEqual(result.ok, [
    { text: '[vi] Hello there', detected: 'en' },
    { text: '' },
    { text: '♪ ♪' },
    { text: '[vi] Goodbye', detected: 'en' },
  ]);
});

t('uses CN endpoint when endpointRegion is cn', () => {
  const { calls } = run({ lines: ['test line'], to: 'vi' }, {
    replies: echo,
    config: { endpointRegion: 'cn' },
  });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
});

t('uses customEndpoint when provided', () => {
  const { calls } = run({ lines: ['test line'], to: 'vi' }, {
    replies: echo,
    config: { customEndpoint: 'https://custom-proxy.internal/v1' },
  });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://custom-proxy.internal/v1/chat/completions');
});

t('items answered out of order land on their own line; extras ignored', () => {
  const { result } = run({ lines: ['a b', 'c d'], to: 'vi' }, {
    replies: [answer([{ i: 1, t: 'D' }, { i: 7, t: 'x' }, { i: 0, t: 'B' }, { i: 0, t: 'dup' }])],
  });
  assert.deepStrictEqual(result.ok.map((x) => x.text), ['B', 'D']);
});

t('skipped line is asked again alone, then filled', () => {
  const { result, calls } = run({ lines: ['one two', 'three four'], to: 'vi' }, {
    replies: [answer([{ i: 0, t: 'một hai' }]), answer([{ i: 1, t: 'ba bốn' }])],
  });
  assert.strictEqual(calls.length, 2);
  const sentRetry = JSON.parse(calls[1].body.messages[1].content);
  assert.deepStrictEqual(sentRetry.lines, [{ i: 1, t: 'three four' }]);
  assert.deepStrictEqual(result.ok.map((x) => x.text), ['một hai', 'ba bốn']);
});

t('token limit reached reports length error', () => {
  const { result } = run({ lines: ['one two'], to: 'vi' }, {
    replies: [makeResponse(200, { choices: [{ message: { content: '...' }, finish_reason: 'length' }] })],
  });
  assert.strictEqual(result.kind, 'invalidResponse');
  assert.match(result.error, /token limit/i);
});

t('auth error rotates through keys until success', () => {
  const { result, calls } = run({ lines: ['hello world'], to: 'vi' }, {
    replies: [
      makeResponse(401, { error: { message: 'Incorrect API key provided' } }),
      echo,
    ],
    config: { apiKeys: 'bad-key, good-key' },
  });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].headers.authorization, 'Bearer bad-key');
  assert.strictEqual(calls[1].headers.authorization, 'Bearer good-key');
  assert.strictEqual(result.ok[0].text, '[vi] hello world');
});

t('quota error recognizes insufficient_quota and advances key', () => {
  const { result, calls } = run({ lines: ['hello world'], to: 'vi' }, {
    replies: [
      makeResponse(429, { error: { code: 'insufficient_quota', message: 'You have run out of balance' } }),
      echo,
    ],
    config: { apiKeys: 'depleted-key, valid-key' },
  });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(result.ok[0].text, '[vi] hello world');
});

t('model parameter supports specialized and custom models', () => {
  const mtRun = run({ lines: ['hello world'], to: 'vi' }, {
    replies: echo,
    config: { model: 'qwen-mt-plus' },
  });
  assert.strictEqual(mtRun.calls[0].body.model, 'qwen-mt-plus');

  const customRun = run({ lines: ['hello world'], to: 'vi' }, {
    replies: echo,
    config: { model: 'qwen-vl-max' },
  });
  assert.strictEqual(customRun.calls[0].body.model, 'qwen-vl-max');
});

console.log('check_qwen_translate: ' + n + ' tests passed');
