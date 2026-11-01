// search.js: search tracks on Musixmatch.
//
// input is {title, artist, ...} (tags) or {text} (typed in Choose lyrics).
load('common.js');

function execute(input) {
  var results = [];

  if (typeof input.text === 'string' && input.text.trim() !== '') {
    var q = input.text.trim().normalize('NFC');
    var got = mxmGet('/track.search', {
      q: q,
      page_size: 20,
      page: 1
    });
    if (got.failure) return got.failure;
    if (got.body && Array.isArray(got.body.track_list)) {
      results = mapTracks(got.body.track_list);
    }
  } else {
    var title = typeof input.title === 'string' ? input.title.trim().normalize('NFC') : '';
    if (title === '') return Response.success([]);
    var artist = typeof input.artist === 'string' ? input.artist.trim().normalize('NFC') : '';

    var queries = [];
    if (artist !== '') {
      queries.push({ q_track: title, q_artist: artist });
      queries.push({ q: title + ' ' + artist });
    }
    queries.push({ q_track: title });

    for (var i = 0; i < queries.length && results.length === 0; i++) {
      var params = queries[i];
      params.page_size = 20;
      params.page = 1;
      var got = mxmGet('/track.search', params);
      if (got.failure) return got.failure;
      if (got.body && Array.isArray(got.body.track_list)) {
        results = mapTracks(got.body.track_list);
      }
    }
  }

  return Response.success(results);
}

function mapTracks(trackList) {
  var out = [];
  var seen = {};

  for (var i = 0; i < trackList.length && out.length < 20; i++) {
    var item = trackList[i];
    var t = item && item.track;
    if (!t) continue;

    var idNum = t.commontrack_id || t.track_id;
    if (!idNum) continue;
    var id = String(idNum).trim();
    if (id === '' || id === '0' || id.length > 256 || seen[id]) continue;

    var hasSubs = t.has_subtitles === 1;
    var hasLyr = t.has_lyrics === 1;
    var isInst = t.instrumental === 1;
    if (!hasSubs && !hasLyr && !isInst) {
      continue;
    }

    var title = typeof t.track_name === 'string' ? t.track_name.trim() : '';
    var artist = typeof t.artist_name === 'string' ? t.artist_name.trim() : '';
    if (title === '' || artist === '') continue;

    var trackObj = {
      id: id,
      title: title,
      artist: artist
    };

    if (typeof t.album_name === 'string' && t.album_name.trim() !== '') {
      trackObj.album = t.album_name.trim();
    }

    if (typeof t.track_length === 'number' && t.track_length > 0 && t.track_length < 86400) {
      trackObj.durationMs = Math.round(t.track_length * 1000);
    }

    seen[id] = true;
    out.push(trackObj);
  }

  return out;
}
