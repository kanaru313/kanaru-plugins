load("common.js");

function execute(input) {
    input = input || {};
    var rawId = (typeof input === "string") ? input : (input.id || input.seriesId || "");
    var id = trimText(rawId).replace(/^series\//, "").replace(/\D/g, "");

    if (!id) {
        return Response.error("Thiếu mã Series/Album NicoNico", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "series:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var url = "https://nvapi.nicovideo.jp/v2/series/" + encodeURIComponent(id);
    var fetchWrap = nicoGet(url);
    if (fetchWrap.failure) return fetchWrap.failure;

    var json = null;
    try {
        json = fetchWrap.res.json();
    } catch (e) {
        return Response.error("Phản hồi Series NicoNico không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var detail = (json && json.data && json.data.detail) ? json.data.detail : {};
    var title = decodeHtml(detail.title || "NicoNico Series");
    var creator = decodeHtml((detail.owner && detail.owner.user && detail.owner.user.nickname) ? detail.owner.user.nickname : "NicoNico Producer");
    var artworkUrl = detail.thumbnailUrl || "";
    var entries = (json && json.data && Array.isArray(json.data.items)) ? json.data.items : [];
    var items = [];

    for (var i = 0; i < entries.length; i++) {
        var v = entries[i].video;
        if (!v || !v.id) continue;
        items.push({
            kind: "track",
            id: v.id,
            title: decodeHtml(v.title || v.id),
            subtitle: creator,
            artist: creator,
            artists: [{ id: "", title: creator }],
            durationMs: (parseInt(v.duration || "0", 10) || 0) * 1000,
            artworkUrl: (v.thumbnail && v.thumbnail.url) ? v.thumbnail.url : artworkUrl,
            webUrl: "https://www.nicovideo.jp/watch/" + v.id
        });
    }

    var result = {
        kind: "album",
        id: id,
        title: title,
        artist: creator,
        artists: [{ id: "", title: creator }],
        artworkUrl: artworkUrl,
        items: items
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
