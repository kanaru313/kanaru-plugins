load("common.js");

function execute(input) {
    input = input || {};
    var rawId = (typeof input === "string") ? input : (input.id || "");
    var artistName = trimText(rawId);

    if (!artistName) {
        return Response.error("Thiếu thông tin nghệ sĩ Bandcamp", { kind: ERROR_KIND.UNAVAILABLE });
    }

    // If URL passed, extract artist subdomain or name
    if (artistName.startsWith("http")) {
        var subMatch = artistName.match(/https?:\/\/([a-zA-Z0-9-]+)\.bandcamp\.com/);
        if (subMatch && subMatch[1]) {
            artistName = subMatch[1];
        }
    }

    var cacheKey = "artist:" + artistName;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var searchUrl = "https://bandcamp.com/api/fuzzysearch/2/app_autocomplete?q=" + encodeURIComponent(artistName);
    var fetchWrap = bandcampGet(searchUrl);
    if (fetchWrap.failure) return fetchWrap.failure;

    var json = null;
    try {
        json = fetchWrap.res.json();
    } catch (e) {
        return Response.error("Phản hồi thông tin nghệ sĩ không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var rawResults = (json && Array.isArray(json.results)) ? json.results : [];
    var items = [];
    var displayTitle = artistName;
    var artworkUrl = "";

    for (var i = 0; i < rawResults.length; i++) {
        var it = rawResults[i];
        if (it.type === "b" && !artworkUrl && it.img) {
            artworkUrl = it.img;
            displayTitle = it.name;
        }
        var card = parseBandcampSearchItem(it);
        if (card) items.push(card);
    }

    var result = {
        kind: "artist",
        id: rawId,
        title: displayTitle,
        artworkUrl: artworkUrl,
        items: items
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
