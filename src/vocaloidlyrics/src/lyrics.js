// lyrics.js: fetch wikitext lyrics for one page ID.
//
// execute(id) → Response.success({ data, type: 'txt' }) | Response.success(null)
load('common.js');

function execute(id) {
  var idStr = String(id == null ? '' : id).trim();
  if (!idStr) {
    return Response.error('Vocaloid Lyrics Wiki: missing page ID', { kind: 'invalidResponse' });
  }

  var got = wikiGet({
    action: 'parse',
    pageid: idStr,
    prop: 'wikitext',
    redirects: '1',
  });

  if (got.failure) return got.failure;

  var wikitext = got.data && got.data.parse && got.data.parse.wikitext && got.data.parse.wikitext['*'];
  if (typeof wikitext !== 'string' || !wikitext.trim()) {
    return Response.success(null);
  }

  var parsed = parseLyricsTable(wikitext);
  if (!parsed || parsed.length === 0) {
    return Response.success(null);
  }

  var pref = localConfig.getItem('preferredSection') || 'all';
  var formatted = formatLyrics(parsed, pref);

  if (!formatted.trim()) {
    return Response.success(null);
  }

  return Response.success({
    data: formatted.trim(),
    type: 'txt',
  });
}

function parseLyricsTable(wt) {
  var lines = wt.split('\n');
  var inTable = false;
  var rows = [];
  var curRow = [];

  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].trim();
    if (l.indexOf('{|') === 0) {
      inTable = true;
      continue;
    }
    if (l.indexOf('|}') === 0) {
      if (curRow.length > 0) rows.push(curRow);
      break;
    }
    if (!inTable) continue;

    if (l.indexOf('|-') === 0) {
      if (curRow.length > 0) {
        rows.push(curRow);
        curRow = [];
      }
    } else if (l.indexOf('|') === 0 && l.indexOf('||') !== 0) {
      var parts = l.slice(1).split('||');
      for (var p = 0; p < parts.length; p++) {
        curRow.push(cleanWikitext(parts[p]));
      }
    }
  }

  return rows;
}

function formatLyrics(rows, pref) {
  var jp = [];
  var rom = [];
  var eng = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || r.length === 0) continue;
    if (r[0]) jp.push(r[0]);
    if (r.length > 1 && r[1]) rom.push(r[1]);
    if (r.length > 2 && r[2]) eng.push(r[2]);
  }

  if (pref === 'romaji' && rom.length > 0) {
    return rom.join('\n');
  }
  if (pref === 'japanese' && jp.length > 0) {
    return jp.join('\n');
  }
  if (pref === 'english' && eng.length > 0) {
    return eng.join('\n');
  }

  // 'all' format
  var out = [];
  if (jp.length > 0) {
    out.push('[Japanese]');
    out.push(jp.join('\n'));
    out.push('');
  }
  if (rom.length > 0) {
    out.push('[Romaji]');
    out.push(rom.join('\n'));
    out.push('');
  }
  if (eng.length > 0) {
    out.push('[English]');
    out.push(eng.join('\n'));
  }

  return out.join('\n');
}
