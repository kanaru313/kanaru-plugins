load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText((typeof input === "string") ? input : (input.query || ""));
    var next = input.next || "";
    var filter = input.filter || "all";

    if (!query) {
        return Response.error("Vui lòng nhập từ khóa tìm kiếm Jamendo", { kind: ERROR_KIND.UNAVAILABLE });
    }

    // Direct URL check
    var parsed = extractJamendoId(query);
    if (parsed.id && (query.startsWith("http") || query.startsWith("jamen"))) {
        var directCard = {
            kind: parsed.type || "track",
            id: parsed.id,
            title: "Jamendo " + (parsed.type || "Track") + " #" + parsed.id,
            subtitle: "Jamendo Music",
            artist: "Jamendo Music",
            artists: [{ id: "", title: "Jamendo Music" }],
            artworkUrl: "",
            webUrl: query
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

    var params = {
        namesearch: query,
        limit: 20,
        offset: offset,
        order: "popularity_total",
        audioformat: getAudioQuality()
    };

    if (filter && filter !== "all") {
        params.fuzzytags = filter;
    }

    var fetchWrap = jamendoGet("tracks/", params);
    if (fetchWrap.failure) return fetchWrap.failure;

    var rawTracks = (fetchWrap.json && Array.isArray(fetchWrap.json.results)) ? fetchWrap.json.results : [];
    var items = [];
    var seen = {};

    for (var i = 0; i < rawTracks.length; i++) {
        var card = parseJamendoTrack(rawTracks[i]);
        if (card && !seen[card.id]) {
            seen[card.id] = true;
            items.push(card);
        }
    }

    var nextCursor = rawTracks.length >= 20 ? String(offset + 20) : null;
    var pageResult = {
        filters: [
            { id: "all", title: "Tất cả bài hát" },
            { id: "rock", title: "Rock" },
            { id: "pop", title: "Pop" },
            { id: "electronic", title: "Electronic" },
            { id: "jazz", title: "Jazz" },
            { id: "acoustic", title: "Acoustic / Indie" }
        ],
        sections: [
            { title: "Bài hát", layout: "list", items: items }
        ],
        items: items,
        next: nextCursor
    };

    cacheSet(cacheKey, pageResult, 60000);
    return Response.success(pageResult);
}
