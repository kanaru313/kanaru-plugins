load("common.js");

function execute(input) {
    input = input || {};
    var rawId = (typeof input === "string") ? input : (input.id || "");
    var videoId = extractNicoId(rawId);

    if (!videoId) {
        return Response.error("Thiếu mã video NicoNico", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "rel:" + videoId;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Try recommend API
    var recUrl = "https://nvapi.nicovideo.jp/v1/recommend?video=" + encodeURIComponent(videoId);
    var recWrap = nicoGet(recUrl);
    var items = [];

    if (!recWrap.failure) {
        try {
            var j = recWrap.res.json();
            var list = (j && j.data && Array.isArray(j.data.items)) ? j.data.items : [];
            for (var i = 0; i < list.length; i++) {
                var it = list[i];
                if (!it || it.contentType !== "video" || !it.id) continue;
                if (it.id === videoId) continue;
                items.push({
                    kind: "track",
                    id: it.id,
                    title: decodeHtml(it.title || it.id),
                    subtitle: "NicoNico Douga",
                    artist: "NicoNico Producer",
                    artists: [{ id: "", title: "NicoNico Producer" }],
                    durationMs: (parseInt(it.duration || "0", 10) || 0) * 1000,
                    artworkUrl: (it.thumbnail && it.thumbnail.url) ? it.thumbnail.url : "",
                    webUrl: "https://www.nicovideo.jp/watch/" + it.id
                });
            }
        } catch (ignored) {}
    }

    // Fallback if recommend API empty
    if (items.length === 0) {
        var fbUrl = "https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search?q=VOCALOID" +
            "&targets=tags&fields=contentId,title,lengthSeconds,thumbnailUrl,categoryTags,tags" +
            "&_sort=-viewCounter&_limit=10";
        var fbWrap = nicoGet(fbUrl);
        if (!fbWrap.failure) {
            try {
                var fbJson = fbWrap.res.json();
                var fbList = (fbJson && Array.isArray(fbJson.data)) ? fbJson.data : [];
                for (var k = 0; k < fbList.length; k++) {
                    if (fbList[k].contentId === videoId) continue;
                    var c = parseNicoSnapshotItem(fbList[k]);
                    if (c) items.push(c);
                }
            } catch (ignored2) {}
        }
    }

    var result = {
        title: "Tác phẩm liên quan",
        items: items
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
