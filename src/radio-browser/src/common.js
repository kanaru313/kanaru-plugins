var RADIO_API_BASE = "https://de1.api.radio-browser.info";
var CACHE_PREFIX = "rb:";

var ERROR_KIND = {
    AUTH: "auth",               // Đài phát yêu cầu mật khẩu hoặc token riêng
    UNAVAILABLE: "unavailable", // Đài phát không tồn tại hoặc offline
    UNSUPPORTED: "unsupported", // Định dạng audio không hỗ trợ
    NETWORK: "network",         // Không kết nối được tới server Radio Browser
    INVALID_RESPONSE: "invalidResponse" // Cấu trúc JSON không đúng
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

function parseRadioCard(station) {
    if (!station) return null;
    var id = station.stationuuid || station.changeuuid || "";
    if (!id && station.url) {
        id = station.url;
    }
    if (!id) return null;

    var title = trimText(station.name) || "Đài phát thanh";

    var artistParts = [];
    if (station.country) artistParts.push(trimText(station.country));
    if (station.tags) {
        var firstTag = trimText(station.tags.split(",")[0]);
        if (firstTag) artistParts.push(firstTag);
    }
    if (station.codec) artistParts.push(station.codec.toUpperCase());
    var artist = artistParts.join(" • ") || "Radio";

    var artworkUrl = trimText(station.favicon || "");
    var webUrl = station.homepage || ("https://www.radio-browser.info/history/" + id);

    return {
        id: id,
        title: title,
        artist: artist,
        durationMs: 0, // Continuous live stream has 0 duration
        artworkUrl: artworkUrl,
        webUrl: webUrl
    };
}
