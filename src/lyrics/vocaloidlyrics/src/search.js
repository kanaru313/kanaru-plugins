// search.js: search song pages on Vocaloid Lyrics Wiki.
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
    if (artist && !/vocaloid|hatsune|miku/i.test(artist)) {
      q += ' ' + artist;
    }
  }

  if (!q) return Response.success([]);

  var got = wikiGet({
    action: 'query',
    list: 'search',
    srsearch: q,
    srlimit: 20,
  });

  if (got.failure) return got.failure;

  var list = got.data && got.data.query && Array.isArray(got.data.query.search)
    ? got.data.query.search
    : [];

  return Response.success(mapCandidates(list));
}

function mapCandidates(list) {
  var out = [];
  var seen = {};

  for (var i = 0; i < list.length && out.length < 20; i++) {
    var item = list[i];
    if (!item || item.pageid == null) continue;
    var title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title || seen[item.pageid]) continue;

    // Filter out albums, producers, categories, lists
    if (/\((?:album|producer|disambiguation|franchise|series)\)/i.test(title)) {
      continue;
    }

    var cleanTitle = title.replace(/_*\([^)]+\)$/, '').trim() || title;

    var entry = {
      id: String(item.pageid),
      title: cleanTitle,
      artist: 'VOCALOID',
    };

    seen[item.pageid] = true;
    out.push(entry);
  }

  return out;
}
