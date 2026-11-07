// Offline tests of src/openai-compatible/: `node tools/check_openai_compatible.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadPlugin, makeResponse } = require('./translate_harness');

const DIR = path.join(__dirname, '..', 'src', 'openai-compatible');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'plugin.json'), 'utf8'));

/** An OpenAI-compatible 200 answer returning JSON */
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

t('manifest integrity and hosts limits', () => {
  assert.strictEqual(manifest.metadata.type, 'ai-translate');
  assert.strictEqual(manifest.metadata.apiVersion, 1);
  assert.strictEqual(manifest.script.translate, 'translate.js');
  assert.ok(manifest.metadata.hosts.length > 0 && manifest.metadata.hosts.length <= 20);
  assert.strictEqual(new Set(manifest.metadata.hosts).size, manifest.metadata.hosts.length);
});

t('one item per line, blanks and symbols kept and not sent', () => {
  const { result, calls } = run({ lines: ['Hello there', '', '♪ ♪', 'Goodbye'], to: 'vi' }, { replies: echo });
  assert.strictEqual(calls.length, 1);
  const sent = JSON.parse(calls[0].body.messages[1].content);
  assert.deepStrictEqual(sent.lines, [{ i: 0, t: 'Hello there' }, { i: 3, t: 'Goodbye' }]);
  assert.deepStrictEqual(result.ok, [
    { text: '[vi] Hello there', detected: 'en' },
    { text: '' },
    { text: '♪ ♪' },
    { text: '[vi] Goodbye', detected: 'en' },
  ]);
});

t('custom base URL and chat endpoint normalization', () => {
  const { calls } = run({ lines: ['hello'], to: 'vi' }, {
    replies: echo,
    config: { baseUrl: 'https://openrouter.ai/api/v1/chat/completions', model: 'meta-llama/llama-3' },
  });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.strictEqual(calls[0].body.model, 'meta-llama/llama-3');
});

t('Google Gemini OpenAI compatibility endpoint format kept', () => {
  const { calls } = run({ lines: ['hello'], to: 'vi' }, {
    replies: echo,
    config: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
});

t('items answered out of order land on their own line; extras ignored', () => {
  const { result } = run({ lines: ['a b', 'c d'], to: 'vi' }, {
    replies: [answer([{ i: 1, t: 'D' }, { i: 7, t: 'x' }, { i: 0, t: 'B' }, { i: 0, t: 'dup' }])],
  });
  assert.deepStrictEqual(result.ok.map((x) => x.text), ['B', 'D']);
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
      makeResponse(401, { error: { message: 'Invalid API Key' } }),
      echo,
    ],
    config: { apiKeys: 'bad-key, good-key' },
  });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].headers.authorization, 'Bearer bad-key');
  assert.strictEqual(calls[1].headers.authorization, 'Bearer good-key');
  assert.strictEqual(result.ok[0].text, '[vi] hello world');
});

t('quota 402 rotates to next key', () => {
  const { result, calls } = run({ lines: ['hello world'], to: 'vi' }, {
    replies: [
      makeResponse(402, { error: { message: 'Insufficient balance' } }),
      echo,
    ],
    config: { apiKeys: 'empty-key, funded-key' },
  });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(result.ok[0].text, '[vi] hello world');
});

t('rate limit with retry-after header reports wait time', () => {
  const { result } = run({ lines: ['hello world'], to: 'vi' }, {
    replies: [makeResponse(429, { error: { message: 'Rate limit exceeded' } }, { 'Retry-After': '25' })],
    config: { apiKeys: 'single-key' },
  });
  assert.strictEqual(result.kind, 'rateLimited');
  assert.strictEqual(result.retryAfterSec, 25);
});

console.log('ok ' + n + ' tests');
