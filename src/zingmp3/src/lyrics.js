// lyrics.js: the lyrics of one ZingMP3 song.
//
// input is the `id` (encodeId) of a search result. Returns null (no lyrics) or
// {data, type: 'lrc'|'txt'}. Sources, best first: the .lrc file, the
// per-sentence timings, a plain text field.
load('common.js');

// Credit lines at the start or end of the file ("Bài hát: ...", "Ca sĩ: ..."):
// not lyrics. The colon is required and only a block at the start or end is
// cut, so a lyric line that begins with such a word in mid-song stays.
var CREDIT = /^(bài hát|ca sĩ|sáng tác|nhạc sĩ|tác giả|trình bày|thể hiện|lời|nhạc|beat|hòa âm|phối khí)\s*:/i;
var TIME_TAG = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g;
var META_LINE = /^\[[a-z]+:.*\]$/i;

function execute(id) {
  if (!/^[A-Za-z0-9]{1,32}$/.test(String(id))) {
    return invalidResponse('the id is not a ZingMP3 song id');
  }
  var got = zingGet('/lyric/get/lyric', { id: String(id) });
  if (got.failure) return got.failure;
  var data = got.data;

  var failure = null;
  var file = data.file;
  if (typeof file === 'string' && file.indexOf(ZING_LRC_PREFIX) === 0) {
    var res = fetch(file);
    if (res.status === 200) {
      var text = cleanLrc(res.text('utf-8'));
      if (text !== null) return Response.success({ data: text, type: /\[\d{1,3}:\d{1,2}/.test(text) ? 'lrc' : 'txt' });
    } else {
      // Even a 404: the record promised a file, so this is not "no lyrics".
      failure = Response.error('HTTP ' + res.status + ' for the lyric file', { kind: 'server' });
    }
  }

  var synced = sentencesToLrc(data.sentences);
  if (synced !== null) return Response.success({ data: synced, type: 'lrc' });
  if (typeof data.lyric === 'string' && data.lyric.trim() !== '') {
    return Response.success({ data: data.lyric, type: 'txt' });
  }
  // A failed file download is never "no lyrics": that would be cached.
  return failure || Response.success(null);
}

// The file text without BOM, CRLF and credit blocks; null when nothing real is
// left.
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

// Drops the credit lines at the start (with metadata and blank lines among
// them) and at the end. Nothing to cut: the text is returned as it is.
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

// One LRC line per sentence: the start of its first word, the words joined.
function sentencesToLrc(sentences) {
  if (!Array.isArray(sentences)) return null;
  var lines = [];
  for (var i = 0; i < sentences.length; i++) {
    var words = sentences[i] && sentences[i].words;
    if (!Array.isArray(words) || words.length === 0) continue;
    var start = words[0].startTime;
    if (typeof start !== 'number' || start < 0 || start % 1 !== 0) continue;
    var parts = [];
    for (var j = 0; j < words.length; j++) {
      if (words[j] && typeof words[j].data === 'string') parts.push(words[j].data);
    }
    var line = parts.join(' ').trim();
    if (line === '') continue;
    lines.push(stamp(start) + line);
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

function stamp(ms) {
  var cs = Math.floor(ms / 10) % 100;
  var s = Math.floor(ms / 1000) % 60;
  var m = Math.floor(ms / 60000);
  function two(n) { return (n < 10 ? '0' : '') + n; }
  return '[' + two(m) + ':' + two(s) + '.' + two(cs) + ']';
}
