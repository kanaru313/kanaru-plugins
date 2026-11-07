load("crypto.js");

var DEFAULT_SERVER = "https://demo.navidrome.org";
var CACHE_PREFIX = "subsonic:";
var SUBSONIC_API_VERSION = "1.16.1";
var CLIENT_NAME = "Kanaru";

var ERROR_KIND = {
    AUTH: "auth",               // Sai tên đăng nhập / mật khẩu, token hết hạn hoặc không đủ quyền
    UNAVAILABLE: "unavailable", // Bài hát không tồn tại trên server
    UNSUPPORTED: "unsupported", // Định dạng hoặc tham số không được hỗ trợ
    NETWORK: "network",         // Không kết nối được đến máy chủ Subsonic / Navidrome
    INVALID_RESPONSE: "invalidResponse" // Lỗi định dạng dữ liệu trả về
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
    } catch (e) {}
}

function cacheRemove(key) {
    var store = getStorage();
    if (!store) return;
    try {
        store.removeItem(CACHE_PREFIX + key);
    } catch (e) {}
}

function cfg(key, fallback) {
    try {
        if (typeof localConfig !== "undefined" && localConfig.getItem) {
            var v = localConfig.getItem(key);
            if (typeof v === "string" && v.trim() !== "") return v.trim();
        }
    } catch (e) {}
    return fallback;
}

function getServerUrl() {
    var raw = cfg("serverUrl", DEFAULT_SERVER);
    raw = trimText(raw).replace(/\/+$/, "");
    if (!raw) return DEFAULT_SERVER;
    if (!/^https?:\/\//i.test(raw)) {
        raw = "http://" + raw;
    }
    return raw;
}

function generateSalt() {
    var chars = "0123456789abcdef";
    var s = "";
    for (var i = 0; i < 12; i++) {
        s += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return s;
}

function getAuthParams() {
    var user = cfg("username", "demo");
    var pass = cfg("password", "demo");
    var salt = generateSalt();
    var token = CryptoJS.MD5(pass + salt).toString();
    return {
        u: user,
        t: token,
        s: salt,
        v: SUBSONIC_API_VERSION,
        c: CLIENT_NAME,
        f: "json"
    };
}

function toQueryString(params) {
    var pairs = [];
    for (var k in params) {
        if (params.hasOwnProperty(k)) {
            var val = params[k];
            if (val !== null && val !== undefined && val !== "") {
                pairs.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(val)));
            }
        }
    }
    return pairs.join("&");
}

function subsonicGet(endpoint, params) {
    var baseUrl = getServerUrl();
    var cleanEndpoint = endpoint.replace(/^\/+/, "");
    if (!cleanEndpoint.startsWith("rest/")) {
        cleanEndpoint = "rest/" + cleanEndpoint;
    }

    var auth = getAuthParams();
    var allParams = {};
    for (var ak in auth) allParams[ak] = auth[ak];
    if (params) {
        for (var pk in params) allParams[pk] = params[pk];
    }

    var url = baseUrl + "/" + cleanEndpoint + "?" + toQueryString(allParams);

    var res;
    try {
        res = fetch(url, {
            headers: {
                "Accept": "application/json",
                "User-Agent": "Kanaru/1.0 (+https://github.com/hieu313/kanaru)"
            }
        });
    } catch (e) {
        return { failure: Response.error("Không thể kết nối đến máy chủ Subsonic: " + (e.message || String(e)), { kind: ERROR_KIND.NETWORK }) };
    }

    if (res.status === 401 || res.status === 403) {
        return { failure: Response.error("Máy chủ Subsonic từ chối xác thực (HTTP " + res.status + ")", { kind: ERROR_KIND.AUTH }) };
    }

    if (res.status === 404) {
        return { failure: Response.error("Không tìm thấy API Subsonic trên máy chủ (HTTP 404)", { kind: ERROR_KIND.UNAVAILABLE }) };
    }

    if (res.status !== 200) {
        return { failure: Response.error("Máy chủ Subsonic phản hồi HTTP " + res.status, { kind: ERROR_KIND.NETWORK }) };
    }

    var json = safeJsonParse(res.text());
    if (!json || typeof json !== "object") {
        return { failure: Response.error("Dữ liệu Subsonic trả về không phải JSON hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE }) };
    }

    var subRes = json["subsonic-response"];
    if (!subRes) {
        return { failure: Response.error("Dữ liệu phản hồi thiếu trường subsonic-response", { kind: ERROR_KIND.INVALID_RESPONSE }) };
    }

    if (subRes.status === "failed") {
        var err = subRes.error || {};
        var code = Number(err.code || 0);
        var msg = err.message || "Lỗi không xác định từ máy chủ Subsonic";

        if (code === 40 || code === 50 || code === 60) {
            return { failure: Response.error(msg + " (code " + code + ")", { kind: ERROR_KIND.AUTH }) };
        }
        if (code === 70) {
            return { failure: Response.error(msg + " (code 70)", { kind: ERROR_KIND.UNAVAILABLE }) };
        }
        if (code === 10 || code === 20) {
            return { failure: Response.error(msg + " (code " + code + ")", { kind: ERROR_KIND.UNSUPPORTED }) };
        }
        return { failure: Response.error(msg + " (code " + code + ")", { kind: ERROR_KIND.INVALID_RESPONSE }) };
    }

    return { data: subRes, auth: auth, baseUrl: baseUrl };
}

function extractSongId(input) {
    var text = trimText(input);
    if (!text) return "";

    // subsonic://song/{id}
    var uriMatch = text.match(/^subsonic:\/\/song\/([A-Za-z0-9_\-]+)/i);
    if (uriMatch && uriMatch[1]) {
        return uriMatch[1];
    }

    // Query param id=... in URL
    var idParamMatch = text.match(/[?&]id=([A-Za-z0-9_\-]+)/i);
    if (idParamMatch && idParamMatch[1]) {
        return idParamMatch[1];
    }

    // Raw alphanumeric ID (Subsonic/Navidrome IDs are usually 10-32 chars alphanumeric or hex)
    if (/^[A-Za-z0-9_\-]{3,64}$/.test(text) && !text.includes(" ")) {
        return text;
    }

    return "";
}

function parseTrackCard(song, baseUrl, auth) {
    if (!song) return null;
    var id = String(song.id || "");
    if (!id) return null;

    var title = trimText(song.title || "Unknown");
    var artist = trimText(song.artist || song.albumArtist || song.displayArtist || "Unknown Artist");
    var durationSec = Number(song.duration || 0);
    var durationMs = durationSec > 0 ? Math.round(durationSec * 1000) : 0;

    var artworkUrl = "";
    if (song.coverArt) {
        var authParams = auth || getAuthParams();
        var covParams = {
            id: song.coverArt,
            size: 300
        };
        for (var k in authParams) covParams[k] = authParams[k];
        var root = baseUrl || getServerUrl();
        artworkUrl = root + "/rest/getCoverArt.view?" + toQueryString(covParams);
    }

    return {
        id: id,
        title: title,
        artist: artist,
        durationMs: durationMs,
        artworkUrl: artworkUrl,
        webUrl: (baseUrl || getServerUrl()) + "/#"
    };
}
