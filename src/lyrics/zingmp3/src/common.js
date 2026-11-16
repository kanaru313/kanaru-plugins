// Helpers shared by search.js and lyrics.js. A script reaches this file with
// load('common.js'): every file of src/ runs in one global scope.
//
// ZingMP3 has no public API. This plugin talks to the one its web client
// (zingmp3.vn) uses: every call carries a signature made from a key pair that
// is public in the client's JavaScript, and a session cookie from the home
// page. Keys come from the plugin settings so a rotation needs no new release.
load('crypto.js');

var ZING_API = 'https://zingmp3.vn/api/v2';
var ZING_HOME = 'https://zingmp3.vn/';
// The lyric file lives on this host; only addresses under it are fetched.
var ZING_LRC_PREFIX = 'https://static-zmp3.zmdcdn.me/';
// Request parameters the web client signs, in name order. Others (q) are not.
var SIGNED_KEYS = ['count', 'ctime', 'id', 'page', 'type', 'version'];
// The cookie lasts about 65 days; it is renewed well before that.
var SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function invalidResponse(why) {
  return Response.error(why, { kind: 'invalidResponse' });
}

// A trimmed config value, or null when the user left it empty.
function cfg(key) {
  var v = localConfig.getItem(key);
  if (typeof v !== 'string' || v.trim() === '') return null;
  return v.trim();
}

function missingConfig(key) {
  return invalidResponse('set ' + key + ' in the plugin settings');
}

// Signature of one call. Message: API path + SHA-256 (hex) of the signed
// parameters written as name=value pairs with nothing between them; key: the
// secret. Result: HMAC-SHA512 in hex.
function zingSig(path, params, secret) {
  var p = '';
  for (var i = 0; i < SIGNED_KEYS.length; i++) {
    var k = SIGNED_KEYS[i];
    var v = params[k];
    if (v === null || v === undefined || v === '') continue;
    var pair = encodeURIComponent(k) + '=' + encodeURIComponent(String(v));
    if (pair.length > 5000) continue;
    p += pair;
  }
  var message = '/api/v2' + path + CryptoJS.SHA256(p).toString();
  return CryptoJS.HmacSHA512(message, secret).toString();
}

// Session cookie value. Returns { rqid } or { failure }. `force` skips the
// cached value. The set-cookie header arrives as one string where cookies are
// joined with ", " and an Expires date holds a ", " too, so it is searched
// with a pattern, never split.
function zingSession(force) {
  if (!force) {
    var cached = localStorage.getItem('rqid');
    var at = Number(localStorage.getItem('rqidAt'));
    if (cached && at > 0 && Date.now() - at < SESSION_MAX_AGE_MS) {
      return { rqid: cached, cached: true };
    }
  }
  var res = fetch(ZING_HOME, { headers: { accept: 'text/html' } });
  if (res.status !== 200) {
    return { failure: Response.error('HTTP ' + res.status + ' from the home page', { kind: 'server' }) };
  }
  var m = /(?:^|[;,]\s*)zmp3_rqid=([^;,\s]+)/.exec(res.header('set-cookie') || '');
  if (!m) {
    return { failure: Response.error('ZingMP3 gave no session cookie', { kind: 'server' }) };
  }
  localStorage.setItem('rqid', m[1]);
  localStorage.setItem('rqidAt', String(Date.now()));
  return { rqid: m[1], cached: false };
}

// GET ZING_API + path with signature and session. Returns { data } (the
// "data" member of a successful answer) or { failure } (a Response.error).
// A failed fetch throws and is not caught: the app records it.
function zingGet(path, params) {
  var apiKey = cfg('apiKey');
  if (!apiKey) return { failure: missingConfig('apiKey') };
  var secret = cfg('secretKey');
  if (!secret) return { failure: missingConfig('secretKey') };
  var version = cfg('version');
  if (!version) return { failure: missingConfig('version') };

  var session = zingSession(false);
  if (session.failure) return session;
  var retried = false;
  for (;;) {
    var queries = {};
    for (var k in params) queries[k] = params[k];
    queries.ctime = String(Math.round(Date.now() / 1000));
    queries.version = version;
    queries.sig = zingSig(path, queries, secret);
    queries.apiKey = apiKey;
    var res = fetch(ZING_API + path, {
      queries: queries,
      headers: { cookie: 'zmp3_rqid=' + session.rqid },
    });

    if (res.status === 429 || res.status === 503) {
      var header = (res.header('retry-after') || '').trim();
      return {
        failure: Response.error('ZingMP3 asked to slow down', {
          kind: 'rateLimited',
          retryAfterSec: /^\d+$/.test(header) ? parseInt(header, 10) : undefined,
        }),
      };
    }
    if (res.status !== 200) {
      return { failure: Response.error('HTTP ' + res.status, { kind: 'server' }) };
    }
    if ((res.header('content-type') || '').toLowerCase().indexOf('application/json') !== 0) {
      return { failure: invalidResponse('the answer is not JSON') };
    }
    var json;
    try {
      json = res.json();
    } catch (e) {
      return { failure: invalidResponse('the answer is not valid JSON') };
    }
    if (json === null || typeof json !== 'object') {
      return { failure: invalidResponse('the answer is not an object') };
    }
    if (json.err === -201 && session.cached && !retried) {
      // The cached cookie is no longer accepted: get a new one, once.
      retried = true;
      session = zingSession(true);
      if (session.failure) return session;
      continue;
    }
    if (json.err === -104) {
      return { failure: invalidResponse('signature refused: check apiKey, secretKey and version') };
    }
    if (json.err !== 0) {
      return { failure: Response.error('ZingMP3 error ' + json.err, { kind: 'server' }) };
    }
    return { data: json.data && typeof json.data === 'object' ? json.data : {} };
  }
}
