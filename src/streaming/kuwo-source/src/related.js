load("common.js");

function execute(input) {
    input = input || {};
    var idParam = (typeof input === "string") ? input : (input.id || input.rid || "");
    var id = extractKuwoId(idParam);

    if (!id) {
        return Response.error("Thiếu mã bài hát Kuwo Music", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "rel:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Query track info to find artist
    var trackSearch = "https://search.kuwo.cn/r.s?client=kt&all=" + encodeURIComponent(id) +
        "&pn=0&rn=5&vipver=1&ft=music&encoding=utf8&rformat=json&mobi=1";

    var artist = "";
    var resWrap = kuwoGet(trackSearch);
    if (!resWrap.failure && resWrap.res) {
        try {
            var json = resWrap.res.json();
            if (json && Array.isArray(json.abslist) && json.abslist.length) {
                artist = decodeHtml(json.abslist[0].ARTIST || "");
            }
        } catch (e) {}
    }

    if (!artist) artist = "热歌";

    var searchUrl = "https://search.kuwo.cn/r.s?client=kt&all=" + encodeURIComponent(artist) +
        "&pn=0&rn=15&vipver=1&ft=music&encoding=utf8&rformat=json&mobi=1";

    var items = [];
    var relRes = kuwoGet(searchUrl);
    if (!relRes.failure && relRes.res) {
        try {
            var relJson = relRes.res.json();
            var list = (relJson && Array.isArray(relJson.abslist)) ? relJson.abslist : [];
            for (var i = 0; i < list.length; i++) {
                var card = parseTrackCard(list[i]);
                if (card && card.id !== id) {
                    items.push(card);
                }
            }
        } catch (e) {}
    }

    var result = {
        items: items,
        next: null
    };

    cacheSet(cacheKey, result, 180000);
    return Response.success(result);
}
