load("common.js");

function execute(input) {
    input = input || {};
    var rawUrl = (typeof input === "string") ? input : (input.id || input.url || "");
    var pageUrl = normalizeBandcampUrl(rawUrl);

    if (!pageUrl.startsWith("http")) {
        return Response.error("Thiếu đường dẫn album Bandcamp hợp lệ", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "album:" + pageUrl;
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
        return Response.error("Không thể đọc nội dung album Bandcamp", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var tralbum = extractTralbumFromHtml(html);
    if (!tralbum) {
        return Response.error("Không tìm thấy thông tin album (data-tralbum)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var current = tralbum.current || {};
    var albumTitle = decodeHtml(current.title || "Bandcamp Album");
    var artistName = decodeHtml(tralbum.artist || "Bandcamp Artist");
    var artworkUrl = tralbum.art_id ? ("https://f4.bcbits.com/img/a" + tralbum.art_id + "_10.jpg") : "";
    var rawTracks = Array.isArray(tralbum.trackinfo) ? tralbum.trackinfo : [];
    var items = [];

    // Extract host for title_link
    var hostMatch = pageUrl.match(/^(https?:\/\/[^/]+)/);
    var hostBase = hostMatch ? hostMatch[1] : "";

    for (var i = 0; i < rawTracks.length; i++) {
        var t = rawTracks[i];
        if (!t) continue;
        var tTitle = decodeHtml(t.title || ("Track " + (i + 1)));
        var tUrl = t.title_link ? (hostBase + t.title_link) : (pageUrl + "#" + t.id);

        items.push({
            kind: "track",
            id: pageUrl + "#" + t.id,
            title: tTitle,
            subtitle: artistName,
            artist: artistName,
            artists: [{ id: "", title: artistName }],
            durationMs: Math.round((t.duration || 0) * 1000),
            artworkUrl: artworkUrl,
            webUrl: tUrl
        });
    }

    var result = {
        kind: "album",
        id: pageUrl,
        title: albumTitle,
        artist: artistName,
        artists: [{ id: "", title: artistName }],
        artworkUrl: artworkUrl,
        items: items
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
