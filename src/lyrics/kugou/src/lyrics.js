// lyrics.js: the lyrics of one Kugou Music song.
//
// input is the `id` (lyricId_accessKey) string of a search result. Returns null (no lyrics),
// {instrumental: true}, or {data, type: 'lrc'|'txt'}.
load('common.js');

function execute(id) {
  var idStr = String(id).trim();
  var parts = idStr.split('_');
  if (parts.length < 2) {
    return invalidResponse('the id is not a valid Kugou lyric id');
  }

  var lyricId = parts[0].trim();
  var accessKey = parts[1].trim();

  if (!/^\d{1,32}$/.test(lyricId) || !/^[A-Za-z0-9]{1,64}$/.test(accessKey)) {
    return invalidResponse('the id contains invalid Kugou lyric identifiers');
  }

  var got = kugouGet(KUGOU_DOWNLOAD_URL, {
    ver: 1,
    client: 'pc',
    id: lyricId,
    accesskey: accessKey,
    fmt: 'lrc',
    charset: 'utf8'
  });

  if (got.failure) return got.failure;

  var data = got.data;
  if (!data || data.status !== 200 || !data.content) {
    return Response.success(null);
  }

  var raw = base64ToString(data.content);
  if (raw.trim() === '') {
    return Response.success(null);
  }

  var text = htmlDecode(raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n')).trim();
  var lines = realLines(text);
  if (lines.length === 0) return Response.success(null);
  if (lines.length === 1 && PURE_MUSIC.test(lines[0])) {
    return Response.success({ instrumental: true });
  }

  text = stripCredits(text);
  var synced = /\[\d{1,3}:\d{1,2}/.test(text);
  return Response.success({ data: text, type: synced ? 'lrc' : 'txt' });
}
