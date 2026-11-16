// search.js: search tracks on QQ Music.
//
// input is {title, artist, ...} (tags) or {text} (typed in Choose lyrics).
load('common.js');

function execute(input) {
  var queries = [];
  if (typeof input.text === 'string' && input.text.trim() !== '') {
    queries.push(input.text.trim().normalize('NFC'));
  } else {
    var title = typeof input.title === 'string' ? input.title.trim().normalize('NFC') : '';
    if (title === '') return Response.success([]);
    var artist = typeof input.artist === 'string' ? input.artist.trim().normalize('NFC') : '';

    if (artist !== '') {
      queries.push(title + ' ' + artist);
      queries.push(artist + ' ' + title);
    }
    queries.push(title);
  }

  var items = [];
  for (var i = 0; i < queries.length && items.length === 0; i++) {
    var got = qqGet(QQ_SEARCH_URL, {
      p: 1,
      n: 20,
      w: queries[i],
      format: 'json'
    });
    if (got.failure) return got.failure;
    var data = got.data;
    var songList = data && data.data && data.data.song && data.data.song.list;
    if (Array.isArray(songList)) {
      items = mapSongs(songList);
    }
  }

  return Response.success(items);
}

function mapSongs(rawList) {
  var out = [];
  var seen = {};

  for (var i = 0; i < rawList.length && out.length < 20; i++) {
    var s = rawList[i];
    if (!s) continue;

    var mid = s.songmid || s.mid;
    if (typeof mid !== 'string' || mid === '' || mid.length > 256 || seen[mid]) continue;

    var title = typeof s.songname === 'string'
      ? htmlDecode(s.songname).trim()
      : (typeof s.name === 'string' ? htmlDecode(s.name).trim() : '');
    if (title === '') continue;

    var artistNames = [];
    if (Array.isArray(s.singer)) {
      for (var j = 0; j < s.singer.length; j++) {
        if (s.singer[j] && typeof s.singer[j].name === 'string' && s.singer[j].name.trim() !== '') {
          artistNames.push(htmlDecode(s.singer[j].name).trim());
        }
      }
    }
    var artist = artistNames.join(', ');
    if (artist === '') continue;

    var item = {
      id: mid,
      title: title,
      artist: artist
    };

    var albumName = typeof s.albumname === 'string'
      ? htmlDecode(s.albumname).trim()
      : (s.album && typeof s.album.name === 'string' ? htmlDecode(s.album.name).trim() : '');
    if (albumName !== '') {
      item.album = albumName;
    }

    if (typeof s.interval === 'number' && s.interval > 0 && s.interval < 86400) {
      item.durationMs = Math.round(s.interval * 1000);
    }

    seen[mid] = true;
    out.push(item);
  }

  return out;
}
