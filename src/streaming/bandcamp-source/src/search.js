load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText((typeof input === "string") ? input : (input.query || ""));
    var next = input.next || "";
    var filter = input.filter || "all";

    if (!query) {
        return Response.error("Vui lòng nhập từ khóa tìm kiếm Bandcamp", { kind: ERROR_KIND.UNAVAILABLE });
    }

    // Direct link check
    if (query.indexOf("bandcamp.com") !== -1) {
        var directUrl = normalizeBandcampUrl(query);
        var directCard = {
            kind: directUrl.indexOf("/album/") !== -1 ? "album" : "track",
            id: directUrl,
            title: "Bandcamp Audio",
            subtitle: "Bandcamp",
            artist: "Bandcamp",
            artists: [{ id: "", title: "Bandcamp" }],
            artworkUrl: "",
            webUrl: directUrl
        };
        return Response.success({
            filters: [],
            sections: [
                { title: "Liên kết trực tiếp", layout: "list", items: [directCard] }
            ],
            items: [directCard],
            next: null
        });
    }

    var offset = next ? (parseInt(next, 10) || 0) : 0;
    var cacheKey = "search:" + query + ":" + filter + ":" + offset;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var searchUrl = "https://bandcamp.com/api/fuzzysearch/2/app_autocomplete?q=" + encodeURIComponent(query);
    var fetchWrap = bandcampGet(searchUrl);
    if (fetchWrap.failure) return fetchWrap.failure;

    var json = null;
    try {
        json = fetchWrap.res.json();
    } catch (e) {
        return Response.error("Phản hồi tìm kiếm Bandcamp không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var rawResults = (json && Array.isArray(json.results)) ? json.results : [];
    var filtered = [];

    for (var i = 0; i < rawResults.length; i++) {
        var item = rawResults[i];
        if (!item || !item.url) continue;

        if (filter === "track" && item.type !== "t") continue;
        if (filter === "album" && item.type !== "a") continue;
        if (filter === "artist" && item.type !== "b") continue;

        var card = parseBandcampSearchItem(item);
        if (card) filtered.push(card);
    }

    var pageSize = 20;
    var pagedItems = filtered.slice(offset, offset + pageSize);
    var nextCursor = (offset + pageSize < filtered.length) ? String(offset + pageSize) : null;

    var pageResult = {
        filters: [
            { id: "all", title: "Tất cả" },
            { id: "track", title: "Bài hát (Tracks)" },
            { id: "album", title: "Album" },
            { id: "artist", title: "Nghệ sĩ / Nhãn đĩa" }
        ],
        sections: [
            { title: "Kết quả Bandcamp", layout: "list", items: pagedItems }
        ],
        items: pagedItems,
        next: nextCursor
    };

    cacheSet(cacheKey, pageResult, 60000);
    return Response.success(pageResult);
}
