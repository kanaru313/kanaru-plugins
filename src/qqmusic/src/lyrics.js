// lyrics.js: the lyrics of one QQ Music song.
//
// input is the `id` (songmid) string of a search result. Returns null (no lyrics),
// {instrumental: true}, or {data, type: 'lrc'|'txt'}.
load('common.js');

function execute(id) {
  var mid = String(id).trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(mid)) {
    return invalidResponse('the id is not a QQ Music song mid');
  }

  var got = qqGet(QQ_LYRIC_URL, {
    songmid: mid,
    g_tk: 5381,
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    nobase64: 1
  });

  if (got.failure) return got.failure;

  var data = got.data;
  if (!data) return Response.success(null);

  if (data.code === 1101 || data.retcode === 1101) {
    return Response.success(null);
  }
  if (data.code !== 0 && data.retcode !== 0) {
    return Response.error('QQ Music API error: code ' + (data.code || data.retcode), { kind: 'server' });
  }

  var raw = data.lyric;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return Response.success(null);
  }

  var text = htmlDecode(raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n')).trim();
  var lines = realLines(text);
  if (lines.length === 0) return Response.success(null);
  if (lines.length === 1 && lines[0] === PLACEHOLDER) return Response.success(null);
  if (lines.length === 1 && PURE_MUSIC.test(lines[0])) {
    return Response.success({ instrumental: true });
  }

  text = stripCredits(text);
  var synced = /\[\d{1,3}:\d{1,2}/.test(text);
  return Response.success({ data: text, type: synced ? 'lrc' : 'txt' });
}
