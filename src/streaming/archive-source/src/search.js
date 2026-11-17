load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText((typeof input === "string") ? input : (input.query || ""));
    var next = input.next || "";
    var filter = input.filter || "all";

    if (!query) {
        return Response.error("Vui lòng nhập từ khóa tìm kiếm Internet Archive", { kind: ERROR_KIND.UNAVAILABLE });
    }

    // Direct URL paste
    var parsedId = extractArchiveId(query);
    if (parsedId.identifier && (query.startsWith("http") || query.startsWith("archive.org"))) {
        var directCard = {
            kind: "track",
            id: parsedId.identifier + (parsedId.filename ? (":" + parsedId.filename) : ""),
            title: parsedId.filename || parsedId.identifier,
            subtitle: "Internet Archive",
            artist: "Internet Archive",
            artists: [{ id: "", title: "Internet Archive" }],
            artworkUrl: "https://archive.org/services/img/" + encodeURIComponent(parsedId.identifier),
            webUrl: "https://archive.org/details/" + encodeURIComponent(parsedId.identifier)
        };
        return Response.success({
            filters: [],
            sections: [
                { title: "Bản ghi từ liên kết", layout: "list", items: [directCard] }
            ],
            items: [directCard],
            next: null
        });
    }

    var page = next ? (parseInt(next, 10) || 1) : 1;
    var cacheKey = "search:" + query + ":" + filter + ":" + page;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var baseQuery = "mediatype:(audio) AND format:(MP3)";
    if (filter === "etree") {
        baseQuery += " AND collection:(etree)";
    } else if (filter === "78rpm") {
        baseQuery += " AND collection:(georgeblood OR 78rpm)";
    } else if (filter === "audio_bookspoetry") {
        baseQuery += " AND collection:(audio_bookspoetry)";
    }

    // Sanitize query words
    var safeQuery = query.replace(/[^\w\s\u00C0-\u024F\u1EA0-\u1EF9]/gi, " ").trim();
    var fullQuery = baseQuery + " AND (" + (safeQuery || query) + ")";

    var searchUrl = "https://archive.org/advancedsearch.php?q=" + encodeURIComponent(fullQuery) +
        "&fl[]=identifier,title,creator,year,downloads" +
        "&sort[]=downloads+desc&rows=20&page=" + page + "&output=json";

    var resWrap = archiveGet(searchUrl);
    if (resWrap.failure) return resWrap.failure;

    var json = null;
    try {
        json = resWrap.res.json();
    } catch (e) {
        return Response.error("Internet Archive phản hồi tìm kiếm không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var docs = (json && json.response && Array.isArray(json.response.docs)) ? json.response.docs : [];
    var items = [];
    var seen = {};

    for (var i = 0; i < docs.length; i++) {
        var card = parseArchiveDoc(docs[i]);
        if (card && !seen[card.id]) {
            seen[card.id] = true;
            items.push(card);
        }
    }

    var nextCursor = docs.length >= 20 ? String(page + 1) : null;
    var pageResult = {
        filters: [
            { id: "all", title: "Tất cả bản ghi" },
            { id: "etree", title: "Live Concert (etree)" },
            { id: "78rpm", title: "Đĩa than 78 vòng" },
            { id: "audio_bookspoetry", title: "Sách nói" }
        ],
        sections: [
            { title: "Bản ghi âm", layout: "list", items: items }
        ],
        items: items,
        next: nextCursor
    };

    cacheSet(cacheKey, pageResult, 60000);
    return Response.success(pageResult);
}
