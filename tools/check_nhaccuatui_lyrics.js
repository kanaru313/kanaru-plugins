// Smoke test of src/nhaccuatui/src/lyrics.js and search.js: `node tools/check_nhaccuatui_lyrics.js`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const commonCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'nhaccuatui', 'src', 'common.js'), 'utf8');
const searchCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'nhaccuatui', 'src', 'search.js'), 'utf8');
const lyricsCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'nhaccuatui', 'src', 'lyrics.js'), 'utf8');

function rc4Encrypt(text, keyStr) {
  const bytes = Buffer.from(text, 'utf8');
  const key = Buffer.from(keyStr, 'utf8');
  const S = [];
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 255;
    const tmp = S[i];
    S[i] = S[j];
    S[j] = tmp;
  }
  let i = 0;
  j = 0;
  const out = [];
  for (let o = 0; o < bytes.length; o++) {
    i = (i + 1) & 255;
    j = (j + S[i]) & 255;
    const tmp = S[i];
    S[i] = S[j];
    S[j] = tmp;
    const t = (S[i] + S[j]) & 255;
    out.push(bytes[o] ^ S[t]);
  }
  return Buffer.from(out).toString('hex');
}

let n = 0;
function test(name, fn) {
  fn();
  n++;
  console.log(`✓ ${name}`);
}

// 1. Test RC4 Decrypt in common.js
test('RC4 decrypt and UTF-8 decode', () => {
  const Response = {
    error: (msg, opts) => ({ error: msg, ...opts }),
  };
  const g = { Response };
  const env = new Function(...Object.keys(g), commonCode + '\nreturn { decryptNctLyric, decodeUtf8 };')(...Object.values(g));
  
  const sample = '[00:12.34]Người theo hương hoa mây mù giăng lối\n[00:15.50]Lạc Trôi';
  const key = 'TestKey123';
  const hex = rc4Encrypt(sample, key);
  const decrypted = env.decryptNctLyric(hex, key);
  assert.strictEqual(decrypted, sample);
});

// 2. Test lyrics.js execution with mocked fetch
test('lyrics.js successfully decrypts timed lyric', () => {
  const sample = '[00:00.00]Bài hát: Lạc Trôi\n[00:01.00]Ca sĩ: Sơn Tùng M-TP\n[00:10.00]Đơn côi mình ta\n[03:00.00]Đóng góp: Fan';
  const key = 'Lyr1cjust4nct';
  const hex = rc4Encrypt(sample, key);
  
  const Response = {
    success: (v) => ({ ok: v }),
    error: (m, o) => ({ error: m, ...o }),
  };

  const g = {
    load() {},
    Response,
    invalidResponse: (why) => Response.error(why, { kind: 'invalidResponse' }),
    fetch: (url, opts) => {
      if (url.startsWith('https://graph.nhaccuatui.com')) {
        return {
          status: 200,
          header: () => '',
          json: () => ({
            code: 0,
            data: {
              timedLyric: 'https://lyric.nct.vn/song.lrc',
              keyDecryptLyric: key,
              content: 'Plain text fallback',
            },
          }),
        };
      }
      assert.strictEqual(url, 'https://lyric.nct.vn/song.lrc');
      return {
        status: 200,
        text: () => hex,
      };
    },
  };

  const fullCode = commonCode + '\n' + lyricsCode;
  const fn = new Function(...Object.keys(g), fullCode + '\nreturn execute;')(...Object.values(g));
  const res = fn('abc123Key');
  assert.deepStrictEqual(res, {
    ok: {
      type: 'lrc',
      data: '[00:10.00]Đơn côi mình ta',
    },
  });
});

// 3. Test lyrics.js fallback to plain text when timedLyric is missing
test('lyrics.js fallback to content plain text', () => {
  const Response = {
    success: (v) => ({ ok: v }),
    error: (m, o) => ({ error: m, ...o }),
  };

  const g = {
    load() {},
    Response,
    invalidResponse: (why) => Response.error(why, { kind: 'invalidResponse' }),
    fetch: (url) => {
      assert.strictEqual(url.startsWith('https://graph.nhaccuatui.com'), true);
      return {
        status: 200,
        header: () => '',
        json: () => ({
          code: 0,
          data: {
            timedLyric: null,
            content: 'Lời bài hát: Lạc Trôi\n\nNgười theo hương hoa mây mù giăng lối',
          },
        }),
      };
    },
  };

  const fullCode = commonCode + '\n' + lyricsCode;
  const fn = new Function(...Object.keys(g), fullCode + '\nreturn execute;')(...Object.values(g));
  const res = fn('abc123Key');
  assert.deepStrictEqual(res, {
    ok: {
      type: 'txt',
      data: 'Người theo hương hoa mây mù giăng lối',
    },
  });
});

// 4. Test search.js mapping
test('search.js maps song items correctly', () => {
  const Response = {
    success: (v) => ({ ok: v }),
    error: (m, o) => ({ error: m, ...o }),
  };

  const mockSongs = [
    {
      key: 'kM9SkAzMbTKV',
      name: 'Lạc Trôi',
      artistName: 'Sơn Tùng M-TP',
      duration: 233,
      album: [{ name: 'm-tp M-TP' }],
    },
    {
      key: 'invalidNoArtist',
      name: 'Song No Artist',
      artistName: '',
      artist: [],
    },
  ];

  const g = {
    load() {},
    Response,
    invalidResponse: (why) => Response.error(why, { kind: 'invalidResponse' }),
    fetch: (url) => {
      assert.strictEqual(url.startsWith('https://graph.nhaccuatui.com'), true);
      return {
        status: 200,
        header: () => '',
        json: () => ({
          code: 0,
          data: { songs: mockSongs },
        }),
      };
    },
  };

  const fullCode = commonCode + '\n' + searchCode;
  const fn = new Function(...Object.keys(g), fullCode + '\nreturn execute;')(...Object.values(g));
  const res = fn({ title: 'Lạc Trôi', artist: 'Sơn Tùng M-TP' });
  assert.deepStrictEqual(res, {
    ok: [
      {
        id: 'kM9SkAzMbTKV',
        title: 'Lạc Trôi',
        artist: 'Sơn Tùng M-TP',
        album: 'm-tp M-TP',
        durationMs: 233000,
      },
    ],
  });
});

console.log(`\nAll ${n} smoke tests passed!`);
