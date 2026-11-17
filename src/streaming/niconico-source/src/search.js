load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText((typeof input === "string") ? input : (input.query || ""));
    var next = input.next || "";
    var filter = input.filter || "all";

    if (!query) {
        return Response.error("Vui lòng nhập từ khóa tìm kiếm NicoNico", { kind: ERROR_KIND.UNAVAILABLE });
    }

    // Direct ID or link paste
    var directId = extractNicoId(query);
    if (directId && (query.startsWith("http") || query.startsWith("sm") || query.startsWith("so"))) {
        var directCard = {
            kind: "track",
            id: directId,
            title: "NicoNico Video #" + directId,
            subtitle: "NicoNico Douga",
            artist: "NicoNico Douga",
            artists: [{ id: "", title: "NicoNico Douga" }],
            artworkUrl: "https://nicovideo.cdn.nimg.jp/thumbnails/" + directId.replace(/^[a-z]+/, "") + "/" + directId.replace(/^[a-z]+/, ""),
            webUrl: "https://www.nicovideo.jp/watch/" + directId
        };
        return Response.success({
            filters: [],
            sections: [
                { title: "Video từ liên kết", layout: "list", items: [directCard] }
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

    var url = "https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search?q=" + encodeURIComponent(query) +
        "&targets=title,description,tags" +
        "&fields=contentId,title,lengthSeconds,thumbnailUrl,viewCounter,categoryTags,tags" +
        "&_sort=-viewCounter&_limit=20&_offset=" + offset;

    if (filter === "vocaloid") {
        url += "&filters[tags][0]=VOCALOID";
    } else if (filter === "utaite") {
        url += "&filters[tags][0]=" + encodeURIComponent("歌ってみた");
    } else if (filter === "touhou") {
        url += "&filters[tags][0]=" + encodeURIComponent("東方");
    } else if (filter === "music") {
        url += "&filters[categoryTags][0]=" + encodeURIComponent("音楽");
    }

    var fetchWrap = nicoGet(url);
    if (fetchWrap.failure) return fetchWrap.failure;

    var json = null;
    try {
        json = fetchWrap.res.json();
    } catch (e) {
        return Response.error("Phản hồi tìm kiếm NicoNico không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var rawData = (json && Array.isArray(json.data)) ? json.data : [];
    var items = [];
    var seen = {};

    for (var i = 0; i < rawData.length; i++) {
        var card = parseNicoSnapshotItem(rawData[i]);
        if (card && !seen[card.id]) {
            seen[card.id] = true;
            items.push(card);
        }
    }

    var nextCursor = rawData.length >= 20 ? String(offset + 20) : null;
    var pageResult = {
        filters: [
            { id: "all", title: "Tất cả" },
            { id: "vocaloid", title: "VOCALOID" },
            { id: "utaite", title: "Utaite (歌ってみた)" },
            { id: "touhou", title: "Touhou Project (東方)" },
            { id: "music", title: "Âm nhạc chung" }
        ],
        sections: [
            { title: "Tác phẩm & Bài hát", layout: "list", items: items }
        ],
        items: items,
        next: nextCursor
    };

    cacheSet(cacheKey, pageResult, 60000);
    return Response.success(pageResult);
}
