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

function normalizeBandcampUrl(rawUrl) {
    var url = trimText(rawUrl);
    if (!url) return "";
    // Fix concatenated URLs from Bandcamp search API
    var lastHttps = url.lastIndexOf("https://");
    if (lastHttps > 0) {
        url = url.substring(lastHttps);
    }
    return url;
}

function bandcampGet(url, headers) {
    var reqHeaders = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7"
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
        var msg = "Bandcamp HTTP " + res.status;
        if (res.status === 429) {
            return { failure: Response.error(msg, { kind: ERROR_KIND.NETWORK, retryAfterSec: 5 }) };
        }
        return { failure: Response.error(msg, { kind: ERROR_KIND.NETWORK }) };
    }

    return { res: res };
}

// Storage helpers (Quota-safe < 64 KiB)
var CACHE_PREFIX = "bc:";

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

function extractTralbumFromHtml(html) {
    if (!html || typeof html !== "string") return null;

    // 1. data-tralbum="..." attribute
    var attrMatch = html.match(/data-tralbum="([^"]+)"/);
    if (attrMatch) {
        var decoded = decodeHtml(attrMatch[1]);
        var parsed = safeJsonParse(decoded);
        if (parsed) return parsed;
    }

    // 2. data-tralbum='...' attribute
    var attrMatchSingle = html.match(/data-tralbum='([^']+)'/);
    if (attrMatchSingle) {
        var decoded2 = decodeHtml(attrMatchSingle[1]);
        var parsed2 = safeJsonParse(decoded2);
        if (parsed2) return parsed2;
    }

    // 3. TralbumData JS var
    var jsMatch = html.match(/var\s+TralbumData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
    if (jsMatch) {
        var parsed3 = safeJsonParse(jsMatch[1]);
        if (parsed3) return parsed3;
    }

    return null;
}

function parseBandcampSearchItem(item) {
    if (!item) return null;
    var rawUrl = normalizeBandcampUrl(item.url || "");
    if (!rawUrl) return null;

    var kind = "track";
    if (item.type === "a") kind = "album";
    else if (item.type === "b") kind = "artist";

    var title = decodeHtml(item.name || "Bandcamp Track");
    var artist = decodeHtml(item.band_name || item.name || "Bandcamp Artist");
    var artworkUrl = item.img || "";

    // ID encoding: if track: encode url or bandcamp track ID
    // We store URL as primary resolver key for reliable direct streaming
    var id = rawUrl;

    return {
        kind: kind,
        id: id,
        title: title,
        subtitle: artist,
        artist: artist,
        artists: [{ id: String(item.band_id || ""), title: artist }],
        artworkUrl: artworkUrl,
        webUrl: rawUrl
    };
}
