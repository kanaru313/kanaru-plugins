// search.js: search tracks on Kugou Music.
//
// input is {title, artist, ...} (tags) or {text} (typed in Choose lyrics).
load('common.js');

function execute(input) {
  var queries = [];
  var durationMs = typeof input.durationMs === 'number' && input.durationMs > 0 ? input.durationMs : null;

  if (typeof input.text === 'string' && input.text.trim() !== '') {
    queries.push(input.text.trim().normalize('NFC'));
  } else {
    var title = typeof input.title === 'string' ? input.title.trim().normalize('NFC') : '';
    if (title === '') return Response.success([]);
    var artist = typeof input.artist === 'string' ? input.artist.trim().normalize('NFC') : '';

    if (artist !== '') {
      queries.push(artist + ' - ' + title);
      queries.push(title + ' ' + artist);
      queries.push(artist + ' ' + title);
    }
    queries.push(title);
  }

  var items = [];
  for (var i = 0; i < queries.length && items.length === 0; i++) {
    var q = queries[i];

    // Try search with duration hint first (if available)
    if (durationMs) {
      var gotDur = kugouGet(KUGOU_SEARCH_URL, {
        ver: 1,
        man: 'yes',
        client: 'pc',
        keyword: q,
        duration: Math.round(durationMs)
      });
      if (gotDur.failure) return gotDur.failure;
      var cDur = gotDur.data && gotDur.data.candidates;
      if (Array.isArray(cDur) && cDur.length > 0) {
        items = mapCandidates(cDur);
      }
    }

    // Fallback without duration
    if (items.length === 0) {
      var got = kugouGet(KUGOU_SEARCH_URL, {
        ver: 1,
        man: 'yes',
        client: 'pc',
        keyword: q
      });
      if (got.failure) return got.failure;
      var cList = got.data && got.data.candidates;
      if (Array.isArray(cList) && cList.length > 0) {
        items = mapCandidates(cList);
      }
    }
  }

  return Response.success(items);
}

function mapCandidates(candidates) {
  var out = [];
  var seen = {};

  for (var i = 0; i < candidates.length && out.length < 20; i++) {
    var c = candidates[i];
    if (!c) continue;

    var lyricId = c.id != null ? String(c.id).trim() : '';
    var accessKey = c.accesskey != null ? String(c.accesskey).trim() : '';
    if (lyricId === '' || accessKey === '') continue;

    var id = lyricId + '_' + accessKey;
    if (id.length > 256 || seen[id]) continue;

    var title = typeof c.song === 'string' ? htmlDecode(c.song).trim() : '';
    var artist = typeof c.singer === 'string' ? htmlDecode(c.singer).trim() : '';
    if (title === '' || artist === '') continue;

    var item = {
      id: id,
      title: title,
      artist: artist
    };

    if (typeof c.duration === 'number' && c.duration > 0 && c.duration < 86400000) {
      item.durationMs = Math.round(c.duration);
    }

    seen[id] = true;
    out.push(item);
  }

  return out;
}
