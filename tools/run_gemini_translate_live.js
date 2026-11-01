// Live run of src/gemini-translate/ against the real API:
//   GEMINI_API_KEY=... node tools/run_gemini_translate_live.js [to] [model] [style]
// fetch is made synchronous with curl, like the host's blocking fetch. The
// sample is "Sakura Sakura" (Japanese folk song, public domain).
const { execFileSync } = require('child_process');
const path = require('path');
const { loadPlugin, makeResponse } = require('./translate_harness');

const key = process.env.GEMINI_API_KEY; // never printed
if (!key) {
  console.error('Set GEMINI_API_KEY (one key, or several separated by commas).');
  process.exit(2);
}
const [to = 'vi', model = 'gemini-3.5-flash-lite', style = 'natural'] = process.argv.slice(2);

const lyrics = [
  'さくら さくら',
  '野山も里も',
  '見渡す限り',
  'かすみか雲か',
  '朝日ににおう',
  '',
  'さくら さくら',
  '花ざかり',
];

function fetch(url, options = {}) {
  const args = ['-sS', '-X', options.method || 'GET', '-w', '\n%{http_code}', '--max-time', '60'];
  for (const [name, value] of Object.entries(options.headers || {})) args.push('-H', `${name}: ${value}`);
  if (options.body !== undefined) args.push('--data-binary', '@-');
  const out = execFileSync('curl', [...args, url], { input: options.body, maxBuffer: 8 << 20 }).toString('utf8');
  const cut = out.lastIndexOf('\n');
  return makeResponse(Number(out.slice(cut + 1)), out.slice(0, cut));
}

const plugin = loadPlugin(path.join(__dirname, '..', 'src', 'gemini-translate'), {
  fetch,
  config: { apiKeys: key, model, style },
});
const started = Date.now();
const result = plugin.execute({
  lines: lyrics,
  to,
  song: { title: 'Sakura Sakura', artist: 'Traditional', lyrics: lyrics.join('\n') },
});
const ms = Date.now() - started;

if (result.error) {
  console.error(`error after ${ms} ms:`, result);
  process.exit(1);
}
result.ok.forEach((item, i) => {
  console.log(`${lyrics[i].padEnd(10, '　')} → ${item.text}${item.detected ? `  [${item.detected}]` : ''}`);
});
console.log(`\n${model}, ${style}, ${ms} ms`);
