// Helpers shared by search.js and lyrics.js. A script reaches this file with
// load('common.js'): every file of src/ runs in one global scope.
//
// Musixmatch mobile API client. Communicates with apic-appmobile.musixmatch.com.
var MXM_BASE = 'https://apic-appmobile.musixmatch.com/ws/1.1';
var APP_ID = 'mac-ios-v2.0';
var DEFAULT_TOKEN = '2611011a1e0567dc2176bd02f29b8478f355635abae4e511899e24';

var MXM_HEADERS = {
  'Host': 'apic-appmobile.musixmatch.com',
  'X-Cookie': 'x-mxm-token-guid=',
  'x-mxm-app-version': '10.1.1',
  'X-User-Agent': 'Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'application/json'
};

var TIME_TAG = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g;
var META_LINE = /^\[[a-z]+:.*\]$/i;
var DISCLAIMER = /^\s*(\*{7,}|<!--|\[?\d{10,}\]?|\(?\d{10,}\)?)/;
var CREDIT = /^(lyrics\s*by|written\s*by|paroles\s*par|letras\s*de|lời(?:\s+bài\s+hát)?|ca\s*sĩ|nhạc\s*sĩ|sáng\s*tác|tác\s*giả|beat|karaoke|sync(?:ed)?\s*by)\s*[:：]/i;

function invalidResponse(why) {
  return Response.error(why, { kind: 'invalidResponse' });
}

function cfg(key) {
  var v = localConfig.getItem(key);
  if (typeof v !== 'string' || v.trim() === '') return null;
  return v.trim();
}

function getToken(forceRefresh) {
  var userCfg = cfg('userToken');
  if (userCfg) return userCfg;

  if (!forceRefresh) {
    var cached = localStorage.getItem('mxm_token');
    if (cached && typeof cached === 'string' && cached.trim() !== '') {
      return cached.trim();
    }
  }

  var res;
  try {
    res = fetch(MXM_BASE + '/token.get', {
      headers: MXM_HEADERS,
      queries: { app_id: APP_ID }
    });
  } catch (e) {
    res = null;
  }

  if (res && res.status === 200) {
    try {
      var json = res.json();
      var code = json && json.message && json.message.header && json.message.header.status_code;
      var token = json && json.message && json.message.body && json.message.body.user_token;
      if (code === 200 && typeof token === 'string' && token !== '' && !/^0+$/.test(token)) {
        localStorage.setItem('mxm_token', token);
        return token;
      }
    } catch (e) {}
  }

  localStorage.setItem('mxm_token', DEFAULT_TOKEN);
  return DEFAULT_TOKEN;
}

function mxmGet(endpoint, params, isRetry) {
  var token = getToken(false);
  var queries = {
    app_id: APP_ID,
    usertoken: token
  };
  if (params) {
    for (var k in params) {
      if (Object.prototype.hasOwnProperty.call(params, k) && params[k] !== null && params[k] !== undefined) {
        queries[k] = params[k];
      }
    }
  }

  var res = fetch(MXM_BASE + endpoint, {
    headers: MXM_HEADERS,
    queries: queries
  });

  if (res.status === 429) {
    var retryAfter = 60;
    var h = res.header('retry-after');
    if (h) {
      var parsed = parseInt(h, 10);
      if (!isNaN(parsed) && parsed > 0) retryAfter = parsed;
    }
    return { failure: Response.error('rate limited by Musixmatch', { kind: 'rateLimited', retryAfterSec: retryAfter }) };
  }

  if (res.status !== 200) {
    return { failure: Response.error('HTTP ' + res.status + ' from Musixmatch', { kind: 'server' }) };
  }

  var body;
  try {
    body = res.json();
  } catch (e) {
    return { failure: invalidResponse('bad JSON response from Musixmatch') };
  }

  var header = body && body.message && body.message.header;
  if (!header) {
    return { failure: invalidResponse('missing message header') };
  }

  var statusCode = header.status_code;
  if ((statusCode === 401 || statusCode === 402) && !isRetry) {
    if (!cfg('userToken')) {
      localStorage.removeItem('mxm_token');
      getToken(true);
      return mxmGet(endpoint, params, true);
    }
  }

  if (statusCode === 429) {
    return { failure: Response.error('rate limited by Musixmatch', { kind: 'rateLimited', retryAfterSec: 60 }) };
  }

  if (statusCode === 404) {
    return { notFound: true, header: header };
  }

  if (statusCode !== 200) {
    var hint = header.hint || 'status ' + statusCode;
    return { failure: Response.error('Musixmatch API error: ' + hint, { kind: 'server' }) };
  }

  return {
    header: header,
    body: (body.message && body.message.body) || {}
  };
}

function content(line) {
  return line.replace(TIME_TAG, '').trim().normalize('NFC');
}

function stripCredits(text) {
  var all = text.split('\n');
  var start = 0;
  for (var i = 0; i < all.length; i++) {
    var c = content(all[i]);
    if (CREDIT.test(c) || DISCLAIMER.test(c)) start = i + 1;
    else if (c !== '' && !META_LINE.test(c)) break;
  }
  var end = all.length;
  while (end > start) {
    var rawLine = all[end - 1].trim();
    var d = content(rawLine);
    if (rawLine === '' || CREDIT.test(d) || DISCLAIMER.test(d)) end--;
    else break;
  }
  if (start === 0 && end === all.length) return text;
  return all.slice(start, end).join('\n');
}

function cleanLrc(raw) {
  var text = stripCredits(raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n'));
  var real = false;
  var all = text.split('\n');
  for (var i = 0; i < all.length; i++) {
    var c = content(all[i]);
    if (c !== '' && !META_LINE.test(c)) { real = true; break; }
  }
  return real ? text : null;
}

