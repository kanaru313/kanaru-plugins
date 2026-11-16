// lyrics.js: fetch synchronized lyrics for one Megalobiz track ID.
//
// execute(id) → Response.success({ data, type, instrumental? }) | Response.success(null)
load('common.js');

function execute(id) {
  var idStr = String(id == null ? '' : id).trim();
  if (!idStr || !/^\d+$/.test(idStr)) {
    return Response.error('Megalobiz: invalid track ID', { kind: 'invalidResponse' });
  }

  var res = megalobizGet('/lrc/' + encodeURIComponent(idStr) + '?format=lrc', 'text');
  if (res.notFound) {
    return Response.success(null);
  }
  if (res.failure) {
    return res.failure;
  }

  var raw = typeof res.text === 'string' ? res.text.trim() : '';
  if (!raw) {
    return Response.success(null);
  }

  var cleaned = cleanLrc(raw);
  if (!cleaned) {
    return Response.success(null);
  }

  var hasSync = /\[\d{1,3}:\d{1,2}/.test(cleaned);
  return Response.success({
    data: cleaned,
    type: hasSync ? 'lrc' : 'txt',
  });
}
