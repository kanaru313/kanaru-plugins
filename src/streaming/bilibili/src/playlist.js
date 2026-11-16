load("common.js");

function execute(input) {
    input = input || {};
    var id = extractBvid(input.id || "");
    if (!id) {
        return Response.error("Thiếu mã video Bilibili (id)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "pl:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var viewUrl = BILI_API_BASE + "/x/web-interface/view?bvid=" + encodeURIComponent(id);
    var rsp = fetchBili(viewUrl);

    if (rsp.status === 404) {
        return Response.error("Không tìm thấy video/playlist trên Bilibili", { kind: ERROR_KIND.UNAVAILABLE });
    }
    if (!rsp.ok) {
        return Response.error("Không tải được thông tin từ Bilibili (HTTP " + rsp.status + ")", { kind: ERROR_KIND.NETWORK });
    }

    var json = safeJsonParse(rsp.text());
    if (!json || json.code !== 0 || !json.data) {
        return Response.error((json && json.message) || "Dữ liệu Bilibili không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var vData = json.data;
    var title = stripHtml(vData.title || "Playlist");
    var artist = trimText((vData.owner && vData.owner.name) || "Bilibili");
    var artworkUrl = chooseArtworkUrl(vData.pic);
    var webUrl = BILI_WEB_BASE + "/video/" + id;
    var description = trimText(vData.desc || "");

    var tracks = [];
    var pages = Array.isArray(vData.pages) ? vData.pages : [];
    if (pages.length > 1) {
        for (var i = 0; i < pages.length; i++) {
            var p = pages[i];
            tracks.push({
                kind: "track",
                id: id + "?p=" + p.page,
                title: stripHtml(p.part || (title + " - P" + p.page)),
                subtitle: artist,
                artist: artist,
                artists: [{ id: String((vData.owner && vData.owner.mid) || ""), title: artist }],
                durationMs: parseDurationMs(p.duration),
                artworkUrl: artworkUrl,
                webUrl: webUrl + "?p=" + p.page
            });
        }
    } else {
        var single = parseTrackCard(vData);
        if (single) tracks.push(single);
    }

    var result = {
        info: {
            title: title,
            subtitle: artist + " · " + (tracks.length + " phần / bài hát"),
            artworkUrl: artworkUrl,
            description: description,
            webUrl: webUrl,
            artists: [{ id: String((vData.owner && vData.owner.mid) || ""), title: artist }]
        },
        tracks: tracks,
        next: null,
        sections: []
    };

    cacheSet(cacheKey, result, 120000);
    return Response.success(result);
}
