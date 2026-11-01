// Offline tests of src/gemini-translate/: `node tools/check_gemini_translate.js`.
// Gemini is stubbed; each test scripts the HTTP answers the plugin gets.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadPlugin, makeResponse } = require('./translate_harness');

const DIR = path.join(__dirname, '..', 'src', 'gemini-translate');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'plugin.json'), 'utf8'));

/** A Gemini 200 answer whose text is [items] as JSON. */
const answer = (items, extra = {}) => makeResponse(200, {
  candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: JSON.stringify(items) }] }, finishReason: 'STOP', ...extra }],
});
/** Echo translator: "[vi] <line>" for every asked line, language "en". */
const echo = (req) => answer(JSON.parse(req.body.contents[0].parts[0].text).lines.map(({ i, t }) => ({ i, t: '[vi] ' + t, l: 'en' })));

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
const sent = (call) => JSON.parse(call.body.contents[0].parts[0].text);
const system = (call) => call.body.systemInstruction.parts[0].text;

let n = 0;
const t = (name, f) => { try { f(); n++; } catch (e) { console.error('FAIL', name); throw e; } };

t('one item per line, blanks and symbols kept and not sent', () => {
  const { result, calls } = run({ lines: ['Hello there', '', '♪ ♪', 'Goodbye'], to: 'vi' }, { replies: echo });
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(sent(calls[0]).lines, [{ i: 0, t: 'Hello there' }, { i: 3, t: 'Goodbye' }]);
  assert.deepStrictEqual(result.ok, [
    { text: '[vi] Hello there', detected: 'en' }, { text: '' }, { text: '♪ ♪' }, { text: '[vi] Goodbye', detected: 'en' }]);
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
  assert.deepStrictEqual(sent(calls[1]).lines, [{ i: 1, t: 'three four' }]);
  assert.deepStrictEqual(result.ok.map((x) => x.text), ['một hai', 'ba bốn']);
});

t('still skipped after the retry: error, not a half translation', () => {
  const { result } = run({ lines: ['one two', 'three four'], to: 'vi' }, {
    replies: [answer([{ i: 0, t: 'một hai' }]), answer([])],
  });
  assert.strictEqual(result.kind, 'invalidResponse');
  assert.match(result.error, /1 of 2 lines/);
});

t('retry off: a skipped line fails at once', () => {
  const { result, calls } = run({ lines: ['one two', 'three four'], to: 'vi' }, {
    replies: [answer([{ i: 0, t: 'x' }])], config: { retryUntranslated: 'false' },
  });
  assert.strictEqual(calls.length, 1);
  assert.ok(result.error);
});

t('long line left in the source language is retried; short ad-lib is not', () => {
  const line = 'I will always love you darling';
  const { result, calls } = run({ lines: [line, 'Oh yeah'], to: 'vi' }, {
    replies: [answer([{ i: 0, t: line, l: 'en' }, { i: 1, t: 'Oh yeah', l: 'en' }]), answer([{ i: 0, t: 'Anh sẽ mãi yêu em', l: 'en' }])],
  });
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(sent(calls[1]).lines, [{ i: 0, t: line }]);
  assert.deepStrictEqual(result.ok.map((x) => x.text), ['Anh sẽ mãi yêu em', 'Oh yeah']);
});

t('line already in the target language is not retried', () => {
  const { calls } = run({ lines: ['Em ơi Hà Nội phố'], to: 'vi' }, {
    replies: [answer([{ i: 0, t: 'Em ơi Hà Nội phố', l: 'vi' }])],
  });
  assert.strictEqual(calls.length, 1);
});

t('only lines without letters: no request', () => {
  const { result, calls } = run({ lines: ['', '...', '(x2)'], to: 'vi' }, { replies: [] });
  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual(result.ok.map((x) => x.text), ['', '...', '(x2)']);
});

t('no API key', () => {
  const { result, calls } = run({ lines: ['hi there'], to: 'vi' }, { replies: [], config: { apiKeys: '' } });
  assert.strictEqual(calls.length, 0);
  assert.match(result.error, /API key/);
});

t('unknown target language', () => {
  const { result } = run({ lines: ['hi there'], to: 'xx' }, { replies: [] });
  assert.match(result.error, /"xx"/);
});

t('keys rotate on quota and bad key; the working key answers', () => {
  const { result, calls } = run({ lines: ['hi there'], to: 'vi' }, {
    config: { apiKeys: 'k1, k2\nk3 k1' },
    replies: [
      makeResponse(429, { error: { message: 'quota' } }),
      makeResponse(400, { error: { message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } }),
      answer([{ i: 0, t: 'xin chào' }]),
    ],
  });
  assert.deepStrictEqual(calls.map((c) => c.headers['x-goog-api-key']), ['k1', 'k2', 'k3']);
  assert.strictEqual(result.ok[0].text, 'xin chào');
});

t('every key out of quota: rateLimited with RetryInfo delay', () => {
  const quota = makeResponse(429, { error: { message: 'Resource exhausted', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' }] } });
  const { result, calls } = run({ lines: ['hi there'], to: 'vi' }, { config: { apiKeys: 'a,b' }, replies: [quota, quota] });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(result.kind, 'rateLimited');
  assert.strictEqual(result.retryAfterSec, 37);
});

t('a server error does not burn the other keys', () => {
  const { result, calls } = run({ lines: ['hi there'], to: 'vi' }, {
    config: { apiKeys: 'a,b' }, replies: [makeResponse(503, { error: { message: 'overloaded' } })],
  });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(result.kind, 'server');
  assert.match(result.error, /503: overloaded/);
});

t('cut at the token limit names the setting', () => {
  const { result } = run({ lines: ['hi there'], to: 'vi' }, {
    replies: [makeResponse(200, { candidates: [{ content: { parts: [{ text: '[{"i":0,"t":"xin' }] }, finishReason: 'MAX_TOKENS' }] })],
  });
  assert.match(result.error, /Max output tokens/);
});

t('blocked prompt reports the reason', () => {
  const { result } = run({ lines: ['hi there'], to: 'vi' }, {
    replies: [makeResponse(200, { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } })],
  });
  assert.match(result.error, /PROHIBITED_CONTENT/);
});

t('answer wrapped in a code fence still parses', () => {
  const fenced = makeResponse(200, { candidates: [{ content: { parts: [{ text: '```json\n[{"i":0,"t":"chào"}]\n```' }] } }] });
  const { result } = run({ lines: ['hi there'], to: 'vi' }, { replies: [fenced] });
  assert.strictEqual(result.ok[0].text, 'chào');
});

t('request: model, schema, safety off, low thinking, numbers clamped', () => {
  const { calls } = run({ lines: ['hi there'], to: 'vi' }, {
    replies: echo, config: { model: 'gemini-3.6-flash', temperature: '9', maxOutputTokens: 'abc' },
  });
  const { url, body } = calls[0];
  assert.match(url, /models\/gemini-3\.6-flash:generateContent$/);
  assert.strictEqual(body.generationConfig.responseMimeType, 'application/json');
  assert.strictEqual(body.generationConfig.responseSchema.type, 'ARRAY');
  assert.deepStrictEqual(body.generationConfig.responseSchema.items.required, ['i', 't', 'l']);
  assert.strictEqual(body.generationConfig.temperature, 2);
  assert.strictEqual(body.generationConfig.maxOutputTokens, 16384);
  assert.deepStrictEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
  assert.strictEqual(body.safetySettings.length, 4);
  assert.ok(body.safetySettings.every((s) => s.threshold === 'BLOCK_NONE'));
});

t('safety on, thinking auto, 2.5 budgets, unknown and retired models', () => {
  const body = (config) => run({ lines: ['hi there'], to: 'vi' }, { replies: echo, config }).calls[0];
  const b1 = body({ safetyFilter: 'true', thinking: 'auto' });
  assert.strictEqual(b1.body.safetySettings, undefined);
  assert.strictEqual(b1.body.generationConfig.thinkingConfig, undefined);
  assert.deepStrictEqual(body({ model: 'gemini-2.5-flash' }).body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.deepStrictEqual(body({ model: 'gemini-2.5-pro' }).body.generationConfig.thinkingConfig, { thinkingBudget: 128 });
  assert.match(body({ model: 'gpt-4' }).url, /gemini-3\.5-flash-lite:/);
  assert.match(body({ model: 'gemini-3.5-flash' }).url, /gemini-3\.6-flash:/);
});

t('system prompt: languages, style, Vietnamese pronouns, song, own instruction', () => {
  const { calls } = run({ lines: ['hi there'], to: 'vi', song: { title: 'Sakura', artist: 'Folk', lyrics: 'さくら さくら' } }, {
    replies: echo, config: { style: 'singable', customInstruction: 'Giữ tên riêng tiếng Nhật' },
  });
  const s = system(calls[0]);
  assert.match(s, /into Vietnamese\. The source language is not given/);
  assert.match(s, /Give "l" for every line/);
  assert.match(s, /STYLE: singable/);
  assert.match(s, /anh\/em/);
  assert.match(s, /"Sakura" by Folk/);
  assert.match(s, /USER REQUEST[^\n]*\nGiữ tên riêng tiếng Nhật/);
  assert.doesNotMatch(s, /\{[a-z_]+\}/);
  assert.doesNotMatch(s, /\n\n\n/);
  assert.deepStrictEqual(sent(calls[0]).song, { title: 'Sakura', artist: 'Folk', lyrics: 'さくら さくら' });
});

t('song context off: no song in prompt or message; a stray `from` is ignored', () => {
  const { calls } = run({ lines: ['hi there'], from: 'ja', to: 'en', song: { title: 'X' } }, {
    replies: echo, config: { useSongContext: 'false' },
  });
  assert.strictEqual(sent(calls[0]).song, undefined);
  assert.doesNotMatch(system(calls[0]), /The song is/);
  assert.doesNotMatch(system(calls[0]), /Japanese/);
});

t('own system prompt template is filled', () => {
  const { calls } = run({ lines: ['hi there'], to: 'ko' }, {
    replies: echo, config: { systemPrompt: 'Lyrics to {target_language}. {target_notes}' },
  });
  assert.strictEqual(system(calls[0]), 'Lyrics to Korean. Keep one speech level (반말 or 존댓말) for the whole song.');
});

const dailyQuota = () => makeResponse(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded', details: [
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } });
const minuteQuota = () => makeResponse(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded', details: [
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
  { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12.2s' }] } });
const badKey = () => makeResponse(400, { error: { message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } });

t('no key configured: kind auth, nothing sent', () => {
  const { result, calls } = run({ lines: ['hi there'], to: 'vi' }, { replies: [], config: { apiKeys: '' } });
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(result.kind, 'auth');
});

t('all keys refused (400 invalid, 401, 403): auth', () => {
  const { result, calls } = run({ lines: ['hi there'], to: 'vi' }, {
    config: { apiKeys: 'a,b,c' },
    replies: [badKey(), makeResponse(401, { error: { message: 'no' } }), makeResponse(403, { error: { message: 'denied' } })],
  });
  assert.strictEqual(calls.length, 3);
  assert.strictEqual(result.kind, 'auth');
});

t('daily quota on every key: quota; per-minute 429: rateLimited with delay', () => {
  const day = run({ lines: ['hi there'], to: 'vi' }, { config: { apiKeys: 'a,b' }, replies: [dailyQuota(), dailyQuota()] });
  assert.strictEqual(day.result.kind, 'quota');
  assert.strictEqual(day.result.retryAfterSec, undefined);
  const minute = run({ lines: ['hi there'], to: 'vi' }, { replies: [minuteQuota()] });
  assert.strictEqual(minute.result.kind, 'rateLimited');
  assert.strictEqual(minute.result.retryAfterSec, 13);
});

t('mixed failures: rateLimited beats quota beats auth', () => {
  const pick = (replies) => run({ lines: ['hi there'], to: 'vi' }, { config: { apiKeys: 'a,b,c' }, replies }).result;
  assert.strictEqual(pick([badKey(), dailyQuota(), minuteQuota()]).kind, 'rateLimited');
  assert.strictEqual(pick([minuteQuota(), dailyQuota(), badKey()]).kind, 'rateLimited');
  assert.strictEqual(pick([badKey(), dailyQuota(), badKey()]).kind, 'quota');
});

t('send cap: 12 keys all refused stop at 10 sends', () => {
  const keys = Array.from({ length: 12 }, (_, i) => 'k' + i).join(',');
  const { result, calls } = run({ lines: ['hi there'], to: 'vi' }, { config: { apiKeys: keys }, replies: () => badKey() });
  assert.strictEqual(calls.length, 10);
  assert.strictEqual(result.kind, 'auth');
});

t('send cap is shared with the retry call', () => {
  const keys = Array.from({ length: 6 }, (_, i) => 'k' + i).join(',');
  const replies = [];
  for (let i = 0; i < 5; i++) replies.push(badKey());
  replies.push(answer([{ i: 0, t: 'một hai' }])); // first call: key 6 answers after 6 sends
  for (let i = 0; i < 6; i++) replies.push(minuteQuota()); // retry call: only 4 sends left
  const { result, calls } = run({ lines: ['one two', 'three four'], to: 'vi' }, { config: { apiKeys: keys }, replies });
  assert.strictEqual(calls.length, 10);
  assert.strictEqual(result.kind, 'invalidResponse'); // line 2 still missing
});

t('manifest: translate section matches the contract', () => {
  const m = manifest.translate;
  assert.strictEqual(manifest.metadata.type, 'translate');
  assert.strictEqual(manifest.script.translate, 'translate.js');
  assert.ok(m.maxLines >= 10 && m.maxLines <= 200 && m.maxChars >= 1000 && m.maxChars <= 20000 && m.timeoutSec <= 90);
  assert.strictEqual(manifest.metadata.supportUrl, undefined);
});

t('manifest: default prompt in sync, config valid, languages known', () => {
  const plugin = loadPlugin(DIR, { fetch: () => null });
  assert.strictEqual(manifest.config.systemPrompt.default, plugin.DEFAULT_SYSTEM_PROMPT);
  const keys = Object.keys(manifest.config);
  assert.ok(keys.length <= 20);
  for (const key of keys) {
    const field = manifest.config[key];
    assert.match(key, /^[A-Za-z0-9_]{1,40}$/);
    assert.ok(field.title.length >= 1 && field.title.length <= 80, key);
    if (field.mode === 'select') {
      assert.ok(field.options.some((o) => o.value === field.default), key + ' default');
      assert.strictEqual(new Set(field.options.map((o) => o.value)).size, field.options.length);
    }
  }
  const translateSrc = fs.readFileSync(path.join(DIR, 'src', 'translate.js'), 'utf8');
  for (const o of manifest.config.model.options) assert.ok(translateSrc.includes(`'${o.value}'`), o.value);
  const prompts = fs.readFileSync(path.join(DIR, 'src', 'prompts.js'), 'utf8');
  for (const o of manifest.config.style.options) assert.ok(prompts.includes(`  ${o.value}:`), o.value);
  for (const code of manifest.translate.languages) assert.ok(prompts.includes(code), code);
  assert.ok(manifest.translate.maxLines >= 1);
});

console.log(`ok ${n} tests`);
