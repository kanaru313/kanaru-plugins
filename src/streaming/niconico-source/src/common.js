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

function extractNicoId(str) {
    var text = trimText(str);
    if (!text) return "";

    // URL format: nicovideo.jp/watch/(sm|so|nm)?123
    var urlMatch = text.match(/nicovideo\.jp\/watch\/([a-zA-Z0-9_-]+)/i);
    if (urlMatch) return urlMatch[1];

    // Standard video code (sm123, so123, nm123)
    var codeMatch = text.match(/^((?:sm|so|nm)?\d+)$/i);
    if (codeMatch) {
        var id = codeMatch[1];
        if (/^\d+$/.test(id)) id = "sm" + id;
        return id;
    }

    return "";
}

function nicoGet(url, headers) {
    var reqHeaders = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        "X-Frontend-Id": "6",
        "X-Frontend-Version": "0"
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
        var msg = "NicoNico HTTP " + res.status;
        if (res.status === 429) {
            return { failure: Response.error(msg, { kind: ERROR_KIND.NETWORK, retryAfterSec: 5 }) };
        }
        return { failure: Response.error(msg, { kind: ERROR_KIND.NETWORK }) };
    }

    return { res: res };
}

// Storage helpers (Quota-safe < 64 KiB)
var CACHE_PREFIX = "nico:";

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

function parseNicoSnapshotItem(item) {
    if (!item || !item.contentId) return null;
    var contentId = String(item.contentId).trim();
    var title = decodeHtml(item.title || contentId);
    var durationSec = parseInt(item.lengthSeconds || "0", 10) || 0;
    var artworkUrl = item.thumbnailUrl || "";

    var artist = "NicoNico Producer";
    if (item.categoryTags) {
        artist = item.categoryTags;
    } else if (item.tags && typeof item.tags === "string") {
        var tagArr = item.tags.split(" ");
        if (tagArr.length > 0 && tagArr[0]) artist = tagArr[0];
    }

    return {
        kind: "track",
        id: contentId,
        title: title,
        subtitle: artist,
        artist: artist,
        artists: [{ id: "", title: artist }],
        durationMs: durationSec > 0 ? durationSec * 1000 : 0,
        artworkUrl: artworkUrl,
        webUrl: "https://www.nicovideo.jp/watch/" + contentId
    };
}
