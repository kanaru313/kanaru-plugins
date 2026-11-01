// Shared helpers for Spotify lyrics plugin.
// Loaded via load('common.js') into the shared global execution scope.
load('crypto.js');

var CLIENT_VERSION = '1.2.46.25.g7f189073';
var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

// Known TOTP secret cipher dictionaries for Spotify Web Player.
var BUNDLED_SECRET_DICT = {
  '59': [123, 105, 79, 70, 110, 59, 52, 125, 60, 49, 80, 70, 89, 75, 80, 86, 63, 53, 123, 37, 117, 49, 52, 93, 77, 62, 47, 86, 48, 104, 68, 72],
  '60': [79, 109, 69, 123, 90, 65, 46, 74, 94, 34, 58, 48, 70, 71, 92, 85, 122, 63, 91, 64, 87, 87],
  '61': [44, 55, 47, 42, 70, 40, 34, 114, 76, 74, 50, 111, 120, 97, 75, 76, 94, 102, 43, 69, 49, 120, 118, 80, 64, 78]
};

function getSecretDict() {
  var stored = localStorage.getItem('spotify_secret_dict');
  if (stored) {
    try {
      var parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (e) {}
  }
  return BUNDLED_SECRET_DICT;
}

function updateSecretDictFromGitHub() {
  try {
    var res = fetch('https://raw.githubusercontent.com/xyloflake/spot-secrets-go/main/secrets/secretDict.json', {
      timeout: 4000
    });
    if (res.status === 200) {
      var json = res.json();
      if (json && typeof json === 'object') {
        localStorage.setItem('spotify_secret_dict', JSON.stringify(json));
        return json;
      }
    }
  } catch (e) {}
  return null;
}

function deriveSecretKey(asciiCodes) {
  var transformed = [];
  for (var i = 0; i < asciiCodes.length; i++) {
    transformed.push(asciiCodes[i] ^ ((i % 33) + 9));
  }
  return transformed.join('');
}

function generateTotp(serverTimeMs, secretKey) {
  var period = 30;
  var counter = Math.floor(serverTimeMs / 1000 / period);
  var high = Math.floor(counter / 0x100000000);
  var low = counter >>> 0;
  var messageWords = CryptoJS.lib.WordArray.create([high, low], 8);
  var keyWords = CryptoJS.enc.Utf8.parse(secretKey);
  var hmac = CryptoJS.HmacSHA1(messageWords, keyWords);
  var hex = hmac.toString(CryptoJS.enc.Hex);
  var offset = parseInt(hex.substr(38, 2), 16) & 0x0f;
  var binary = parseInt(hex.substr(offset * 2, 8), 16) & 0x7fffffff;
  return ('000000' + (binary % 1000000)).slice(-6);
}

function getSpDc() {
  var v = localConfig.getItem('spDc');
  if (typeof v !== 'string' || v.trim() === '') return null;
  return v.trim();
}

function missingSpDcError() {
  return Response.error('Vui lòng nhập cookie sp_dc trong cài đặt plugin Spotify (Cài đặt > Nguồn lời bài hát > Spotify)', {
    kind: 'invalidResponse'
  });
}

function getSpotifyToken(forceRefresh) {
  var spDc = getSpDc();
  if (!spDc) {
    return { failure: missingSpDcError() };
  }

  if (!forceRefresh) {
    var cachedToken = localStorage.getItem('spotify_access_token');
    var cachedExpires = Number(localStorage.getItem('spotify_token_expires') || '0');
    var cachedSpDc = localStorage.getItem('spotify_cached_sp_dc');
    if (cachedToken && cachedSpDc === spDc && Date.now() < cachedExpires - 60000) {
      return { token: cachedToken };
    }
  }

  // 1. Fetch server time
  var timeRes = fetch('https://open.spotify.com/api/server-time', {
    headers: {
      'accept': 'application/json',
      'user-agent': USER_AGENT
    }
  });
  if (timeRes.status !== 200) {
    return { failure: Response.error('Không thể lấy server-time từ Spotify (HTTP ' + timeRes.status + ')', { kind: 'server' }) };
  }
  var serverTimeSec;
  try {
    serverTimeSec = timeRes.json().serverTime;
  } catch (e) {
    return { failure: Response.error('Lỗi phân tích server-time từ Spotify', { kind: 'invalidResponse' }) };
  }
  var serverTimeMs = serverTimeSec * 1000;

  // 2. Generate TOTP
  var secretDict = getSecretDict();
  var versions = Object.keys(secretDict);
  var latestVersion = versions[versions.length - 1];
  var asciiCodes = secretDict[latestVersion];
  var secretKey = deriveSecretKey(asciiCodes);
  var totp = generateTotp(serverTimeMs, secretKey);

  // 3. Request access token
  var tokenUrl = 'https://open.spotify.com/api/token?reason=init&productType=web-player&totp=' +
    encodeURIComponent(totp) + '&totpVer=' + encodeURIComponent(latestVersion) +
    '&ts=' + encodeURIComponent(serverTimeMs);

  var tokenHeaders = {
    'accept': 'application/json',
    'app-platform': 'WebPlayer',
    'spotify-app-version': CLIENT_VERSION,
    'user-agent': USER_AGENT,
    'origin': 'https://open.spotify.com',
    'referer': 'https://open.spotify.com/',
    'cookie': 'sp_dc=' + spDc
  };

  var tokenRes = fetch(tokenUrl, { headers: tokenHeaders });

  // If 400, retry once with secrets updated from GitHub
  if (tokenRes.status === 400) {
    var freshDict = updateSecretDictFromGitHub();
    if (freshDict) {
      var freshVersions = Object.keys(freshDict);
      var freshLatest = freshVersions[freshVersions.length - 1];
      if (freshLatest !== latestVersion) {
        var freshKey = deriveSecretKey(freshDict[freshLatest]);
        var freshTotp = generateTotp(serverTimeMs, freshKey);
        tokenUrl = 'https://open.spotify.com/api/token?reason=init&productType=web-player&totp=' +
          encodeURIComponent(freshTotp) + '&totpVer=' + encodeURIComponent(freshLatest) +
          '&ts=' + encodeURIComponent(serverTimeMs);
        tokenRes = fetch(tokenUrl, { headers: tokenHeaders });
      }
    }
  }

  if (tokenRes.status === 302 || tokenRes.status === 401 || tokenRes.status === 403) {
    return { failure: Response.error('Cookie sp_dc không hợp lệ hoặc đã hết hạn. Vui lòng lấy cookie mới từ Spotify Web.', { kind: 'invalidResponse' }) };
  }

  if (tokenRes.status !== 200) {
    return { failure: Response.error('Không thể lấy access token từ Spotify (HTTP ' + tokenRes.status + ')', { kind: 'server' }) };
  }

  var tokenData;
  try {
    tokenData = tokenRes.json();
  } catch (e) {
    return { failure: Response.error('Lỗi phân tích token từ Spotify', { kind: 'invalidResponse' }) };
  }

  if (!tokenData || !tokenData.accessToken) {
    return { failure: Response.error('Spotify không trả về accessToken', { kind: 'invalidResponse' }) };
  }

  if (tokenData.isAnonymous) {
    return { failure: Response.error('Cookie sp_dc bị từ chối (trả về anonymous token). Vui lòng kiểm tra lại sp_dc trong Cài đặt.', { kind: 'invalidResponse' }) };
  }

  var accessToken = tokenData.accessToken;
  var expiresAt = tokenData.accessTokenExpirationTimestampMs || (Date.now() + 3600000);

  localStorage.setItem('spotify_access_token', accessToken);
  localStorage.setItem('spotify_token_expires', String(expiresAt));
  localStorage.setItem('spotify_cached_sp_dc', spDc);

  return { token: accessToken };
}

function formatLrcTimestamp(ms) {
  if (typeof ms !== 'number' || isNaN(ms) || ms < 0) ms = 0;
  var totalSec = Math.floor(ms / 1000);
  var minutes = Math.floor(totalSec / 60);
  var seconds = totalSec % 60;
  var centis = Math.floor((ms % 1000) / 10);
  return '[' +
    (minutes < 10 ? '0' : '') + minutes + ':' +
    (seconds < 10 ? '0' : '') + seconds + '.' +
    (centis < 10 ? '0' : '') + centis + ']';
}

function formatSpotifyLyrics(lyricsObj) {
  if (!lyricsObj || !lyricsObj.lines || !Array.isArray(lyricsObj.lines)) {
    return null;
  }

  var isSynced = lyricsObj.syncType === 'LINE_SYNCED';
  var lines = lyricsObj.lines;
  var lrcLines = [];
  var plainLines = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var words = (line && line.words) ? String(line.words).trim() : '';
    if (!words) continue;

    plainLines.push(words);

    if (isSynced) {
      var ms = parseInt(line.startTimeMs, 10);
      if (isNaN(ms)) ms = 0;
      lrcLines.push(formatLrcTimestamp(ms) + ' ' + words);
    }
  }

  if (plainLines.length === 0) {
    return null;
  }

  if (isSynced && lrcLines.length > 0) {
    return {
      data: lrcLines.join('\n'),
      type: 'lrc'
    };
  }

  return {
    data: plainLines.join('\n'),
    type: 'txt'
  };
}
