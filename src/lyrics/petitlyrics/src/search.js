// search.js: search tracks on PetitLyrics.
//
// input is {title, artist, ...} (tags) or {text} (typed in Choose lyrics).
load('common.js');

function execute(input) {
  var queries = [];

  if (typeof input.text === 'string' && input.text.trim() !== '') {
    queries.push({ key_title: input.text.trim().normalize('NFC') });
  } else {
    var title = typeof input.title === 'string' ? input.title.trim().normalize('NFC') : '';
    if (title === '') return Response.success([]);
    var artist = typeof input.artist === 'string' ? input.artist.trim().normalize('NFC') : '';

    if (artist !== '') {
      queries.push({ key_title: title, key_artist: artist });
    }
    queries.push({ key_title: title });
  }

  var items = [];
  for (var i = 0; i < queries.length && items.length === 0; i++) {
    var params = queries[i];
    params.lyricsType = '3';
    params.maxCount = '20';

    var got = petitPost(params);
    if (got.failure) return got.failure;

    if (got.xml) {
      items = parseSongs(got.xml);
    }
  }

  return Response.success(items);
}

function parseSongs(xml) {
  var out = [];
  var seen = {};
  var songMatches = xml.match(/<song>[\s\S]*?<\/song>/g) || [];

  for (var i = 0; i < songMatches.length && out.length < 20; i++) {
    var s = songMatches[i];

    var idMatch = s.match(/<lyricsId>([\s\S]*?)<\/lyricsId>/);
    var id = idMatch ? idMatch[1].trim() : '';
    if (id === '' || id.length > 256 || seen[id]) continue;

    var titleMatch = s.match(/<title>([\s\S]*?)<\/title>/);
    var artistMatch = s.match(/<artist>([\s\S]*?)<\/artist>/);
    var title = titleMatch ? htmlDecode(titleMatch[1]).trim() : '';
    var artist = artistMatch ? htmlDecode(artistMatch[1]).trim() : '';
    if (title === '' || artist === '') continue;

    var item = {
      id: id,
      title: title,
      artist: artist
    };

    var albumMatch = s.match(/<album>([\s\S]*?)<\/album>/);
    if (albumMatch) {
      var album = htmlDecode(albumMatch[1]).trim();
      if (album !== '') item.album = album;
    }

    var durMatch = s.match(/<duration>(\d+)<\/duration>/);
    if (durMatch) {
      var dur = parseInt(durMatch[1], 10);
      if (dur > 0 && dur < 86400000) item.durationMs = dur;
    }

    // If lyricsData is directly present and is type 3 (word-sync WSY),
    // we can attach it directly to save the second call!
    var typeMatch = s.match(/<lyricsType>(\d+)<\/lyricsType>/);
    var dataMatch = s.match(/<lyricsData>([\s\S]*?)<\/lyricsData>/);
    if (typeMatch && dataMatch && typeMatch[1] === '3') {
      try {
        var decoded = decodeLyricsData('3', dataMatch[1]);
        if (decoded && decoded.data) {
          item.lyrics = decoded.data;
        }
      } catch (e) {}
    }

    seen[id] = true;
    out.push(item);
  }

  return out;
}
