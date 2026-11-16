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

    var appName = getAppName();
    var trackUrl = AUDIUS_API_BASE + "/v1/tracks/" + encodeURIComponent(id) + "?app_name=" + encodeURIComponent(appName);
    var trackRsp = fetch(trackUrl);

    var genre = "";
    if (trackRsp.ok) {
        var tJson = safeJsonParse(trackRsp.text());
        var tData = tJson && tJson.data ? (Array.isArray(tJson.data) ? tJson.data[0] : tJson.data) : null;
        if (tData && tData.genre) {
            genre = tData.genre;
        }
    }

    var trendUrl = AUDIUS_API_BASE + "/v1/tracks/trending?limit=20&app_name=" + encodeURIComponent(appName);
    if (genre) {
        trendUrl += "&genre=" + encodeURIComponent(genre);
    }

    var rsp = fetch(trendUrl);
    if (!rsp.ok) {
        return Response.error("Không lấy được bài hát liên quan từ Audius (" + rsp.status + ")", { kind: ERROR_KIND.NETWORK });
    }

    var json = safeJsonParse(rsp.text());
    var rawTracks = json && Array.isArray(json.data) ? json.data : [];
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
