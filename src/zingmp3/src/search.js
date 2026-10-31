// search.js: songs of ZingMP3 that have lyrics.
//
// input is {title, artist, ...} (tags) or {text} (typed in Choose lyrics).
load('common.js');

function execute(input) {
  var queries;
  if (typeof input.text === 'string' && input.text.trim() !== '') {
    queries = [input.text.trim().normalize('NFC')];
  } else {
    var title = typeof input.title === 'string' ? input.title.trim().normalize('NFC') : '';
    if (title === '') return Response.success([]);
    var artist = typeof input.artist === 'string' ? input.artist.trim().normalize('NFC') : '';
    queries = artist !== '' ? [title + ' ' + artist, title] : [title];
  }

  // The next query runs only when the earlier one gave nothing usable.
  var items = [];
  for (var i = 0; i < queries.length && items.length === 0; i++) {
    var got = zingGet('/search', { q: queries[i], type: 'song', page: 1, count: 20 });
    if (got.failure) return got.failure;
    var raw = got.data.items;
    if (raw === undefined) continue;
    if (!Array.isArray(raw)) return invalidResponse('items is not an array');
    items = mapItems(raw);
  }
  return Response.success(items);
}

// Only songs flagged hasLyric: the app fetches few bodies per lookup and a
// song without lyrics would waste one.
function mapItems(raw) {
  var out = [];
  var seen = {};
  for (var i = 0; i < raw.length && out.length < 20; i++) {
    var s = raw[i];
    if (!s || s.hasLyric !== true) continue;
    var id = s.encodeId;
    if (typeof id !== 'string' || id === '' || id.length > 256 || seen[id]) continue;
    if (typeof s.title !== 'string' || s.title.trim() === '') continue;
    var artist = typeof s.artistsNames === 'string' ? s.artistsNames.trim() : '';
    if (artist === '' && Array.isArray(s.artists)) {
      var names = [];
      for (var j = 0; j < s.artists.length; j++) {
        if (s.artists[j] && typeof s.artists[j].name === 'string') names.push(s.artists[j].name);
      }
      artist = names.join(', ');
    }
    if (artist === '') continue;
    var item = { id: id, title: s.title, artist: artist };
    if (s.album && typeof s.album.title === 'string' && s.album.title.trim() !== '') {
      item.album = s.album.title;
    }
    if (typeof s.duration === 'number' && s.duration % 1 === 0 && s.duration > 0 && s.duration < 86400) {
      item.durationMs = s.duration * 1000;
    }
    seen[id] = true;
    out.push(item);
  }
  return out;
}
