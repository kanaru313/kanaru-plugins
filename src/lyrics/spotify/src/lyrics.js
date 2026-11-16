// Fetch and format synced/plain lyrics from Spotify color-lyrics API.
load('common.js');

function execute(id) {
  if (typeof id !== 'string' || id.trim().length === 0) {
    return Response.success(null);
  }

  var trackId = id.trim();
  var tokenRes = getSpotifyToken(false);
  if (tokenRes.failure) return tokenRes.failure;
  var token = tokenRes.token;

  var lyricsUrl = 'https://spclient.wg.spotify.com/color-lyrics/v2/track/' + encodeURIComponent(trackId) + '?format=json&market=from_token';
  var lyricsHeaders = {
    'Authorization': 'Bearer ' + token,
    'app-platform': 'WebPlayer',
    'user-agent': USER_AGENT
  };

  var res = fetch(lyricsUrl, { headers: lyricsHeaders });

  // Token expiration retry
  if (res.status === 401) {
    var refreshed = getSpotifyToken(true);
    if (refreshed.failure) return refreshed.failure;
    token = refreshed.token;
    lyricsHeaders.Authorization = 'Bearer ' + token;
    res = fetch(lyricsUrl, { headers: lyricsHeaders });
  }

  if (res.status === 404) {
    return Response.success(null);
  }

  if (res.status === 429) {
    var retryHeader = res.header('retry-after');
    var retrySec = retryHeader && /^\d+$/.test(retryHeader) ? parseInt(retryHeader, 10) : undefined;
    return Response.error('Spotify Lyrics rate limit', { kind: 'rateLimited', retryAfterSec: retrySec });
  }

  if (res.status !== 200) {
    return Response.error('Spotify Lyrics HTTP ' + res.status, { kind: 'server' });
  }

  var json;
  try {
    json = res.json();
  } catch (e) {
    return Response.error('Spotify Lyrics: invalid JSON', { kind: 'invalidResponse' });
  }

  if (!json || !json.lyrics) {
    return Response.success(null);
  }

  var formatted = formatSpotifyLyrics(json.lyrics);
  if (!formatted) {
    return Response.success(null);
  }

  return Response.success(formatted);
}
