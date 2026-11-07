load("common.js");

function resolveSoundCloudUrl(url) {
    var resolveUrl = SC_API_BASE + "/resolve?url=" + encodeURIComponent(url);
    var rsp = fetchWithAuth(resolveUrl);

    if (rsp.status === 404) {
        return { error: "Không tìm thấy nội dung SoundCloud từ đường link này", kind: ERROR_KIND.UNAVAILABLE };
    }
    if (!rsp.ok) {
        return { error: "Không thể giải mã liên kết SoundCloud (HTTP " + rsp.status + ")", kind: ERROR_KIND.NETWORK };
    }

    var json = safeJsonParse(rsp.text());
    if (!json) {
        return { error: "Phản hồi giải mã link SoundCloud không hợp lệ", kind: ERROR_KIND.INVALID_RESPONSE };
    }

    var cards = [];
    var seen = {};

    if (json.kind === "track") {
        var card = parseTrackCard(json);
        if (card) cards.push(card);
    } else if (json.kind === "playlist" && Array.isArray(json.tracks)) {
        for (var i = 0; i < json.tracks.length; i++) {
            var tCard = parseTrackCard(json.tracks[i]);
            if (tCard && !seen[tCard.id]) {
                seen[tCard.id] = true;
                cards.push(tCard);
            }
        }
    } else if (json.kind === "user") {
        var uCard = parseUserCard(json);
        if (uCard) cards.push(uCard);
    }

    return {
        filters: [],
        sections: [
            { title: "Kết quả liên kết", layout: "list", items: cards }
        ],
        items: cards,
        next: null
    };
}

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    var filter = trimText(input.filter || "");
    var next = input.next ? trimText(input.next) : null;

    if (!query && !next) {
        return Response.success({ filters: [], sections: [], items: [], next: null });
    }

    var filters = [
        { title: "Tracks", input: "tracks" },
        { title: "Playlists & Albums", input: "playlists" },
        { title: "Nghệ sĩ", input: "users" }
    ];

    // Cache check
    var cacheKey = "s:" + (next ? ("n:" + next) : ("q:" + query + ":f:" + filter));
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Case 1: Pasted SoundCloud link
    if (isSoundCloudUrl(query) && !next) {
        var resolved = resolveSoundCloudUrl(query);
        if (resolved.error) {
            return Response.error(resolved.error, { kind: resolved.kind || ERROR_KIND.INVALID_RESPONSE });
        }
        cacheSet(cacheKey, resolved, 120000);
        return Response.success(resolved);
    }

    var offset = next ? (parseInt(next, 10) || 0) : 0;
    var limit = 20;

    // Filter-specific searches
    if (filter === "playlists") {
        var plUrl = SC_API_BASE + "/search/playlists?q=" + encodeURIComponent(query) + "&limit=" + limit + "&offset=" + offset;
        var plRsp = fetchWithAuth(plUrl);
        var plJson = plRsp.ok ? safeJsonParse(plRsp.text()) : null;
        var plItems = [];
        if (plJson && Array.isArray(plJson.collection)) {
            for (var p = 0; p < plJson.collection.length; p++) {
                var pCard = parsePlaylistCard(plJson.collection[p]);
                if (pCard) plItems.push(pCard);
            }
        }
        var plNext = (plJson && plJson.collection && plJson.collection.length >= limit) ? String(offset + limit) : null;
        var plPage = {
            filters: filters,
            sections: [{ title: "Playlists & Albums", layout: "shelf", items: plItems }],
            items: plItems,
            next: plNext
        };
        cacheSet(cacheKey, plPage, 60000);
        return Response.success(plPage);
    }

    if (filter === "users") {
        var uUrl = SC_API_BASE + "/search/users?q=" + encodeURIComponent(query) + "&limit=" + limit + "&offset=" + offset;
        var uRsp = fetchWithAuth(uUrl);
        var uJson = uRsp.ok ? safeJsonParse(uRsp.text()) : null;
        var uItems = [];
        if (uJson && Array.isArray(uJson.collection)) {
            for (var u = 0; u < uJson.collection.length; u++) {
                var uC = parseUserCard(uJson.collection[u]);
                if (uC) uItems.push(uC);
            }
        }
        var uNext = (uJson && uJson.collection && uJson.collection.length >= limit) ? String(offset + limit) : null;
        var uPage = {
            filters: filters,
            sections: [{ title: "Nghệ sĩ", layout: "list", items: uItems }],
            items: uItems,
            next: uNext
        };
        cacheSet(cacheKey, uPage, 60000);
        return Response.success(uPage);
    }

    // Default: Track search with multi-section layout
    var searchUrl = SC_API_BASE + "/search/tracks?q=" + encodeURIComponent(query) + "&limit=" + limit + "&offset=" + offset;
    var rsp = fetchWithAuth(searchUrl);

    if (rsp.status >= 500) {
        return Response.error("Máy chủ SoundCloud gặp sự cố tạm thời (HTTP " + rsp.status + ")", { kind: ERROR_KIND.NETWORK });
    }
    if (!rsp.ok) {
        return Response.error("Không đọc được kết quả tìm kiếm từ SoundCloud (HTTP " + rsp.status + ")", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var json = safeJsonParse(rsp.text());
    if (!json || !Array.isArray(json.collection)) {
        return Response.error("Định dạng dữ liệu tìm kiếm SoundCloud không đúng", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var items = [];
    var seen = {};
    for (var i = 0; i < json.collection.length; i++) {
        var item = json.collection[i];
        var c = parseTrackCard(item);
        if (c && !seen[c.id]) {
            seen[c.id] = true;
            items.push(c);
        }
    }

    var nextToken = (json.collection.length >= limit) ? String(offset + limit) : null;

    var sections = [];
    if (items.length > 0) {
        sections.push({
            title: "Kết quả hàng đầu",
            layout: "top",
            items: [items[0]]
        });
        sections.push({
            title: "Bài hát nổi bật",
            layout: "list",
            items: items.slice(1),
            more: { filter: "tracks" }
        });
    }

    var result = {
        filters: filters,
        sections: sections,
        items: items,
        next: nextToken
    };

    cacheSet(cacheKey, result, 60000);
    return Response.success(result);
}
