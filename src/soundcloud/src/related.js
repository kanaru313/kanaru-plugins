load("common.js");

function execute(input) {
    input = input || {};
    var id = extractTrackId(input.id || "");
    if (!id) {
        return Response.error("Thiếu mã bài hát (id)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "rel:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var relUrl = SC_API_BASE + "/tracks/" + encodeURIComponent(id) + "/related?limit=20";
    var rsp = fetchWithAuth(relUrl);

    if (!rsp.ok) {
        return Response.error("Không lấy được bài hát liên quan từ SoundCloud (" + rsp.status + ")", { kind: ERROR_KIND.NETWORK });
    }

    var json = safeJsonParse(rsp.text());
    var rawTracks = json && Array.isArray(json.collection) ? json.collection : [];
    var items = [];
    var seen = {};

    for (var i = 0; i < rawTracks.length; i++) {
        var card = parseTrackCard(rawTracks[i]);
        if (card && card.id !== id && !seen[card.id]) {
            seen[card.id] = true;
            items.push(card);
        }
    }

    var result = {
        items: items,
        next: null
    };

    cacheSet(cacheKey, result, 120000);
    return Response.success(result);
}
