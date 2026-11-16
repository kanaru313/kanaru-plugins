load("common.js");

function execute(input) {
    input = input || {};
    var id = trimText(input.id || "");
    if (!id) {
        return Response.error("Thiếu mã nghệ sĩ (id)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "art:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var searchUrl = YT_BASE + "/results?search_query=" + encodeURIComponent(id) + "&hl=" + YT_PREFERRED_HL + "&gl=" + YT_PREFERRED_GL;
    var rsp = fetch(searchUrl, { headers: buildPreferredHeaders() });
    if (!rsp.ok) {
        return Response.error("Không tải được trang nghệ sĩ YouTube (" + rsp.status + ")", { kind: ERROR_KIND.NETWORK });
    }

    var initialData = extractInitialDataFromHtml(rsp.text());
    var parsed = initialData ? parseCardsFromInitialData(initialData) : { items: [], next: null };

    var trackItems = [];
    var playlistItems = [];
    for (var i = 0; i < parsed.items.length; i++) {
        var it = parsed.items[i];
        if (it.kind === "track") trackItems.push(it);
        else if (it.kind === "playlist") playlistItems.push(it);
    }

    var title = id;
    var artworkUrl = "";
    if (trackItems.length > 0) {
        title = trackItems[0].artist || id;
        artworkUrl = trackItems[0].artworkUrl;
    }

    var sections = [];
    if (trackItems.length > 0) {
        sections.push({
            title: "Bài hát & Video nổi bật",
            layout: "list",
            items: trackItems.slice(0, 20)
        });
    }
    if (playlistItems.length > 0) {
        sections.push({
            title: "Danh sách phát",
            layout: "shelf",
            items: playlistItems.slice(0, 10)
        });
    }

    var result = {
        info: {
            title: title,
            subtitle: "Nghệ sĩ trên YouTube",
            artworkUrl: artworkUrl,
            description: "",
            webUrl: YT_BASE + (/^UC/.test(id) ? ("/channel/" + id) : ("/@" + id.replace(/^@/, "")))
        },
        sections: sections
    };

    cacheSet(cacheKey, result, 120000);
    return Response.success(result);
}
