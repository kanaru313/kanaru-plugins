var SC_API_BASE = "https://api-v2.soundcloud.com";
var SC_WEB_BASE = "https://soundcloud.com";
var FALLBACK_CLIENT_ID = "39AVoiZVrdvJEMFLH8T0c5WGshQaAPRJ";
var CACHE_PREFIX = "sc:";

var ERROR_KIND = {
    AUTH: "auth",               // Yêu cầu tài khoản SoundCloud Go+ (policy: SNIP / snipped: true)
    UNAVAILABLE: "unavailable", // Track bị xoá, ID sai, hoặc bị chặn theo vùng (policy: BLOCK)
    UNSUPPORTED: "unsupported", // Track không cho phép stream (streamable: false)
    NETWORK: "network",         // Lỗi kết nối mạng, HTTP 5xx hoặc timeout
    INVALID_RESPONSE: "invalidResponse" // Cấu trúc dữ liệu SoundCloud API thay đổi
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

function chooseArtworkUrl(artworkUrl, avatarUrl) {
    var raw = artworkUrl || avatarUrl || "";
    if (!raw) return "";
    var str = String(raw);
    // Replace -large.jpg with -t500x500.jpg for high-resolution 500x500 square artwork
    if (str.indexOf("-large.jpg") !== -1) {
        return str.replace("-large.jpg", "-t500x500.jpg");
    }
    return str;
}

function isSoundCloudUrl(str) {
    return /^https?:\/\/(?:www\.|m\.)?soundcloud\.com(?:\/|$)/i.test(trimText(str));
}

function extractTrackId(input) {
    var text = trimText(input);
    if (!text) return "";

    // Direct numeric ID (e.g. 24715050)
    if (/^\d{5,12}$/.test(text)) {
        return text;
    }

    // URN format (e.g. soundcloud:tracks:24715050)
    var urnMatch = text.match(/soundcloud:tracks:(\d+)/i);
    if (urnMatch && urnMatch[1]) {
        return urnMatch[1];
    }

    return "";
}

function scrapeClientIdFromWeb() {
    try {
        var rsp = fetch(SC_WEB_BASE, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        });
        if (!rsp.ok) return null;
        var html = rsp.text();
        var re = /https:\/\/a-v2\.sndcdn\.com\/assets\/[^\"]+\.js/g;
        var urls = [];
        var m;
        while ((m = re.exec(html)) !== null) {
            urls.push(m[0]);
        }
        // Inspect in reverse order (app/vendor scripts containing client_id are near the end)
        for (var i = urls.length - 1; i >= 0 && i >= urls.length - 4; i--) {
            var jsRsp = fetch(urls[i], {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                }
            });
            if (jsRsp.ok) {
                var jsCode = jsRsp.text();
                var cidMatch = jsCode.match(/client_id[:=]["']([a-zA-Z0-9]{32})["']/);
                if (cidMatch && cidMatch[1]) {
                    return cidMatch[1];
                }
            }
        }
    } catch (e) {}
    return null;
}

function getClientId(forceFresh) {
    // 1. Check user override in settings
    try {
        if (typeof localConfig !== "undefined" && localConfig.getItem) {
            var cfg = trimText(localConfig.getItem("clientId") || "");
            if (cfg) return cfg;
        }
    } catch (e) {}

    // 2. Check storage cache
    if (!forceFresh) {
        var cached = cacheGet("client_id");
        if (cached && typeof cached === "string" && cached.length === 32) {
            return cached;
        }
    }

    // 3. Dynamic scrape from soundcloud.com if forceFresh
    if (forceFresh) {
        var scraped = scrapeClientIdFromWeb();
        if (scraped) {
            cacheSet("client_id", scraped, 24 * 60 * 60 * 1000); // 24 hours
            return scraped;
        }
    }

    // 4. Default fallback client ID
    return FALLBACK_CLIENT_ID;
}

function fetchWithAuth(url, options) {
    options = options || {};
    var headers = options.headers || {};
    headers["User-Agent"] = headers["User-Agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    headers["Referer"] = headers["Referer"] || (SC_WEB_BASE + "/");
    options.headers = headers;

    var clientId = getClientId(false);
    var delimiter = url.indexOf("?") === -1 ? "?" : "&";
    var authedUrl = url + delimiter + "client_id=" + encodeURIComponent(clientId);

    var rsp = fetch(authedUrl, options);
    // If 401 Unauthorized, client_id likely expired -> scrape fresh and retry once
    if (rsp.status === 401) {
        cacheRemove("client_id");
        var freshCid = getClientId(true);
        var retryUrl = url + delimiter + "client_id=" + encodeURIComponent(freshCid);
        rsp = fetch(retryUrl, options);
    }
    return rsp;
}

function parseDurationMs(duration) {
    var n = Number(duration);
    if (isNaN(n) || n <= 0) return 0;
    return Math.round(n);
}

function parseTrackCard(track) {
    if (!track) return null;
    var id = track.id ? String(track.id) : "";
    if (!id) return null;

    var title = trimText(track.title) || "Không có tiêu đề";

    var artist = "";
    if (track.user) {
        artist = trimText(track.user.username || track.user.full_name || "");
    }
    if (!artist) artist = "SoundCloud";

    var durationMs = parseDurationMs(track.duration);
    var artworkUrl = chooseArtworkUrl(track.artwork_url, track.user && track.user.avatar_url);
    var webUrl = track.permalink_url || (SC_WEB_BASE + "/tracks/" + id);

    return {
        id: id,
        title: title,
        artist: artist,
        durationMs: durationMs,
        artworkUrl: artworkUrl,
        webUrl: webUrl
    };
}
