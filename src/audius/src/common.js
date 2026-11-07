var AUDIUS_API_BASE = "https://api.audius.co";
var AUDIUS_WEB_BASE = "https://audius.co";
var DEFAULT_APP_NAME = "Kanaru";
var CACHE_PREFIX = "ad:";

var ERROR_KIND = {
    AUTH: "auth",               // Track bị khoá gated/NFT hoặc yêu cầu mua USDC
    UNAVAILABLE: "unavailable", // Track không tồn tại, bị xoá hoặc ID sai
    UNSUPPORTED: "unsupported", // Track không hỗ trợ phát (is_streamable: false)
    NETWORK: "network",         // Lỗi kết nối mạng, server 5xx hoặc timeout
    INVALID_RESPONSE: "invalidResponse" // Phản hồi từ Audius API không đúng định dạng
};

function trimText(text) {
    return String(text || "").replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, "");
}

function safeJsonParse(text) {
    try {
        return JSON.parse(String(text || ""));
    } catch (e) {
        return null;
    }
}

function getAppName() {
    try {
        if (typeof localConfig !== "undefined" && localConfig.getItem) {
            var configured = trimText(localConfig.getItem("appName") || "");
            if (configured) return configured;
        }
    } catch (e) {}
    return DEFAULT_APP_NAME;
}

function getStorage() {
    if (typeof cacheStorage !== "undefined" && cacheStorage) {
        return cacheStorage;
    }
    if (typeof localStorage !== "undefined" && localStorage) {
        return localStorage;
    }
    return null;
}

function cacheGet(key) {
    var store = getStorage();
    if (!store) return null;
    try {
        var raw = store.getItem(CACHE_PREFIX + key);
        if (!raw) return null;
        var entry = safeJsonParse(raw);
        if (!entry || !entry.e || entry.e < Date.now()) {
            try {
                store.removeItem(CACHE_PREFIX + key);
            } catch (ignored) {}
            return null;
        }
        return entry.v;
    } catch (e) {
        return null;
    }
}

function cacheSet(key, value, ttlMs) {
    var store = getStorage();
    if (!store) return;
    try {
        var entry = {
            e: Date.now() + (ttlMs || 60000),
            v: value
        };
        store.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
    } catch (e) {
        // Ignored on QuotaExceededError or storage restrictions
    }
}

function cacheRemove(key) {
    var store = getStorage();
    if (!store) return;
    try {
        store.removeItem(CACHE_PREFIX + key);
    } catch (e) {}
}

function chooseArtworkUrl(artwork) {
    if (!artwork) return "";
    if (typeof artwork === "string") return artwork;
    return artwork["480x480"] || artwork["1000x1000"] || artwork["150x150"] || "";
}

function isAudiusUrl(str) {
    return /^https?:\/\/(?:www\.)?audius\.co(?:\/|$)/i.test(trimText(str));
}

function extractTrackId(input) {
    var text = trimText(input);
    if (!text) return "";

    // Direct URL with /tracks/:id
    var trackMatch = text.match(/audius\.co\/tracks\/([A-Za-z0-9_-]+)/i);
    if (trackMatch && trackMatch[1]) {
        return trackMatch[1];
    }

    // Direct base58 or alphanumeric track ID (e.g. G0wyE, AK3w5q0, 98562)
    if (/^[A-Za-z0-9_-]{3,16}$/.test(text) && !/^(?:https?|tracks|playlist|album)$/i.test(text)) {
        return text;
    }

    return "";
}

function parseDurationMs(durationSec) {
    var n = Number(durationSec);
    if (isNaN(n) || n <= 0) return 0;
    return Math.round(n * 1000);
}

function parseTrackCard(track) {
    if (!track) return null;
    var id = track.id ? String(track.id) : (track.track_id ? String(track.track_id) : "");
    if (!id) return null;

    var title = trimText(track.title) || "Không có tiêu đề";

    var artist = "";
    var userId = "";
    if (track.user) {
        artist = trimText(track.user.name || track.user.handle || "");
        if (track.user.id) userId = String(track.user.id);
    }
    if (!artist && track.artists && track.artists.length) {
        artist = trimText(track.artists[0].name || "");
    }
    if (!artist) artist = "Audius";

    var durationMs = parseDurationMs(track.duration);
    var artworkUrl = chooseArtworkUrl(track.artwork);
    var webUrl = track.permalink
        ? (AUDIUS_WEB_BASE + track.permalink)
        : (AUDIUS_WEB_BASE + "/tracks/" + id);

    return {
        kind: "track",
        id: id,
        title: title,
        subtitle: artist,
        artist: artist,
        artists: [{ id: userId, title: artist }],
        durationMs: durationMs,
        artworkUrl: artworkUrl,
        webUrl: webUrl
    };
}

function parsePlaylistCard(playlist) {
    if (!playlist) return null;
    var id = playlist.id ? String(playlist.id) : "";
    if (!id) return null;

    var title = trimText(playlist.playlist_name || playlist.title) || "Playlist";
    var artist = "";
    if (playlist.user) {
        artist = trimText(playlist.user.name || playlist.user.handle || "");
    }
    if (!artist) artist = "Audius";

    var count = playlist.track_count || (playlist.tracks ? playlist.tracks.length : 0);
    var artworkUrl = chooseArtworkUrl(playlist.artwork);
    var webUrl = playlist.permalink
        ? (AUDIUS_WEB_BASE + playlist.permalink)
        : (AUDIUS_WEB_BASE + "/playlists/" + id);

    return {
        kind: "playlist",
        id: id,
        title: title,
        subtitle: (artist ? artist + " · " : "") + (count ? count + " tracks" : "Playlist"),
        artist: artist,
        artworkUrl: artworkUrl,
        webUrl: webUrl
    };
}

function parseUserCard(user) {
    if (!user) return null;
    var id = user.id ? String(user.id) : (user.handle ? String(user.handle) : "");
    if (!id) return null;

    var name = trimText(user.name || user.handle || "");
    var subs = user.follower_count ? (user.follower_count + " followers") : "Audius Creator";
    var artworkUrl = chooseArtworkUrl(user.profile_picture);
    var webUrl = user.handle ? (AUDIUS_WEB_BASE + "/" + user.handle) : (AUDIUS_WEB_BASE + "/users/" + id);

    return {
        kind: "artist",
        id: id,
        title: name || "Nghệ sĩ",
        subtitle: subs,
        artist: name || "Audius",
        artworkUrl: artworkUrl,
        webUrl: webUrl
    };
}
