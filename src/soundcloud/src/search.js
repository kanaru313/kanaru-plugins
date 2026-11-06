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
    }

    return { items: cards, next: null };
}

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    var next = input.next ? trimText(input.next) : null;

    if (!query && !next) {
        return Response.success({ items: [], next: null });
    }

    // Cache check
    var cacheKey = "s:" + (next ? ("n:" + next) : ("q:" + query));
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Case 1: Pasted SoundCloud link (track or playlist)
    if (isSoundCloudUrl(query) && !next) {
        var resolved = resolveSoundCloudUrl(query);
        if (resolved.error) {
            return Response.error(resolved.error, { kind: resolved.kind || ERROR_KIND.INVALID_RESPONSE });
        }
        cacheSet(cacheKey, resolved, 120000);
        return Response.success(resolved);
    }

    // Case 2: Standard track search with offset pagination
    var offset = next ? (parseInt(next, 10) || 0) : 0;
    var limit = 20;

    var searchUrl = SC_API_BASE + "/search/tracks?q=" + encodeURIComponent(query)
        + "&limit=" + limit
        + "&offset=" + offset;

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
    var result = {
        items: items,
        next: nextToken
    };

    cacheSet(cacheKey, result, 60000);
    return Response.success(result);
}
