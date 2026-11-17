var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

function decodeHtml(html) {
    if (!html || typeof html !== "string") return "";
    return html
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, function(m, dec) { return String.fromCharCode(dec); })
        .replace(/&#x([0-9a-f]+);/gi, function(m, hex) { return String.fromCharCode(parseInt(hex, 16)); })
        .trim();
}

function kuwoGet(url, headers) {
    var reqHeaders = {
        "User-Agent": USER_AGENT,
        "Referer": "https://www.kuwo.cn/",
        "Accept": "application/json, text/plain, */*"
    };
    if (headers) {
        for (var k in headers) {
            if (Object.prototype.hasOwnProperty.call(headers, k)) reqHeaders[k] = headers[k];
        }
    }

    var res = fetch(url, {
        method: "GET",
        headers: reqHeaders,
        timeout: 15000
    });

    if (!res.ok) {
        var msg = "Kuwo Music HTTP " + res.status;
        if (res.status === 429) {
            return { failure: Response.error(msg, { kind: ERROR_KIND.NETWORK, retryAfterSec: 5 }) };
        }
        return { failure: Response.error(msg, { kind: ERROR_KIND.NETWORK }) };
    }

    return { res: res };
}

// Storage helpers (Quota-safe < 64 KiB)
var CACHE_PREFIX = "kw:";

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
    } catch (quotaError) {}
}

function cacheRemove(key) {
    var store = getStorage();
    if (!store) return;
    try {
        store.removeItem(CACHE_PREFIX + key);
    } catch (ignored) {}
}

function extractKuwoId(str) {
    var text = trimText(str);
    if (!text) return "";

    // Pure number or MUSIC_number
    var pureMatch = text.match(/^(?:MUSIC_)?(\d+)$/i);
    if (pureMatch) return pureMatch[1];

    // Detail URLs: kuwo.cn/play_detail/123 or album_detail/123 or playlist_detail/123
    var urlMatch = text.match(/\/(?:play_detail|album_detail|playlist_detail|singer_detail)\/(\d+)/i);
    if (urlMatch) return urlMatch[1];

    // Query param ?mid=123 or ?rid=123 or ?musicId=123
    var paramMatch = text.match(/[?&](?:mid|rid|id|musicId)=(\d+)/i);
    if (paramMatch) return paramMatch[1];

    return "";
}

function parseTrackCard(item) {
    if (!item) return null;
    var rawId = String(item.DC_TARGETID || item.MUSICRID || item.id || "").replace(/^MUSIC_/, "").trim();
    if (!rawId) return null;

    var title = decodeHtml(item.SONGNAME || item.FSONGNAME || item.NAME || item.name || "");
    if (!title) return null;

    var artist = decodeHtml(item.ARTIST || item.FARTIST || item.artist || "Kuwo Music");
    var album = decodeHtml(item.ALBUM || item.FALBUM || item.album || "");
    var durationSec = parseInt(item.DURATION || item.duration || "0", 10) || 0;

    var artworkUrl = "";
    if (item.web_albumpic_short) {
        artworkUrl = "https://img1.kuwo.cn/star/albumcover/" + item.web_albumpic_short;
    } else if (item.hts_MVPIC) {
        artworkUrl = item.hts_MVPIC;
    } else if (item.pic || item.cover) {
        artworkUrl = item.pic || item.cover;
    }

    return {
        kind: "track",
        id: rawId,
        title: title,
        subtitle: artist,
        artist: artist,
        artists: [{ id: String(item.ARTISTID || ""), title: artist }],
        album: album,
        albums: album ? [{ id: String(item.ALBUMID || ""), title: album }] : [],
        durationMs: durationSec > 0 ? durationSec * 1000 : 0,
        artworkUrl: artworkUrl,
        webUrl: "https://www.kuwo.cn/play_detail/" + rawId
    };
}
