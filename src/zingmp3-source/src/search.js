load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    var next = input.next ? trimText(input.next) : null;

    if (!query && !next) {
        return Response.success({ items: [], next: null });
    }

    var cacheKey = "s:" + (next ? ("n:" + next) : ("q:" + query));
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Case 1: Pasted ZingMP3 song URL or direct 8-character encodeId
    var directId = extractEncodeId(query);
    if (directId && !next) {
        var infoRes = zingGet("/song/get/info", { id: directId });
        if (infoRes.data && infoRes.data.encodeId) {
            var card = parseTrackCard(infoRes.data);
            var directResult = { items: card ? [card] : [], next: null };
            cacheSet(cacheKey, directResult, 120000);
            return Response.success(directResult);
        }
    }

    // Case 2: General song search
    var page = next ? (parseInt(next, 10) || 1) : 1;
    var searchRes = zingGet("/search", { q: query, type: "song", page: page, count: 20 });
    if (searchRes.failure) {
        return searchRes.failure;
    }

    var rawItems = (searchRes.data && Array.isArray(searchRes.data.items)) ? searchRes.data.items : [];
    var items = [];
    var seen = {};

    for (var i = 0; i < rawItems.length; i++) {
        var c = parseTrackCard(rawItems[i]);
        if (c && !seen[c.id]) {
            seen[c.id] = true;
            items.push(c);
        }
    }

    var nextToken = (rawItems.length >= 20) ? String(page + 1) : null;
    var result = {
        items: items,
        next: nextToken
    };

    cacheSet(cacheKey, result, 60000);
    return Response.success(result);
}
