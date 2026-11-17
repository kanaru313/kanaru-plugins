var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var DEFAULT_CLIENT_ID = "3dce8b55";

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

function getClientId() {
    if (typeof localConfig !== "undefined" && localConfig) {
        var custom = trimText(localConfig.getItem("clientId"));
        if (custom) return custom;
    }
    return DEFAULT_CLIENT_ID;
}

function getAudioQuality() {
    if (typeof localConfig !== "undefined" && localConfig) {
        var q = localConfig.getItem("audioQuality");
        if (q === "mp31") return "mp31";
    }
    return "mp32";
}

function jamendoGet(endpoint, params) {
    var clientId = getClientId();
    var queryParts = ["client_id=" + encodeURIComponent(clientId), "format=json"];

    if (params) {
        for (var k in params) {
            if (Object.prototype.hasOwnProperty.call(params, k) && params[k] !== undefined && params[k] !== null) {
                queryParts.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
            }
        }
    }

    var sep = endpoint.indexOf("?") === -1 ? "?" : "&";
    var fullUrl = "https://api.jamendo.com/v3.0/" + endpoint + sep + queryParts.join("&");

    var res = fetch(fullUrl, {
        method: "GET",
        headers: {
            "User-Agent": USER_AGENT,
            "Accept": "application/json"
        },
        timeout: 15000
    });

    if (!res.ok) {
        var msg = "Jamendo API HTTP " + res.status;
        if (res.status === 429) {
            return { failure: Response.error("Jamendo vượt quá giới hạn tần suất yêu cầu (429)", { kind: ERROR_KIND.NETWORK, retryAfterSec: 5 }) };
        }
        return { failure: Response.error(msg, { kind: ERROR_KIND.NETWORK }) };
    }

    var json = null;
    try {
        json = res.json();
    } catch (e) {
        return { failure: Response.error("Phản hồi JSON của Jamendo không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE }) };
    }

    if (json && json.headers && json.headers.status === "failed") {
        return { failure: Response.error("Lỗi Jamendo: " + (json.headers.error_message || "Không xác định"), { kind: ERROR_KIND.UNAVAILABLE }) };
    }

    return { res: res, json: json };
}

// Storage helpers (Quota-safe < 64 KiB)
var CACHE_PREFIX = "jm:";

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

function extractJamendoId(str) {
    var text = trimText(str);
    if (!text) return { type: "", id: "" };

    // Pure number -> default track
    if (/^\d+$/.test(text)) {
        return { type: "track", id: text };
    }

    // Short url: jamen.do/t/123 -> track
    var shortMatch = text.match(/jamen\.do\/t\/(\d+)/i);
    if (shortMatch) {
        return { type: "track", id: shortMatch[1] };
    }

    // jamendo.com/track/123 or album/123 or artist/123 or playlist/123
    var routeMatch = text.match(/jamendo\.com\/(track|album|artist|playlist)\/(\d+)/i);
    if (routeMatch) {
        return { type: routeMatch[1].toLowerCase(), id: routeMatch[2] };
    }

    // Compound format: type:id
    var colonMatch = text.match(/^(track|album|artist|playlist):(\d+)$/i);
    if (colonMatch) {
        return { type: colonMatch[1].toLowerCase(), id: colonMatch[2] };
    }

    return { type: "", id: "" };
}

function parseJamendoTrack(t) {
    if (!t || !t.id) return null;
    var rawId = String(t.id).trim();
    var title = decodeHtml(t.name || "");
    if (!title) return null;

    var artist = decodeHtml(t.artist_name || "Jamendo Artist");
    var album = decodeHtml(t.album_name || "");
    var durationSec = parseInt(t.duration || "0", 10) || 0;
    var artworkUrl = t.album_image || t.image || "";

    return {
        kind: "track",
        id: rawId,
        title: title,
        subtitle: artist,
        artist: artist,
        artists: [{ id: String(t.artist_id || ""), title: artist }],
        album: album,
        albums: t.album_id ? [{ id: String(t.album_id), title: album }] : [],
        durationMs: durationSec > 0 ? durationSec * 1000 : 0,
        artworkUrl: artworkUrl,
        webUrl: t.shareurl || ("https://www.jamendo.com/track/" + rawId)
    };
}
