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

function archiveGet(url, headers) {
    var reqHeaders = {
        "User-Agent": USER_AGENT,
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
        var msg = "Internet Archive HTTP " + res.status;
        if (res.status === 429) {
            return { failure: Response.error(msg, { kind: ERROR_KIND.NETWORK, retryAfterSec: 5 }) };
        }
        return { failure: Response.error(msg, { kind: ERROR_KIND.NETWORK }) };
    }

    return { res: res };
}

// Storage helpers (Quota-safe < 64 KiB)
var CACHE_PREFIX = "ia:";

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

function extractArchiveId(str) {
    var text = trimText(str);
    if (!text) return { identifier: "", filename: "" };

    // Compound format: identifier:filename
    var colonIdx = text.indexOf(":");
    if (colonIdx > 0 && !text.startsWith("http")) {
        return {
            identifier: text.substring(0, colonIdx).trim(),
            filename: text.substring(colonIdx + 1).trim()
        };
    }

    // URL format: archive.org/download/{identifier}/{filename...}
    var downloadMatch = text.match(/archive\.org\/download\/([^/?#]+)(?:\/(.+))?/i);
    if (downloadMatch) {
        return {
            identifier: decodeURIComponent(downloadMatch[1] || ""),
            filename: downloadMatch[2] ? decodeURIComponent(downloadMatch[2]) : ""
        };
    }

    // URL format: archive.org/details/{identifier}
    var detailsMatch = text.match(/archive\.org\/details\/([^/?#]+)/i);
    if (detailsMatch) {
        return {
            identifier: decodeURIComponent(detailsMatch[1] || ""),
            filename: ""
        };
    }

    // Pure identifier
    if (/^[a-zA-Z0-9_.-]+$/.test(text)) {
        return { identifier: text, filename: "" };
    }

    return { identifier: "", filename: "" };
}

function encodePath(filePath) {
    return filePath.split("/").map(function(part) {
        return encodeURIComponent(part);
    }).join("/");
}

function buildStreamUrl(identifier, filename) {
    return "https://archive.org/download/" + encodeURIComponent(identifier) + "/" + encodePath(filename);
}

function parseArchiveDoc(doc) {
    if (!doc || !doc.identifier) return null;
    var id = String(doc.identifier).trim();
    var title = decodeHtml(doc.title || id);
    var artist = decodeHtml(doc.creator || "Internet Archive");
    var artworkUrl = "https://archive.org/services/img/" + encodeURIComponent(id);

    return {
        kind: "track",
        id: id,
        title: title,
        subtitle: artist,
        artist: artist,
        artists: [{ id: "", title: artist }],
        artworkUrl: artworkUrl,
        webUrl: "https://archive.org/details/" + encodeURIComponent(id)
    };
}

function isAudioFile(f) {
    if (!f || !f.name) return false;
    var name = f.name.toLowerCase();
    if (name.endsWith(".afpk") || name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".xml") || name.endsWith(".sqlite")) {
        return false;
    }
    var fmt = String(f.format || "").toUpperCase();
    if (fmt.indexOf("MP3") !== -1 || fmt.indexOf("FLAC") !== -1 || fmt.indexOf("OGG") !== -1 || fmt.indexOf("M4A") !== -1 || fmt.indexOf("WAV") !== -1) {
        return true;
    }
    return name.endsWith(".mp3") || name.endsWith(".flac") || name.endsWith(".ogg") || name.endsWith(".m4a");
}

function findBestAudioFile(files, preferredFormat) {
    if (!Array.isArray(files) || files.length === 0) return null;

    var audioList = [];
    for (var i = 0; i < files.length; i++) {
        if (isAudioFile(files[i])) {
            audioList.push(files[i]);
        }
    }
    if (audioList.length === 0) return null;

    // 1. If preferred format matches
    if (preferredFormat) {
        var prefUpper = preferredFormat.toUpperCase();
        for (var j = 0; j < audioList.length; j++) {
            var f = audioList[j];
            var fFmt = String(f.format || "").toUpperCase();
            if (prefUpper === "FLAC" && (fFmt.indexOf("FLAC") !== -1 || f.name.toLowerCase().endsWith(".flac"))) {
                return f;
            }
            if (prefUpper.indexOf("128KBPS") !== -1 && fFmt.indexOf("128KBPS") !== -1) {
                return f;
            }
            if (prefUpper.indexOf("VBR") !== -1 && fFmt.indexOf("VBR") !== -1) {
                return f;
            }
        }
    }

    // 2. Default priority: VBR MP3 -> any MP3 -> FLAC -> others
    for (var k = 0; k < audioList.length; k++) {
        var fmt = String(audioList[k].format || "").toUpperCase();
        if (fmt.indexOf("VBR MP3") !== -1) return audioList[k];
    }
    for (var l = 0; l < audioList.length; l++) {
        var name = audioList[l].name.toLowerCase();
        if (name.endsWith(".mp3")) return audioList[l];
    }

    return audioList[0];
}
