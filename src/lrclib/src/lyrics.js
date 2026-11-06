// lyrics.js: fetch lyrics for one LRCLIB track ID.
//
// execute(id) → Response.success({ data, type, instrumental? }) | Response.success(null)
load('common.js');

function execute(id) {
  var idStr = String(id == null ? '' : id).trim();
  if (!idStr) {
    return Response.error('LRCLIB: missing track ID', { kind: 'invalidResponse' });
  }

  var res = lrclibGet('/get/' + encodeURIComponent(idStr));
  if (res.notFound) {
    return Response.success(null);
  }
  if (res.failure) {
    return res.failure;
  }

  var item = res.data;
  if (!item) {
    return Response.success(null);
  }

  if (item.instrumental === true) {
    return Response.success({ instrumental: true });
  }

  if (typeof item.syncedLyrics === 'string' && item.syncedLyrics.trim() !== '') {
    return Response.success({
      data: item.syncedLyrics.trim(),
      type: 'lrc',
    });
  }

  if (typeof item.plainLyrics === 'string' && item.plainLyrics.trim() !== '') {
    return Response.success({
      data: item.plainLyrics.trim(),
      type: 'txt',
    });
  }

  return Response.success(null);
}
