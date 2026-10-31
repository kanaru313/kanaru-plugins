// search.js: find songs at NetEase for a song or a typed text.
//
// input is {title, artist, artists, album, durationMs} for an automatic lookup
// (a missing tag is null) or {text} for the manual search. The app matches the
// results against the song and picks the best, so this script only maps
// NetEase's records. It returns at most 20 items:
//   {id, title, artist, album?, durationMs?}
// NetEase's search does not return lyrics, so there is no inline `lyrics`;
// the app calls lyrics.js for the best matches.
load('common.js');

var MAX_RESULTS = 20;
var MAX_DURATION_MS = 86400000; // 24 hours: longer is ignored by the app

function execute(input) {
  var q;
  if (hasText(input.text)) {
    q = input.text.trim();
  } else if (hasText(input.title)) {
    // Title plus the primary artist; the title alone when there is no artist.
    q = input.title.trim();
    if (hasText(input.artist)) q += ' ' + input.artist.trim();
  } else {
    return Response.success([]); // nothing to search for, nothing to ask
  }

  var got = neteaseGet('/api/search/get', { s: nfc(q), type: 1, limit: MAX_RESULTS });
  if (got.failure) return got.failure;

  // With no hit `result` (or `result.songs`) may be missing. That is "no
  // result" only when it says so; a changed answer must not look like it.
  var result = got.json.result;
  if (result == null) return Response.success([]);
  if (typeof result !== 'object' || Array.isArray(result)) {
    return invalidResponse('result is not an object');
  }
  var songs = result.songs;
  if (songs == null) {
    if (result.songCount == null || result.songCount === 0) {
      return Response.success([]);
    }
    return invalidResponse('songCount without songs');
  }
  if (!Array.isArray(songs)) return invalidResponse('songs is not an array');

  var items = [];
  for (var i = 0; i < songs.length && items.length < MAX_RESULTS; i++) {
    var item = toItem(songs[i]);
    if (item) items.push(item);
  }
  // A non-empty array of nothing usable is a changed format, not "no results".
  if (songs.length > 0 && items.length === 0) {
    return invalidResponse('no usable record in the search answer');
  }
  return Response.success(items);
}

// One NetEase song as a result item, or null when it has the wrong shape.
function toItem(song) {
  if (!song || typeof song !== 'object') return null;
  if (typeof song.id !== 'number' || Math.floor(song.id) !== song.id || song.id <= 0) {
    return null;
  }
  if (!hasText(song.name)) return null;

  var names = [];
  if (Array.isArray(song.artists)) {
    for (var i = 0; i < song.artists.length; i++) {
      var a = song.artists[i];
      if (a && hasText(a.name)) names.push(a.name.trim());
    }
  }
  if (names.length === 0) return null;

  var item = {
    // String(id) of a large number could become "1e+21"; real ids are far
    // below that, but a huge one is dropped rather than sent as a bad id.
    id: String(song.id),
    title: song.name.trim(),
    artist: names.join(', '),
  };
  if (!/^\d{1,20}$/.test(item.id)) return null;
  if (song.album && hasText(song.album.name)) item.album = song.album.name.trim();

  // Milliseconds already; kept only when a whole number above 0 and < 24 h.
  var ms = song.duration;
  if (typeof ms === 'number' && isFinite(ms) && ms > 0 && ms < MAX_DURATION_MS) {
    item.durationMs = Math.round(ms);
  }
  return item;
}
