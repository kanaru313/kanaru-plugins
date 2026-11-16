// search.js: search tracks on Megalobiz.
//
// input is {title, artist, album?, durationMs?} or {text}.
load('common.js');

function execute(input) {
  var candidates = [];

  if (input && typeof input.text === 'string' && input.text.trim() !== '') {
    var got = megalobizGet('/search?q=' + encodeURIComponent(input.text.trim()));
    if (got.failure) return got.failure;
    if (got.data && Array.isArray(got.data.results)) {
      candidates = got.data.results;
    }
  } else if (input) {
    var title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) return Response.success([]);
    var artist = typeof input.artist === 'string' ? input.artist.trim() : '';

    var paths = [];
    var tagPath = '/search?title=' + encodeURIComponent(title);
    if (artist !== '') tagPath += '&artist=' + encodeURIComponent(artist);
    if (typeof input.durationMs === 'number' && input.durationMs > 0) {
      tagPath += '&duration=' + Math.round(input.durationMs / 1000);
    }
    paths.push(tagPath);

    if (artist !== '') {
      paths.push('/search?q=' + encodeURIComponent(title + ' ' + artist));
    }
    paths.push('/search?q=' + encodeURIComponent(title));

    for (var i = 0; i < paths.length && candidates.length === 0; i++) {
      var res = megalobizGet(paths[i]);
      if (res.failure) return res.failure;
      if (res.data && Array.isArray(res.data.results) && res.data.results.length > 0) {
        candidates = res.data.results;
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

    var title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title) continue;
    var artist = typeof item.artist === 'string' && item.artist.trim() !== '' ? item.artist.trim() : 'Unknown';

    var entry = {
      id: id,
      title: title,
      artist: artist,
    };

    if (typeof item.duration === 'number' && item.duration > 0 && item.duration < 86400) {
      entry.durationMs = Math.round(item.duration * 1000);
    }

    seen[id] = true;
    out.push(entry);
  }

  return out;
}
