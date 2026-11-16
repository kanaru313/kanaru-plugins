// search.js: search song chords & lyrics on Hợp Âm Chuẩn.
//
// input is {title, artist, album?, durationMs?} or {text}.
load('common.js');

function execute(input) {
  var q = '';
  if (input && typeof input.text === 'string' && input.text.trim() !== '') {
    q = input.text.trim();
  } else if (input) {
    var title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) return Response.success([]);
    var artist = typeof input.artist === 'string' ? input.artist.trim() : '';
    q = title;
    if (artist) {
      q += ' ' + artist;
    }
  }

  if (!q) return Response.success([]);

  var res = hopamGet('/search', { q: q });
  if (res.failure) return res.failure;

  var items = parseSearchResults(res.data);
  return Response.success(items);
}
