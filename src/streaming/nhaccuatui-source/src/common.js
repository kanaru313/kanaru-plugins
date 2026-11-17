var NCT_API = "https://graph.nhaccuatui.com/api/v1";
var NCT_APP_ID = "6";

var ERROR_KIND = {
    AUTH: "auth",
    UNAVAILABLE: "unavailable",
    UNSUPPORTED: "unsupported",
    NETWORK: "network",
    INVALID_RESPONSE: "invalidResponse"
};

function trimText(str) {
    return String(str || "").replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, "");
}

function safeJsonParse(text) {
    try {
        return JSON.parse(String(text || ""));
    } catch (e) {
        return null;
    }
}

function buildHeaders(extra) {
    var h = {
        "x-nct-appid": NCT_APP_ID,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.nhaccuatui.com/",
        "Accept": "application/json, text/plain, */*"
    };
    if (extra) {
        for (var k in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k];
        }
    }
    return h;
}

function nctGet(path, queries) {
    var url = NCT_API + path;
    var res = fetch(url, {
        method: "GET",
        headers: buildHeaders(),
        queries: queries || {}
    });

    if (res.status === 429 || res.status === 503) {
        var header = (res.header("retry-after") || "").trim();
        return {
            failure: Response.error("NhacCuaTui yêu cầu tạm dừng gửi request (rate limit)", {
                kind: ERROR_KIND.NETWORK,
                retryAfterSec: /^\d+$/.test(header) ? parseInt(header, 10) : 5
            })
        };
    }

    if (res.status !== 200) {
        return { failure: Response.error("NhacCuaTui HTTP " + res.status, { kind: ERROR_KIND.NETWORK }) };
    }

    var json = null;
    try {
        json = res.json();
    } catch (e) {
        return { failure: Response.error("NhacCuaTui phản hồi định dạng không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE }) };
    }

    if (!json || typeof json !== "object") {
        return { failure: Response.error("Phản hồi không phải là đối tượng JSON", { kind: ERROR_KIND.INVALID_RESPONSE }) };
    }

    if (json.code === 224) {
        return { empty: true, data: null };
    }

    if (json.code !== 0 && json.code !== undefined) {
        var msg = json.msg ? (": " + json.msg) : "";
        return { failure: Response.error("NhacCuaTui mã lỗi " + json.code + msg, { kind: ERROR_KIND.UNAVAILABLE }) };
    }

    return { data: json.data !== undefined ? json.data : json };
}

// Storage / Cache helpers (Quota-safe < 64 KiB)
var CACHE_PREFIX = "nct:";

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
            try { store.removeItem(CACHE_PREFIX + key); } catch (ignored) {}
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
            v: value,
            e: Date.now() + (ttlMs || 300000)
        };
        store.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
    } catch (quotaError) {
        // QuotaExceededError: safely ignore
    }
}

function cacheRemove(key) {
    var store = getStorage();
    if (!store) return;
    try {
        store.removeItem(CACHE_PREFIX + key);
    } catch (ignored) {}
}

function extractNctKey(str) {
    var text = trimText(str);
    if (!text) return "";

    // Direct key e.g. CTCrPh2Yblky or 1704876910JwGr (12-16 chars alphanumeric)
    if (/^[A-Za-z0-9]{12,16}$/.test(text)) {
        return text;
    }

    // Song URL: nhaccuatui.com/bai-hat/...key.html or /song/key
    var songMatch = text.match(/\/bai-hat\/[^\/]+\.([A-Za-z0-9]+)\.html/i);
    if (songMatch) return songMatch[1];
    var songKeyMatch = text.match(/\/song\/([A-Za-z0-9]+)/i);
    if (songKeyMatch) return songKeyMatch[1];

    // Playlist URL: nhaccuatui.com/playlist/...key.html or /playlist/key
    var plMatch = text.match(/\/playlist\/[^\/]+\.([A-Za-z0-9]+)\.html/i);
    if (plMatch) return plMatch[1];
    var plKeyMatch = text.match(/\/playlist\/([A-Za-z0-9]+)/i);
    if (plKeyMatch) return plKeyMatch[1];

    // Artist URL: nhaccuatui.com/artist/key or /nghe-si-...
    var arMatch = text.match(/\/artist\/([A-Za-z0-9]+)/i);
    if (arMatch) return arMatch[1];

    return "";
}

function parseTrackCard(s) {
    if (!s || !s.key) return null;
    var title = trimText(s.name || s.title || "");
    if (!title) return null;

    var artist = trimText(s.artistName || "");
    if (!artist && Array.isArray(s.artist) && s.artist.length) {
        var names = [];
        for (var i = 0; i < s.artist.length; i++) {
            if (s.artist[i] && s.artist[i].name) names.push(s.artist[i].name);
        }
        artist = names.join(", ");
    }
    if (!artist) artist = "NhacCuaTui";

    var durationSec = typeof s.duration === "number" ? s.duration : 0;
    var artworkUrl = s.image || s.imageShare || s.avatar || "";

    return {
        kind: "track",
        id: s.key,
        title: title,
        subtitle: artist,
        artist: artist,
        artists: [{ id: String(s.artistId || ""), title: artist }],
        durationMs: durationSec > 0 ? durationSec * 1000 : 0,
        artworkUrl: artworkUrl,
        webUrl: "https://www.nhaccuatui.com/song/" + s.key
    };
}

function parsePlaylistCard(pl) {
    if (!pl || !pl.key) return null;
    var title = trimText(pl.name || pl.title || "");
    if (!title) return null;

    var artist = trimText(pl.artistName || pl.subName || pl.singerName || "NhacCuaTui");
    var totalSongs = typeof pl.totalSongs === "number" ? pl.totalSongs : 0;
    var sub = artist + (totalSongs > 0 ? (" · " + totalSongs + " bài hát") : "");

    return {
        kind: "playlist",
        id: pl.key,
        title: title,
        subtitle: sub,
        artist: artist,
        artworkUrl: pl.image || pl.avatar || "",
        webUrl: "https://www.nhaccuatui.com/playlist/" + pl.key
    };
}

function parseArtistCard(ar) {
    if (!ar || (!ar.key && !ar.id)) return null;
    var id = String(ar.key || ar.id || "");
    var name = trimText(ar.name || ar.fullName || "");
    if (!name) return null;

    return {
        kind: "artist",
        id: id,
        title: name,
        subtitle: ar.national || "Nghệ sĩ",
        artist: name,
        artworkUrl: ar.image || ar.cover || ar.avatar || "",
        webUrl: "https://www.nhaccuatui.com/artist/" + id
    };
}
