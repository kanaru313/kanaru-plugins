var BILI_API_BASE = "https://api.bilibili.com";
var BILI_WEB_BASE = "https://www.bilibili.com";
var CACHE_PREFIX = "bili:";

var ERROR_KIND = {
    AUTH: "auth",               // Video yêu cầu quyền hạn VIP/đăng nhập
    UNAVAILABLE: "unavailable", // Video không tồn tại, bị ẩn, ID sai hoặc chặn vùng
    UNSUPPORTED: "unsupported", // Video không có luồng âm thanh
    NETWORK: "network",         // Lỗi kết nối mạng hoặc server 5xx
    INVALID_RESPONSE: "invalidResponse" // Cấu trúc dữ liệu API Bilibili thay đổi
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

function extractBvid(input) {
    var text = trimText(input);
    if (!text) return "";

    var bvMatch = text.match(/\b(BV[a-zA-Z0-9]{10})\b/i);
    if (bvMatch && bvMatch[1]) {
        return bvMatch[1];
    }

    var avMatch = text.match(/\b(av\d+)\b/i);
    if (avMatch && avMatch[1]) {
        return avMatch[1];
    }

    return "";
}

function parseDurationMs(duration) {
    if (!duration) return 0;
    if (typeof duration === "number") {
        return Math.round(duration * 1000);
    }
    var str = trimText(duration);
    if (/^\d+$/.test(str)) {
        return parseInt(str, 10) * 1000;
    }
    var parts = str.split(":");
    var sec = 0;
    for (var i = 0; i < parts.length; i++) {
        sec = sec * 60 + (parseInt(parts[i], 10) || 0);
    }
    return sec * 1000;
}

function chooseArtworkUrl(pic) {
    if (!pic) return "";
    var s = trimText(pic);
    if (s.indexOf("//") === 0) {
        s = "https:" + s;
    }
    return s;
}

function stripHtml(html) {
    return String(html || "").replace(/<[^>]+>/g, "");
}

function getBilibiliCookie() {
    var store = getStorage();
    if (store) {
        var cached = store.getItem("bili_cookie");
        if (cached) return cached;
    }

    try {
        var res = fetch(BILI_WEB_BASE + "/", {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        });
        var setCookie = (res.header ? res.header("set-cookie") : (res.headers && res.headers["set-cookie"])) || "";
        var m = setCookie.match(/buvid3=([^;]+)/);
        var cookieVal = m ? ("buvid3=" + m[1]) : "buvid3=infoc";
        if (store) {
            try { store.setItem("bili_cookie", cookieVal); } catch (e) {}
        }
        return cookieVal;
    } catch (e) {
        return "buvid3=infoc";
    }
}

function fetchBili(url, options) {
    options = options || {};
    var headers = options.headers || {};
    headers["User-Agent"] = headers["User-Agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    headers["Referer"] = headers["Referer"] || (BILI_WEB_BASE + "/");
    if (!headers["Cookie"]) {
        headers["Cookie"] = getBilibiliCookie();
    }
    options.headers = headers;
    return fetch(url, options);
}

function parseTrackCard(item) {
    if (!item) return null;
    var bvid = item.bvid || (item.id ? String(item.id) : "");
    if (!bvid) return null;

    var title = stripHtml(item.title) || "Không có tiêu đề";
    var artist = trimText(item.author || (item.owner && item.owner.name) || "Bilibili");
    var mid = String(item.mid || (item.owner && item.owner.mid) || "");
    var durationMs = parseDurationMs(item.duration);
    var artworkUrl = chooseArtworkUrl(item.pic);
    var webUrl = item.arcurl || (BILI_WEB_BASE + "/video/" + bvid);

    return {
        kind: "track",
        id: bvid,
        title: title,
        subtitle: artist,
        artist: artist,
        artists: [{ id: mid, title: artist }],
        durationMs: durationMs,
        artworkUrl: artworkUrl,
        webUrl: webUrl
    };
}

function parseUserCard(u) {
    if (!u) return null;
    var mid = u.mid ? String(u.mid) : "";
    if (!mid) return null;

    var name = trimText(u.uname || u.name || "");
    var artworkUrl = chooseArtworkUrl(u.upic || u.face);
    var webUrl = BILI_WEB_BASE + "/space/" + mid;

    return {
        kind: "artist",
        id: mid,
        title: name || "UP chủ",
        subtitle: (u.fans ? (u.fans + " người hâm mộ") : "Nghệ sĩ"),
        artist: name,
        artworkUrl: artworkUrl,
        webUrl: webUrl
    };
}
