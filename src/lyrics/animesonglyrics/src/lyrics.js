// lyrics.js: fetch lyrics from Anime Song Lyrics for one song slug.
//
// execute(id) → Response.success({ data, type: 'txt' }) | Response.success(null)
load('common.js');

function execute(id) {
  var slug = String(id == null ? '' : id).trim().replace(/^\/+|\/+$/g, '');
  if (!slug) {
    return Response.error('Anime Song Lyrics: missing song slug', { kind: 'invalidResponse' });
  }

  var got = animeGet('/' + slug);
  if (got.notFound) return Response.success(null);
  if (got.failure) return got.failure;

  var html = got.text || '';
  var romMatch = /<div\s+class=["']?romajilyrics-sbs["']?[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  var kanjiMatch = /<div\s+class=["']?kanjilyrics-sbs["']?[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  var engMatch = /<div\s+class=["']?englishlyrics-sbs["']?[^>]*>([\s\S]*?)<\/div>/i.exec(html);

  var rom = romMatch ? cleanHtml(romMatch[1]) : '';
  var kanji = kanjiMatch ? cleanHtml(kanjiMatch[1]) : '';
  var eng = engMatch ? cleanHtml(engMatch[1]) : '';

  if (!rom && !kanji && !eng) {
    return Response.success(null);
  }

  var pref = localConfig.getItem('preferredSection') || 'all';
  var result = '';

  if (pref === 'romaji' && rom) {
    result = rom;
  } else if (pref === 'kanji' && kanji) {
    result = kanji;
  } else if (pref === 'english' && eng) {
    result = eng;
  } else {
    var parts = [];
    if (rom) {
      parts.push('[Romaji]\n' + rom);
    }
    if (kanji) {
      parts.push('[Kanji]\n' + kanji);
    }
    if (eng) {
      parts.push('[English]\n' + eng);
    }
    result = parts.join('\n\n');
  }

  return Response.success({
    data: result.trim(),
    type: 'txt',
  });
}
