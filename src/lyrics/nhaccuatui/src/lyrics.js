// lyrics.js: the lyrics of one NhacCuaTui song.
//
// input is the `id` (key) of a search result. Returns null (no lyrics) or
// {data, type: 'lrc'|'txt'}. Sources, best first: the encrypted .lrc file,
// then the plain text content field.
load('common.js');

var CREDIT = /^(bài hát|ca sĩ|sáng tác|nhạc sĩ|tác giả|trình bày|thể hiện|lời(?:\s+bài\s+hát)?|nhạc|beat|hòa âm|phối khí|đóng góp|karaoke)\s*[:：]/i;
var TIME_TAG = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g;
var META_LINE = /^\[[a-z]+:.*\]$/i;

function execute(id) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id))) {
    return invalidResponse('the id is not a NhacCuaTui song key');
  }
  var got = nctGet('/api/v1/song/lyric/detail', { songKey: String(id) });
  if (got.failure) return got.failure;
  if (got.empty || !got.data) return Response.success(null);
  var data = got.data;

  var timedUrl = data.timedLyric;
  var failure = null;
  if (typeof timedUrl === 'string' && timedUrl.indexOf(NCT_LRC_PREFIX) === 0) {
    var res = fetch(timedUrl);
    if (res.status === 200) {
      var hex = res.text('utf-8');
      var key = typeof data.keyDecryptLyric === 'string' && data.keyDecryptLyric !== ''
        ? data.keyDecryptLyric
        : DEFAULT_DECRYPT_KEY;
      var rawLrc = decryptNctLyric(hex, key);
      if (rawLrc !== null) {
        var clean = cleanLrc(rawLrc);
        if (clean !== null) {
          var hasSync = /\[\d{1,3}:\d{1,2}/.test(clean);
          return Response.success({ data: clean, type: hasSync ? 'lrc' : 'txt' });
        }
      }
    } else {
      failure = Response.error('HTTP ' + res.status + ' for the lyric file', { kind: 'server' });
    }
  }

  // Fallback to plain text content if timed lyric wasn't available or usable.
  if (typeof data.content === 'string' && data.content.trim() !== '') {
    var plain = stripCredits(data.content.replace(/\r\n?/g, '\n')).trim();
    if (plain !== '') {
      return Response.success({ data: plain, type: 'txt' });
    }
  }

  return failure || Response.success(null);
}

function cleanLrc(raw) {
  var text = stripCredits(raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n'));
  var real = false;
  var all = text.split('\n');
  for (var i = 0; i < all.length; i++) {
    var c = content(all[i]);
    if (c !== '' && !META_LINE.test(c)) { real = true; break; }
  }
  return real ? text : null;
}

function content(line) {
  return line.replace(TIME_TAG, '').trim().normalize('NFC');
}

function stripCredits(text) {
  var all = text.split('\n');
  var start = 0;
  for (var i = 0; i < all.length; i++) {
    var c = content(all[i]);
    if (CREDIT.test(c)) start = i + 1;
    else if (c !== '' && !META_LINE.test(c)) break;
  }
  var end = all.length;
  while (end > start) {
    var d = content(all[end - 1]);
    if (d === '' || CREDIT.test(d)) end--;
    else break;
  }
  if (start === 0 && end === all.length) return text;
  return all.slice(start, end).join('\n');
}
