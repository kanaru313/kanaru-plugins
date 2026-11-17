load("common.js");

function execute(input) {
    input = input || {};
    var rawId = (typeof input === "string") ? input : (input.id || "");
    var artistName = trimText(rawId);

    if (!artistName) {
        return Response.error("Thiếu thông tin nghệ sĩ / Producer NicoNico", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var next = input.next || "";
    var offset = next ? (parseInt(next, 10) || 0) : 0;
    var cacheKey = "artist:" + artistName + ":" + offset;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var url = "https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search?q=" + encodeURIComponent(artistName) +
        "&targets=title,description,tags" +
        "&fields=contentId,title,lengthSeconds,thumbnailUrl,viewCounter,categoryTags,tags" +
        "&_sort=-viewCounter&_limit=25&_offset=" + offset;

    var fetchWrap = nicoGet(url);
    if (fetchWrap.failure) return fetchWrap.failure;

    var json = null;
    try {
        json = fetchWrap.res.json();
    } catch (e) {
        return Response.error("Phản hồi thông tin nghệ sĩ NicoNico không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var rawData = (json && Array.isArray(json.data)) ? json.data : [];
    var items = [];
    var artworkUrl = "";

    for (var i = 0; i < rawData.length; i++) {
        var card = parseNicoSnapshotItem(rawData[i]);
        if (card) {
            if (!artworkUrl && card.artworkUrl) artworkUrl = card.artworkUrl;
            items.push(card);
        }
    }

    var result = {
        kind: "artist",
        id: artistName,
        title: artistName,
        artworkUrl: artworkUrl,
        items: items,
        next: rawData.length >= 25 ? String(offset + 25) : null
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
