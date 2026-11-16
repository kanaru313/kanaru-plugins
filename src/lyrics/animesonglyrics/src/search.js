// search.js: search song pages on Anime Song Lyrics.
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
    if (artist) q += ' ' + artist;
  }

  if (!q) return Response.success([]);

  var got = animeGet('/results?q=' + encodeURIComponent(q));
  if (got.failure) return got.failure;

  var html = got.text || '';
  return Response.success(parseResults(html));
}

function parseResults(html) {
  var re = /<a\s+href=["']https:\/\/www\.animesonglyrics\.com\/([^"']+)["']\s+class=["']list-group-item["'][^>]*>([\s\S]*?)<\/a>/gi;
  var out = [];
  var seen = {};
  var m;

  while ((m = re.exec(html)) !== null && out.length < 20) {
    var slug = m[1].replace(/^\/+|\/+$/g, '');
    if (slug.indexOf('/') === -1 || seen[slug]) continue; // Only song pages (anime/song)

    var rawText = m[2].replace(/<[^>]+>/g, '').trim();
    var colonIdx = rawText.indexOf(':');
    var songInfo = colonIdx !== -1 ? rawText.slice(colonIdx + 1).trim() : rawText;

    // Take the first line of songInfo (e.g. "LiSA - Gurenge")
    var firstLine = songInfo.split('\n')[0].trim();
    var dashIdx = firstLine.indexOf('-');
    var artist = 'Unknown';
    var title = firstLine;

    if (dashIdx !== -1) {
      artist = firstLine.slice(0, dashIdx).trim();
      title = firstLine.slice(dashIdx + 1).trim();
    }

    if (!title) continue;

    out.push({
      id: slug,
      title: title,
      artist: artist,
    });
    seen[slug] = true;
  }

  return out;
}
