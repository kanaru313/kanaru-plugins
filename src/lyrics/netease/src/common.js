// Helpers shared by search.js and lyrics.js. A script reaches this file with
// load('common.js'): every file of src/ runs in one global scope.
//
// Unofficial API: music.163.com/api/* is what NetEase's own web player calls.
// It needs no cookie, key or special header (checked 2026-10-31).

var NETEASE = 'https://music.163.com';

// NetEase finds composed (NFC) text best, and taggers sometimes write
// decomposed text, so every query is sent in NFC.
function nfc(text) {
  return typeof text === 'string' ? text.normalize('NFC') : text;
}

// Whether value is a string with something other than whitespace in it.
function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// Response.error(...) for an answer that does not have the expected shape.
function invalidResponse(why) {
  return Response.error(why, { kind: 'invalidResponse' });
}

// GET NETEASE + path. Returns exactly one of:
//   { json }      a 200 answer whose JSON object has code 200
//   { failure }   a Response.error to return from execute()
// A failed fetch (network, blocked host, ...) throws. Not catching it is
// right: the app records the failure and the song is asked again later.
function neteaseGet(path, queries) {
  var res = fetch(NETEASE + path, { queries: queries });

  if (res.status === 429 || res.status === 503) {
    // Retry-After as whole seconds; any other form (an HTTP date) is ignored.
    var header = (res.header('retry-after') || '').trim();
    return {
      failure: Response.error('NetEase asked to slow down', {
        kind: 'rateLimited',
        retryAfterSec: /^\d+$/.test(header) ? parseInt(header, 10) : undefined,
      }),
    };
  }
  if (res.status !== 200) {
    return { failure: Response.error('HTTP ' + res.status, { kind: 'server' }) };
  }

  // NetEase labels its JSON "text/plain", so the content type is not checked:
  // the body is simply parsed.
  var json;
  try {
    json = res.json();
  } catch (e) {
    return { failure: invalidResponse('the answer is not valid JSON') };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { failure: invalidResponse('the answer is not a JSON object') };
  }
  // NetEase reports its own status in the body. Codes -460, -462 and 406 are
  // its throttling answers ("too frequent" / "too crowded"), and so is any
  // text that says so; every other code is a server failure.
  if (json.code !== 200) {
    var text = hasText(json.msg) ? json.msg : hasText(json.message) ? json.message : '';
    var message = 'NetEase code ' + json.code + (text ? ': ' + text.trim() : '');
    var throttled =
      json.code === -460 || json.code === -462 || json.code === 406 ||
      /频繁|拥挤/.test(text);
    return {
      failure: Response.error(message, { kind: throttled ? 'rateLimited' : 'server' }),
    };
  }
  return { json: json };
}
