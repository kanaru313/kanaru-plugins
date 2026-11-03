// common.js — Shared utilities for translate plugins.

var API_ENDPOINT = 'https://api.example.com/v1/chat/completions';

/**
 * Reads a string config item or returns fallback.
 */
function readText(key, fallback) {
  var val = localConfig.getItem(key);
  if (val === null || val === undefined || val === '') return fallback;
  return String(val);
}

/**
 * Reads a boolean toggle config item (Schema v2 returns boolean).
 */
function readBoolean(key, fallback) {
  var val = localConfig.getItem(key);
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.toLowerCase() === 'true';
  return fallback;
}

/**
 * Reads a numeric (number/integer) config item (Schema v2 returns number).
 */
function readNumber(key, fallback, min, max) {
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
 * Parses secret API keys separated by commas, semicolons or newlines.
 */
function readApiKeys(keyName) {
  var raw = readText(keyName || 'apiKey', '').trim();
  if (!raw) return [];
  var tokens = raw.split(/[\s,;]+/);
  var keys = [];
  for (var i = 0; i < tokens.length; i++) {
    var k = tokens[i].trim();
    if (k && keys.indexOf(k) === -1) {
      keys.push(k);
    }
  }
  return keys;
}

/**
 * Formats song context into a readable string.
 */
function buildSongContext(song) {
  if (!song) return '';
  var parts = [];
  if (song.title) parts.push('Title: "' + song.title + '"');
  if (song.artist) parts.push('Artist: ' + song.artist);
  return parts.join(', ');
}

/**
 * Maps HTTP error status codes to Kanaru error categories.
 */
function handleTranslateError(res) {
  var status = res.status;
  if (status === 401 || status === 403) {
    return Response.error('API key refused (HTTP ' + status + ')', { kind: 'auth' });
  }
  if (status === 429) {
    var retryHeader = res.header('retry-after');
    var retrySec = retryHeader ? parseInt(retryHeader, 10) : 30;
    return Response.error('Rate limited or quota exceeded', { kind: 'rateLimited', retryAfterSec: retrySec });
  }
  if (status >= 500) {
    return Response.error('Translation service server error (HTTP ' + status + ')', { kind: 'server' });
  }
  return Response.error('Translation request failed (HTTP ' + status + ')', { kind: 'invalidResponse' });
}
