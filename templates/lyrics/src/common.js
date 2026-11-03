// common.js — Shared helpers and configurations for lyrics provider.
// Loaded via load('common.js') into the global scope.

var BASE_URL = 'https://api.example.com/v1';

/**
 * Reads a string config item or returns fallback.
 */
function readConfigText(key, fallback) {
  var val = localConfig.getItem(key);
  if (typeof val !== 'string' || val.trim() === '') return fallback;
  return val.trim();
}

/**
 * Reads a boolean toggle config item (Schema v2 returns boolean directly).
 */
function readConfigBool(key, fallback) {
  var val = localConfig.getItem(key);
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.toLowerCase() === 'true';
  return fallback;
}

/**
 * Reads an integer/number config item (Schema v2 returns number directly).
 */
function readConfigNumber(key, fallback, min, max) {
  var val = localConfig.getItem(key);
  var num;
  if (typeof val === 'number') {
    num = val;
  } else if (typeof val === 'string' && val.trim() !== '') {
    num = Number(val);
  } else {
    num = fallback;
  }
  if (isNaN(num)) num = fallback;
  if (typeof min === 'number') num = Math.max(min, num);
  if (typeof max === 'number') num = Math.min(max, num);
  return num;
}

/**
 * Maps standard HTTP error responses to typed Response.error.
 */
function handleHttpError(res) {
  var status = res.status;
  if (status === 401 || status === 403) {
    return Response.error('Authentication refused (HTTP ' + status + ')', { kind: 'auth' });
  }
  if (status === 429) {
    var retryHeader = res.header('retry-after');
    var retrySec = retryHeader ? parseInt(retryHeader, 10) : 30;
    return Response.error('Rate limited by server', { kind: 'rateLimited', retryAfterSec: retrySec });
  }
  if (status >= 500) {
    return Response.error('Server error (HTTP ' + status + ')', { kind: 'server' });
  }
  return Response.error('Request failed with HTTP ' + status, { kind: 'invalidResponse' });
}

/**
 * Removes typical credit lines at the beginning or ending of lyrics.
 */
function stripCredits(lyricsText) {
  if (!lyricsText) return '';
  var creditRegex = /^(作词|作曲|编曲|Written by|Composed by|Bài hát|Ca sĩ|Nhạc sĩ)\s*[:：]/i;
  var lines = lyricsText.split('\n');
  
  // Strip starting credits
  while (lines.length > 0 && creditRegex.test(lines[0].replace(/^\[\d{2}:\d{2}\.\d{2,3}\]\s*/, '').trim())) {
    lines.shift();
  }
  // Strip trailing credits
  while (lines.length > 0 && creditRegex.test(lines[lines.length - 1].replace(/^\[\d{2}:\d{2}\.\d{2,3}\]\s*/, '').trim())) {
    lines.pop();
  }
  return lines.join('\n').trim();
}
