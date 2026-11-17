load("common.js");

function execute(input) {
    input = input || {};
    var rawUrl = (typeof input === "string") ? input : (input.url || input.id || "");
    var pageUrl = normalizeBandcampUrl(rawUrl);

    if (!pageUrl.startsWith("http") || pageUrl.indexOf("bandcamp.com") === -1) {
        return Response.error("Đường dẫn Bandcamp không hợp lệ", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "res:" + pageUrl;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var fetchWrap = bandcampGet(pageUrl);
    if (fetchWrap.failure) return fetchWrap.failure;

    var html = "";
    try {
        html = fetchWrap.res.text();
    } catch (e) {
        return Response.error("Không thể đọc phản hồi HTML từ Bandcamp", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var tralbum = extractTralbumFromHtml(html);
    if (!tralbum) {
        return Response.error("Không tìm thấy thông tin bài hát / album (data-tralbum) trên trang này", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var current = tralbum.current || {};
    var title = decodeHtml(current.title || "Bandcamp Track");
    var artist = decodeHtml(tralbum.artist || "Bandcamp Artist");
    var artworkUrl = tralbum.art_id ? ("https://f4.bcbits.com/img/a" + tralbum.art_id + "_10.jpg") : "";
    var tracks = Array.isArray(tralbum.trackinfo) ? tralbum.trackinfo : [];

    var isAlbum = pageUrl.indexOf("/album/") !== -1 || tracks.length > 1;
    var resolvedCard;

    if (isAlbum) {
        resolvedCard = {
            kind: "album",
            id: pageUrl,
            title: title,
            subtitle: artist + " (" + tracks.length + " bài hát)",
            artist: artist,
            artists: [{ id: "", title: artist }],
            artworkUrl: artworkUrl,
            webUrl: pageUrl
        };
    } else {
        var t0 = tracks[0] || {};
        var durSec = t0.duration || 0;
        resolvedCard = {
            kind: "track",
            id: pageUrl,
            title: title,
            subtitle: artist,
            artist: artist,
            artists: [{ id: "", title: artist }],
            durationMs: Math.round(durSec * 1000),
            artworkUrl: artworkUrl,
            webUrl: pageUrl
        };
    }

    cacheSet(cacheKey, resolvedCard, 300000);
    return Response.success(resolvedCard);
}
