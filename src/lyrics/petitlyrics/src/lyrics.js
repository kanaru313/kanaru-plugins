// lyrics.js: the lyrics of one PetitLyrics song.
//
// input is the `id` (lyricsId) string of a search result. Returns null (no lyrics),
// {instrumental: true}, or {data, type: 'lrc'|'txt'}.
load('common.js');

function execute(id) {
  var idStr = String(id).trim();
  if (!/^\d{1,64}$/.test(idStr)) {
    return invalidResponse('the id is not a PetitLyrics lyricsId');
  }

  // Request word-sync (WSY) or line-sync (LSY) by default
  var got = petitPost({
    key_lyricsId: idStr,
    lyricsType: '3'
  });

  if (got.failure) return got.failure;

  var xml = got.xml;
  if (!xml) return Response.success(null);

  var statusMatch = xml.match(/<status>([\s\S]*?)<\/status>/);
  if (!statusMatch || statusMatch[1] !== '00000000') {
    return Response.success(null);
  }

  var songMatch = xml.match(/<song>[\s\S]*?<\/song>/);
  if (!songMatch) return Response.success(null);

  var typeMatch = songMatch[0].match(/<lyricsType>(\d+)<\/lyricsType>/);
  var dataMatch = songMatch[0].match(/<lyricsData>([\s\S]*?)<\/lyricsData>/);

  if (!typeMatch || !dataMatch) {
    return Response.success(null);
  }

  var typeStr = typeMatch[1];
  var b64Data = dataMatch[1].trim();
  if (b64Data === '') return Response.success(null);

  var plainProvider = function() {
    var gotTxt = petitPost({
      key_lyricsId: idStr,
      lyricsType: '1'
    });
    if (gotTxt.failure || !gotTxt.xml) return null;
    var txtMatch = gotTxt.xml.match(/<lyricsData>([\s\S]*?)<\/lyricsData>/);
    if (!txtMatch) return null;
    return decodeUtf8(base64ToBytes(txtMatch[1].trim()));
  };

  var result = decodeLyricsData(typeStr, b64Data, plainProvider);
  if (!result || !result.data) {
    return Response.success(null);
  }

  return Response.success(result);
}
