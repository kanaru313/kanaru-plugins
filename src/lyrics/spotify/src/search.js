// Search tracks on Spotify Web API using authenticated user token.
load('common.js');

function execute(input) {
  var tokenRes = getSpotifyToken(false);
  if (tokenRes.failure) return tokenRes.failure;
  var token = tokenRes.token;

  var q = '';
  if (input && typeof input.text === 'string' && input.text.trim().length > 0) {
    q = input.text.trim();
  } else if (input) {
    var parts = [];
    if (input.title && typeof input.title === 'string' && input.title.trim().length > 0) {
      parts.push(input.title.trim());
    }
    if (input.artist && typeof input.artist === 'string' && input.artist.trim().length > 0) {
      parts.push(input.artist.trim());
    }
    q = parts.join(' ');
  }

  if (!q) {
    return Response.success([]);
  }

  var searchUrl = 'https://api.spotify.com/v1/search?q=' + encodeURIComponent(q) + '&type=track&limit=20';
  var searchRes = fetch(searchUrl, {
    headers: {
      'Authorization': 'Bearer ' + token,
      'accept': 'application/json'
    }
  });

  // If token expired, force refresh once
  if (searchRes.status === 401) {
    var refreshed = getSpotifyToken(true);
    if (refreshed.failure) return refreshed.failure;
    token = refreshed.token;
    searchRes = fetch(searchUrl, {
      headers: {
        'Authorization': 'Bearer ' + token,
        'accept': 'application/json'
      }
    });
  }

  if (searchRes.status === 429) {
    var retryHeader = searchRes.header('retry-after');
    var retrySec = retryHeader && /^\d+$/.test(retryHeader) ? parseInt(retryHeader, 10) : undefined;
    return Response.error('Spotify API rate limit', { kind: 'rateLimited', retryAfterSec: retrySec });
  }

  if (searchRes.status !== 200) {
    return Response.error('Spotify Search HTTP ' + searchRes.status, { kind: 'server' });
  }

  var searchJson;
  try {
    searchJson = searchRes.json();
  } catch (e) {
    return Response.error('Spotify Search: invalid JSON response', { kind: 'invalidResponse' });
  }

  var tracks = (searchJson && searchJson.tracks && Array.isArray(searchJson.tracks.items))
    ? searchJson.tracks.items
    : [];

  var results = [];
  for (var i = 0; i < tracks.length; i++) {
    var t = tracks[i];
    if (!t || !t.id || !t.name) continue;

    var artistNames = [];
    if (Array.isArray(t.artists)) {
      for (var j = 0; j < t.artists.length; j++) {
        if (t.artists[j] && t.artists[j].name) {
          artistNames.push(t.artists[j].name);
        }
      }
    }
    var artist = artistNames.join(', ') || 'Unknown';

    var item = {
      id: t.id,
      title: t.name,
      artist: artist,
      album: (t.album && t.album.name) ? t.album.name : undefined,
      durationMs: typeof t.duration_ms === 'number' ? t.duration_ms : undefined
    };
    results.push(item);
  }

  return Response.success(results.slice(0, 20));
}
