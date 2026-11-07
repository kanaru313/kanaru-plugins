load("common.js");

function execute(input) {
    input = input || {};
    var id = extractBvid(input.id || "");
    if (!id) {
        return Response.error("Thiếu mã video Bilibili (id)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "rel:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var relUrl = BILI_API_BASE + "/x/web-interface/archive/related?bvid=" + encodeURIComponent(id);
    var rsp = fetchBili(relUrl);

    if (!rsp.ok) {
        return Response.error("Không lấy được video liên quan từ Bilibili (" + rsp.status + ")", { kind: ERROR_KIND.NETWORK });
    }

    var json = safeJsonParse(rsp.text());
    var raw = json && json.data && Array.isArray(json.data) ? json.data : [];
    var items = [];
    var seen = {};

    for (var i = 0; i < raw.length; i++) {
        var card = parseTrackCard(raw[i]);
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
