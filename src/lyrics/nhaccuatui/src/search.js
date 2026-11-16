// search.js: search songs on NhacCuaTui.
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
    queries = artist !== '' ? [artist + ' ' + title, title + ' ' + artist, title] : [title];
  }

  var items = [];
  for (var i = 0; i < queries.length && items.length === 0; i++) {
    var got = nctGet('/api/v1/search/song', {
      keyword: queries[i],
      pageindex: 1,
      pagesize: 30,
      correct: 'false',
    });
    if (got.failure) return got.failure;
    if (got.empty) continue;
    var raw = got.data && got.data.songs;
    if (raw === undefined) continue;
    if (!Array.isArray(raw)) return invalidResponse('songs is not an array');
    items = mapSongs(raw);
  }
  return Response.success(items);
}

function mapSongs(raw) {
  var out = [];
  var seen = {};
  for (var i = 0; i < raw.length && out.length < 20; i++) {
    var s = raw[i];
    if (!s) continue;
    var id = s.key;
    if (typeof id !== 'string' || id === '' || id.length > 256 || seen[id]) continue;
    if (typeof s.name !== 'string' || s.name.trim() === '') continue;

    var artist = typeof s.artistName === 'string' ? s.artistName.trim() : '';
    if (artist === '' && Array.isArray(s.artist)) {
      var names = [];
      for (var j = 0; j < s.artist.length; j++) {
        if (s.artist[j] && typeof s.artist[j].name === 'string' && s.artist[j].name.trim() !== '') {
          names.push(s.artist[j].name.trim());
        }
      }
      artist = names.join(', ');
    }
    if (artist === '') continue;

    var title = s.name.trim();
    if (artist !== '') {
      var prefix = artist.toLowerCase() + ' - ';
      if (title.toLowerCase().indexOf(prefix) === 0) {
        var stripped = title.substring(prefix.length).trim();
        if (stripped !== '') title = stripped;
      }
    }

    var item = { id: id, title: title, artist: artist };
    if (Array.isArray(s.album) && s.album.length > 0 && s.album[0] && typeof s.album[0].name === 'string') {
      var albumName = s.album[0].name.trim();
      if (albumName !== '') item.album = albumName;
    }
    if (typeof s.duration === 'number' && s.duration % 1 === 0 && s.duration > 0 && s.duration < 86400) {
      item.durationMs = s.duration * 1000;
    }
    seen[id] = true;
    out.push(item);
  }
  return out;
}
