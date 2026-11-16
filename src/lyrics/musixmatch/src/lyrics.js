// lyrics.js: the lyrics of one Musixmatch track.
//
// input is the `id` (commontrack_id) of a search result. Returns null (no lyrics),
// {instrumental: true}, or {data, type: 'lrc'|'txt'}.
load('common.js');

function execute(id) {
  var idStr = String(id).trim();
  if (!/^\d{1,64}$/.test(idStr)) {
    return invalidResponse('the id is not a Musixmatch track id');
  }

  // 1. Try timed subtitle first
  var gotSub = mxmGet('/track.subtitle.get', {
    commontrack_id: idStr,
    subtitle_format: 'lrc'
  });

  if (gotSub.failure) return gotSub.failure;

  if (gotSub.header && gotSub.header.instrumental === 1) {
    return Response.success({ instrumental: true });
  }

  if (gotSub.body && gotSub.body.subtitle) {
    var rawLrc = gotSub.body.subtitle.subtitle_body;
    if (typeof rawLrc === 'string' && rawLrc.trim() !== '') {
      var clean = cleanLrc(rawLrc);
      if (clean !== null) {
        var hasSync = /\[\d{1,3}:\d{1,2}/.test(clean);
        return Response.success({ data: clean, type: hasSync ? 'lrc' : 'txt' });
      }
    }
  }

  // 2. Fallback to plain text lyrics
  var gotLyr = mxmGet('/track.lyrics.get', {
    commontrack_id: idStr
  });

  if (gotLyr.failure) return gotLyr.failure;

  if (gotLyr.body && gotLyr.body.lyrics) {
    if (gotLyr.body.lyrics.instrumental === 1) {
      return Response.success({ instrumental: true });
    }
    var rawTxt = gotLyr.body.lyrics.lyrics_body;
    if (typeof rawTxt === 'string' && rawTxt.trim() !== '') {
      var plain = stripCredits(rawTxt.replace(/\r\n?/g, '\n')).trim();
      if (plain !== '') {
        return Response.success({ data: plain, type: 'txt' });
      }
    }
  }

  return Response.success(null);
}
