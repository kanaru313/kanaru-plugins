load("common.js");

function execute(input) {
    input = input || {};
    var id = trimText(input.id || "");
    if (!id) {
        return Response.error("Thiếu mã nghệ sĩ/UP chủ (id)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "art:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var searchUrl = BILI_API_BASE + "/x/web-interface/search/type?search_type=video&keyword=" + encodeURIComponent(id) + "&page=1&page_size=20";
    var rsp = fetchBili(searchUrl);

    if (!rsp.ok) {
        return Response.error("Không tải được thông tin nghệ sĩ Bilibili", { kind: ERROR_KIND.NETWORK });
    }

    var json = safeJsonParse(rsp.text());
    var tracks = [];
    var raw = json && json.data && Array.isArray(json.data.result) ? json.data.result : [];
    for (var i = 0; i < raw.length; i++) {
        var card = parseTrackCard(raw[i]);
        if (card) tracks.push(card);
    }

    var name = tracks.length > 0 ? tracks[0].artist : id;
    var artworkUrl = tracks.length > 0 ? tracks[0].artworkUrl : "";
    var webUrl = /^\d+$/.test(id) ? (BILI_WEB_BASE + "/space/" + id) : (BILI_WEB_BASE + "/search?keyword=" + encodeURIComponent(id));

    var result = {
        info: {
            title: name,
            subtitle: "UP chủ trên Bilibili",
            artworkUrl: artworkUrl,
            description: "",
            webUrl: webUrl
        },
        sections: [
            {
                title: "Video & Nhạc nổi bật",
                layout: "list",
                items: tracks
            }
        ]
    };

    cacheSet(cacheKey, result, 120000);
    return Response.success(result);
}
