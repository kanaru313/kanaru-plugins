load("common.js");

function execute(input) {
    input = input || {};
    var rawId = (typeof input === "string") ? input : (input.id || input.listId || "");
    var id = trimText(rawId).replace(/^mylist\//, "").replace(/\D/g, "");

    if (!id) {
        return Response.error("Thiếu mã danh sách phát (Mylist) NicoNico", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "pl:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var url = "https://nvapi.nicovideo.jp/v2/mylists/" + encodeURIComponent(id) + "?pageSize=30&page=1";
    var fetchWrap = nicoGet(url);
    if (fetchWrap.failure) return fetchWrap.failure;

    var json = null;
    try {
        json = fetchWrap.res.json();
    } catch (e) {
        return Response.error("Phản hồi danh sách phát NicoNico không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var mylist = (json && json.data && json.data.mylist) ? json.data.mylist : {};
    var title = decodeHtml(mylist.name || "NicoNico Mylist");
    var creator = decodeHtml((mylist.owner && mylist.owner.name) ? mylist.owner.name : "NicoNico Community");
    var entries = Array.isArray(mylist.items) ? mylist.items : [];
    var items = [];
    var artworkUrl = "";

    for (var i = 0; i < entries.length; i++) {
        var v = entries[i].video;
        if (!v || !v.id) continue;
        var card = {
            kind: "track",
            id: v.id,
            title: decodeHtml(v.title || v.id),
            subtitle: creator,
            artist: creator,
            artists: [{ id: "", title: creator }],
            durationMs: (parseInt(v.duration || "0", 10) || 0) * 1000,
            artworkUrl: (v.thumbnail && v.thumbnail.url) ? v.thumbnail.url : "",
            webUrl: "https://www.nicovideo.jp/watch/" + v.id
        };
        if (!artworkUrl && card.artworkUrl) artworkUrl = card.artworkUrl;
        items.push(card);
    }

    var result = {
        kind: "playlist",
        id: id,
        title: title,
        artist: creator,
        artworkUrl: artworkUrl,
        items: items
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
