// lyrics.js: fetch and format synced LRC lyrics for Kuwo Music.
//
// execute(id) → Response.success({ data, type: 'lrc', instrumental? }) | Response.success(null)
load('common.js');

var LYRIC_URL = 'http://kuwo.cn/openapi/v1/www/lyric/getlyric';

function execute(id) {
  var idStr = String(id == null ? '' : id).replace(/^MUSIC_/, '').trim();
  if (!idStr || !/^\d+$/.test(idStr)) {
    return Response.error('Kuwo Music: invalid track ID', { kind: 'invalidResponse' });
  }

  var url = LYRIC_URL + '?musicId=' + encodeURIComponent(idStr);
  var got = kuwoGet(url);
  if (got.failure) return got.failure;

  var lrclist = got.data && got.data.data && Array.isArray(got.data.data.lrclist)
    ? got.data.data.lrclist
    : null;

  if (!lrclist || lrclist.length === 0) {
    return Response.success(null);
  }

  // Check for instrumental
  for (var j = 0; j < lrclist.length; j++) {
    var rawText = (lrclist[j] && lrclist[j].lineLyric) || '';
    if (/纯音乐|没有填词/i.test(rawText)) {
      return Response.success({ instrumental: true });
    }
  }

  // Format into synced LRC lines
  var lines = [];
  var inStartCredits = true;

  for (var i = 0; i < lrclist.length; i++) {
    var item = lrclist[i];
    if (!item) continue;
    var lineText = decodeHtml(item.lineLyric || '').trim();
    if (!lineText) continue;

    // Filter opening credit lines
    if (inStartCredits && isCredit(lineText)) {
      continue;
    }
    inStartCredits = false;

    var tag = formatLrcTime(item.time);
    lines.push(tag + ' ' + lineText);
  }

  if (lines.length === 0) {
    return Response.success(null);
  }

  return Response.success({
    data: lines.join('\n'),
    type: 'lrc',
  });
}
