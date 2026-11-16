load("crypto.js");

var ZING_API = "https://zingmp3.vn/api/v2";
var ZING_HOME = "https://zingmp3.vn/";
var SIGNED_KEYS = ["count", "ctime", "id", "page", "type", "version"];
var SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
var CACHE_PREFIX = "zmp3:";

var ERROR_KIND = {
    AUTH: "auth",               // Bài hát chỉ dành riêng cho tài khoản VIP
    UNAVAILABLE: "unavailable", // Bài hát không tồn tại, bị gỡ bản quyền hoặc ID sai
    UNSUPPORTED: "unsupported", // Không có stream audio
    NETWORK: "network",         // Lỗi kết nối ZingMP3, timeout hoặc rate limit
    INVALID_RESPONSE: "invalidResponse" // Sai chữ ký hoặc lỗi API
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

function zingSig(path, params, secret) {
    var p = "";
    for (var i = 0; i < SIGNED_KEYS.length; i++) {
        var k = SIGNED_KEYS[i];
        var v = params[k];
        if (v === null || v === undefined || v === "") continue;
        var pair = encodeURIComponent(k) + "=" + encodeURIComponent(String(v));
        p += pair;
    }
    var message = "/api/v2" + path + CryptoJS.SHA256(p).toString();
    return CryptoJS.HmacSHA512(message, secret).toString();
}

function zingSession(force) {
    var store = getStorage();
    if (!force && store) {
        var cached = store.getItem("zmp3_rqid");
        var at = Number(store.getItem("zmp3_rqidAt") || 0);
        if (cached && at > 0 && Date.now() - at < SESSION_MAX_AGE_MS) {
            return { rqid: cached, cached: true };
        }
    }

    var res = fetch(ZING_HOME, {
        headers: {
            "Accept": "text/html",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
    });

    if (res.status !== 200) {
        return { failure: Response.error("HTTP " + res.status + " từ ZingMP3 home", { kind: ERROR_KIND.NETWORK }) };
    }

    var cookieStr = (res.header ? res.header("set-cookie") : (res.headers && res.headers["set-cookie"])) || "";
    var m = /(?:^|[;,]\s*)zmp3_rqid=([^;,\s]+)/.exec(cookieStr);
    if (!m) {
        return { failure: Response.error("ZingMP3 không cấp session cookie", { kind: ERROR_KIND.NETWORK }) };
    }

    if (store) {
        store.setItem("zmp3_rqid", m[1]);
        store.setItem("zmp3_rqidAt", String(Date.now()));
    }
    return { rqid: m[1], cached: false };
}

function zingGet(path, params) {
    var apiKey = cfg("apiKey", "X5BM3w8N7MKozC0B85o4KMlzLZKhV00y");
    var secret = cfg("secretKey", "acOrvUS15XRW2o9JksiK1KgQ6Vbds8ZW");
    var version = cfg("version", "1.22.4");

    var session = zingSession(false);
    if (session.failure) return session;

    var retried = false;
    for (;;) {
        var queries = {};
        for (var k in params) queries[k] = params[k];
        queries.ctime = String(Math.round(Date.now() / 1000));
        queries.version = version;
        queries.sig = zingSig(path, queries, secret);
        queries.apiKey = apiKey;

        var res = fetch(ZING_API + path, {
            queries: queries,
            headers: {
                "Cookie": "zmp3_rqid=" + session.rqid,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
        });

        if (res.status === 429 || res.status === 503) {
            return { failure: Response.error("ZingMP3 yêu cầu giãn tần suất gửi yêu cầu", { kind: ERROR_KIND.NETWORK }) };
        }
        if (res.status !== 200) {
            return { failure: Response.error("ZingMP3 phản hồi HTTP " + res.status, { kind: ERROR_KIND.NETWORK }) };
        }

        var json = safeJsonParse(res.text());
        if (!json || typeof json !== "object") {
            return { failure: Response.error("Dữ liệu ZingMP3 trả về không phải JSON hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE }) };
        }

        if (json.err === -201 && session.cached && !retried) {
            retried = true;
            session = zingSession(true);
            if (session.failure) return session;
            continue;
        }

        if (json.err === -104) {
            return { failure: Response.error("ZingMP3 từ chối chữ ký (signature refused): vui lòng kiểm tra apiKey/secretKey", { kind: ERROR_KIND.INVALID_RESPONSE }) };
        }

        if (json.err !== 0) {
            return { failure: Response.error((json.msg || "Lỗi từ ZingMP3") + " (code " + json.err + ")", { kind: ERROR_KIND.INVALID_RESPONSE }) };
        }

        return { data: json.data && typeof json.data === "object" ? json.data : {} };
    }
}

function extractEncodeId(input) {
    var text = trimText(input);
    if (!text) return "";

    var urlMatch = text.match(/\/([A-Za-z0-9]{6,16})\.html/i);
    if (urlMatch && urlMatch[1]) {
        return urlMatch[1];
    }

    if (/^[A-Za-z0-9]{6,16}$/.test(text)) {
        return text;
    }

    return "";
}

function parseTrackCard(s) {
    if (!s) return null;
    var id = s.encodeId || s.id || "";
    if (!id) return null;

    var title = trimText(s.title || "");
    if (!title) return null;

    var artist = trimText(s.artistsNames || "");
    var artistsList = [];
    if (Array.isArray(s.artists)) {
        var names = [];
        for (var j = 0; j < s.artists.length; j++) {
            if (s.artists[j] && s.artists[j].name) {
                names.push(s.artists[j].name);
                artistsList.push({ id: s.artists[j].alias || s.artists[j].id || "", title: s.artists[j].name });
            }
        }
        if (!artist) artist = names.join(", ");
    }
    if (!artist) artist = "ZingMP3";
    if (artistsList.length === 0) {
        artistsList.push({ id: "", title: artist });
    }

    var durationMs = (typeof s.duration === "number" && s.duration > 0) ? (s.duration * 1000) : 0;
    var artworkUrl = s.thumbnailM || s.thumbnail || "";
    var webUrl = s.link ? ("https://zingmp3.vn" + s.link) : ("https://zingmp3.vn/bai-hat/" + id + ".html");

    return {
        kind: "track",
        id: id,
        title: title,
        subtitle: artist,
        artist: artist,
        artists: artistsList,
        durationMs: durationMs,
        artworkUrl: artworkUrl,
        webUrl: webUrl
    };
}

function parsePlaylistCard(p) {
    if (!p) return null;
    var id = p.encodeId || p.id || "";
    if (!id) return null;

    var title = trimText(p.title || "");
    if (!title) return null;

    var artist = trimText(p.artistsNames || (p.artists && p.artists[0] && p.artists[0].name) || "ZingMP3");
    var artworkUrl = p.thumbnailM || p.thumbnail || "";
    var webUrl = p.link ? ("https://zingmp3.vn" + p.link) : ("https://zingmp3.vn/album/" + id + ".html");

    return {
        kind: "playlist",
        id: id,
        title: title,
        subtitle: artist + " · Danh sách phát",
        artist: artist,
        artworkUrl: artworkUrl,
        webUrl: webUrl
    };
}

function parseArtistCard(a) {
    if (!a) return null;
    var id = a.alias || a.id || "";
    if (!id) return null;

    var name = trimText(a.name || "");
    if (!name) return null;

    var artworkUrl = a.thumbnailM || a.thumbnail || "";
    var webUrl = a.link ? ("https://zingmp3.vn" + a.link) : ("https://zingmp3.vn/nghe-si/" + id);

    return {
        kind: "artist",
        id: id,
        title: name,
        subtitle: (a.totalFollow ? (a.totalFollow + " người quan tâm") : "Nghệ sĩ"),
        artist: name,
        artworkUrl: artworkUrl,
        webUrl: webUrl
    };
}
