load("common.js");

function execute(input) {
    input = input || {};
    var id = trimText(input.id || "");
    if (!id) {
        return Response.error("Thiếu mã danh sách phát (id)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "pl:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var playlistUrl = YT_BASE + "/playlist?list=" + encodeURIComponent(id) + "&hl=" + YT_PREFERRED_HL + "&gl=" + YT_PREFERRED_GL;
    var rsp = fetch(playlistUrl, { headers: buildPreferredHeaders() });
    if (!rsp.ok) {
        return Response.error("Không tải được danh sách phát YouTube (" + rsp.status + ")", { kind: ERROR_KIND.NETWORK });
    }

    var initialData = extractInitialDataFromHtml(rsp.text());
    if (!initialData) {
        return Response.error("Dữ liệu danh sách phát YouTube không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    if (initialData.alerts && initialData.alerts.length) {
        for (var a = 0; a < initialData.alerts.length; a++) {
            var alert = initialData.alerts[a].alertRenderer;
            if (alert && alert.type === "ERROR") {
                return Response.error(getTextValue(alert.text) || "Danh sách phát không tồn tại", { kind: ERROR_KIND.UNAVAILABLE });
            }
        }
    }

    var mf = initialData.microformat && initialData.microformat.microformatDataRenderer ? initialData.microformat.microformatDataRenderer : null;
    var title = (mf && mf.title) || "Danh sách phát";
    var description = (mf && mf.description) || "";
    var thumbnails = mf && mf.thumbnail && mf.thumbnail.thumbnails ? mf.thumbnail.thumbnails : null;
    var artworkUrl = chooseArtworkUrl(thumbnails, id);

    var cards = parseCardsFromInitialData(initialData);
    var tracks = cards.items.filter(function(x) { return x.kind === "track"; });

    var result = {
        info: {
            title: title,
            subtitle: tracks.length ? (tracks.length + " bài hát") : "Danh sách phát YouTube",
            artworkUrl: artworkUrl,
            description: description,
            webUrl: YT_BASE + "/playlist?list=" + id,
            artists: []
        },
        tracks: tracks,
        next: cards.next,
        sections: []
    };

    cacheSet(cacheKey, result, 120000);
    return Response.success(result);
}
