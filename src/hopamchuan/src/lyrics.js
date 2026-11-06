// lyrics.js: fetch chord/lyrics for a song ID from Hợp Âm Chuẩn.
//
// execute(id) → Response.success({ data, type: 'txt' }) | Response.success(null)
load('common.js');

function execute(id) {
  var idStr = String(id == null ? '' : id).trim();
  if (!idStr) {
    return Response.error('Hợp Âm Chuẩn: missing song ID', { kind: 'invalidResponse' });
  }

  // Ensure leading slash isn't doubled
  if (idStr.charAt(0) === '/') {
    idStr = idStr.slice(1);
  }

  var res = hopamGet('/song/' + idStr);
  if (res.failure) return res.failure;

  var showChords = localConfig.getItem('showChords') !== false;
  var lyrics = extractLyricsFromHtml(res.data, showChords);

  if (!lyrics || !lyrics.trim()) {
    return Response.success(null);
  }

  return Response.success({
    data: lyrics.trim(),
    type: 'txt',
  });
}
