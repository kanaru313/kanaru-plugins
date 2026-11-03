// Offline tests of src/claude-translate/: `node tools/check_claude_translate.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadPlugin, makeResponse } = require('./translate_harness');

const DIR = path.join(__dirname, '..', 'src', 'claude-translate');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'plugin.json'), 'utf8'));

/** An Anthropic Claude 200 answer returning JSON */
const answer = (items, extra = {}) => makeResponse(200, {
  content: [{ type: 'text', text: JSON.stringify({ lines: items }) }],
  stop_reason: 'end_turn',
  ...extra,
});

/** Echo translator */
const echo = (req) => {
  const parsed = JSON.parse(req.body.messages[0].content);
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
  assert.strictEqual(manifest.metadata.type, 'translate');
  assert.strictEqual(manifest.metadata.apiVersion, 1);
  assert.strictEqual(manifest.script.translate, 'translate.js');
  assert.ok(manifest.config.model.options.some((o) => o.value === manifest.config.model.default));
});

t('one item per line, blanks and symbols kept and not sent', () => {
  const { result, calls } = run({ lines: ['Hello there', '', '♪ ♪', 'Goodbye'], to: 'vi' }, { replies: echo });
  assert.strictEqual(calls.length, 1);
  const sent = JSON.parse(calls[0].body.messages[0].content);
  assert.deepStrictEqual(sent.lines, [{ i: 0, t: 'Hello there' }, { i: 3, t: 'Goodbye' }]);
  assert.deepStrictEqual(result.ok, [
    { text: '[vi] Hello there', detected: 'en' },
    { text: '' },
    { text: '♪ ♪' },
    { text: '[vi] Goodbye', detected: 'en' },
  ]);
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
  const sentRetry = JSON.parse(calls[1].body.messages[0].content);
  assert.deepStrictEqual(sentRetry.lines, [{ i: 1, t: 'three four' }]);
  assert.deepStrictEqual(result.ok.map((x) => x.text), ['một hai', 'ba bốn']);
});

t('token limit reached reports length error', () => {
  const { result } = run({ lines: ['one two'], to: 'vi' }, {
    replies: [makeResponse(200, { content: [{ type: 'text', text: '...' }], stop_reason: 'max_tokens' })],
  });
  assert.strictEqual(result.kind, 'invalidResponse');
  assert.match(result.error, /token limit/i);
});

t('auth error rotates through keys until success', () => {
  const { result, calls } = run({ lines: ['hello world'], to: 'vi' }, {
    replies: [
      makeResponse(401, { error: { message: 'Invalid x-api-key' } }),
      echo,
    ],
    config: { apiKeys: 'bad-key, good-key' },
  });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].headers['x-api-key'], 'bad-key');
  assert.strictEqual(calls[1].headers['x-api-key'], 'good-key');
  assert.strictEqual(result.ok[0].text, '[vi] hello world');
});

t('rate limit with retry-after header reports wait time', () => {
  const { result } = run({ lines: ['hello world'], to: 'vi' }, {
    replies: [makeResponse(429, { error: { message: 'Rate limit exceeded' } }, { 'Retry-After': '30' })],
    config: { apiKeys: 'single-key' },
  });
  assert.strictEqual(result.kind, 'rateLimited');
  assert.strictEqual(result.retryAfterSec, 30);
});

t('overloaded 529 rotates to next key', () => {
  const { result, calls } = run({ lines: ['hello world'], to: 'vi' }, {
    replies: [
      makeResponse(529, { error: { message: 'Anthropic API is temporarily overloaded' } }),
      echo,
    ],
    config: { apiKeys: 'k1, k2' },
  });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(result.ok[0].text, '[vi] hello world');
});

console.log('ok ' + n + ' tests');
