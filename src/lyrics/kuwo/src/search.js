// search.js: search tracks on Kuwo Music.
//
// input is {title, artist, album?, durationMs?} or {text}.
load('common.js');

var SEARCH_URL = 'https://search.kuwo.cn/r.s';

function execute(input) {
  var q = '';
  if (input && typeof input.text === 'string' && input.text.trim() !== '') {
    q = input.text.trim();
  } else if (input) {
    var title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) return Response.success([]);
    var artist = typeof input.artist === 'string' ? input.artist.trim() : '';
    q = title;
    if (artist) q += ' ' + artist;
  }

  if (!q) return Response.success([]);

  var url = SEARCH_URL + '?client=kt&all=' + encodeURIComponent(q) +
    '&pn=0&rn=20&vipver=1&ft=music&encoding=utf8&rformat=json&mobi=1';

  var got = kuwoGet(url);
  if (got.failure) return got.failure;

  var list = got.data && Array.isArray(got.data.abslist) ? got.data.abslist : [];
  return Response.success(mapCandidates(list));
}

function mapCandidates(list) {
  var out = [];
  var seen = {};

  for (var i = 0; i < list.length && out.length < 20; i++) {
    var item = list[i];
    if (!item) continue;

    var id = String(item.DC_TARGETID || item.MUSICRID || '').replace(/^MUSIC_/, '').trim();
    if (!id || seen[id]) continue;

    var title = decodeHtml(item.SONGNAME || item.FSONGNAME || '');
    if (!title) continue;
    var artist = decodeHtml(item.ARTIST || item.FARTIST || 'Unknown');

    var entry = {
      id: id,
      title: title,
      artist: artist,
    };

    if (item.ALBUM) {
      entry.album = decodeHtml(item.ALBUM);
    }

    if (item.DURATION && !isNaN(item.DURATION)) {
      var d = parseInt(item.DURATION, 10);
      if (d > 0 && d < 86400) {
        entry.durationMs = d * 1000;
      }
    }

    seen[id] = true;
    out.push(entry);
  }

  return out;
}
