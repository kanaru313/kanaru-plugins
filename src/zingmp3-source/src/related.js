load("common.js");

function execute(input) {
    input = input || {};
    var id = extractEncodeId(input.id || "");
    if (!id) {
        return Response.error("Thiếu mã bài hát (id)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "rel:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var infoRes = zingGet("/song/get/info", { id: id });
    var artistName = "";
    if (!infoRes.failure && infoRes.data) {
        artistName = trimText(infoRes.data.artistsNames || (infoRes.data.artists && infoRes.data.artists[0] && infoRes.data.artists[0].name) || "");
    }
    if (!artistName) artistName = "V-Pop";

    var searchRes = zingGet("/search/multi", { q: artistName });
    var items = [];
    var rawSongs = searchRes.data && Array.isArray(searchRes.data.songs) ? searchRes.data.songs : [];
    for (var i = 0; i < rawSongs.length; i++) {
        var card = parseTrackCard(rawSongs[i]);
        if (card && card.id !== id) {
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
