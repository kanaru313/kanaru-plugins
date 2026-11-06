// search.js: search tracks on LRCLIB.
//
// input is {title, artist, album?, durationMs?} or {text}.
load('common.js');

function execute(input) {
  var candidates = [];

  if (input && typeof input.text === 'string' && input.text.trim() !== '') {
    var got = lrclibGet('/search?q=' + encodeURIComponent(input.text.trim()));
    if (got.failure) return got.failure;
    if (Array.isArray(got.data)) {
      candidates = got.data;
    }
  } else if (input) {
    var title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) return Response.success([]);
    var artist = typeof input.artist === 'string' ? input.artist.trim() : '';

    var paths = [];
    if (artist !== '') {
      paths.push('/search?track_name=' + encodeURIComponent(title) + '&artist_name=' + encodeURIComponent(artist));
      paths.push('/search?q=' + encodeURIComponent(title + ' ' + artist));
    }
    paths.push('/search?q=' + encodeURIComponent(title));

    for (var i = 0; i < paths.length && candidates.length === 0; i++) {
      var res = lrclibGet(paths[i]);
      if (res.failure) return res.failure;
      if (Array.isArray(res.data) && res.data.length > 0) {
        candidates = res.data;
      }
    }
  }

  return Response.success(mapCandidates(candidates));
}

function mapCandidates(list) {
  var out = [];
  var seen = {};

  for (var i = 0; i < list.length && out.length < 20; i++) {
    var item = list[i];
    if (!item || item.id == null) continue;

    var id = String(item.id).trim();
    if (!id || seen[id]) continue;

    var title = item.trackName || item.name || '';
    if (!title) continue;
    var artist = item.artistName || 'Unknown';

    var entry = {
      id: id,
      title: title.trim(),
      artist: artist.trim(),
    };

    if (item.albumName && typeof item.albumName === 'string' && item.albumName.trim() !== '') {
      entry.album = item.albumName.trim();
    }

    if (typeof item.duration === 'number' && item.duration > 0 && item.duration < 86400) {
      entry.durationMs = Math.round(item.duration * 1000);
    }

    if (item.instrumental === true) {
      entry.lyrics = { instrumental: true };
    } else if (typeof item.syncedLyrics === 'string' && item.syncedLyrics.trim() !== '') {
      entry.lyrics = { data: item.syncedLyrics.trim(), type: 'lrc' };
    } else if (typeof item.plainLyrics === 'string' && item.plainLyrics.trim() !== '') {
      entry.lyrics = { data: item.plainLyrics.trim(), type: 'txt' };
    }

    seen[id] = true;
    out.push(entry);
  }

  return out;
}
