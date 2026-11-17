load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    var next = input.next ? trimText(input.next) : null;

    if (!query && !next) {
        return Response.success({ filters: [], sections: [], items: [], next: null });
    }

    var cacheKey = "s:" + (next ? ("n:" + next) : ("q:" + query));
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Direct link resolve
    var kuwoId = extractKuwoId(query);
    if (kuwoId && /kuwo\.cn/i.test(query) && !next) {
        var directUrl = "http://antiserver.kuwo.cn/anti.s?type=convert_url&rid=" + kuwoId + "&format=mp3&response=url";
        var dRes = kuwoGet(directUrl);
        if (!dRes.failure) {
            var item = {
                kind: "track",
                id: kuwoId,
                title: "Bài hát Kuwo #" + kuwoId,
                subtitle: "Kuwo Music",
                artist: "Kuwo Music",
                artists: [{ id: "", title: "Kuwo Music" }],
                durationMs: 0,
                artworkUrl: "",
                webUrl: "https://www.kuwo.cn/play_detail/" + kuwoId
            };
            var directPage = {
                filters: [],
                sections: [
                    { title: "Bài hát", layout: "list", items: [item] }
                ],
                items: [item],
                next: null
            };
            cacheSet(cacheKey, directPage, 120000);
            return Response.success(directPage);
        }
    }

    var pn = next ? (parseInt(next, 10) || 0) : 0;
    var searchUrl = "https://search.kuwo.cn/r.s?client=kt&all=" + encodeURIComponent(query) +
        "&pn=" + pn + "&rn=20&vipver=1&ft=music&encoding=utf8&rformat=json&mobi=1";

    var resWrap = kuwoGet(searchUrl);
    if (resWrap.failure) return resWrap.failure;

    var json = null;
    try {
        json = resWrap.res.json();
    } catch (e) {
        return Response.error("Kuwo Music phản hồi dữ liệu tìm kiếm không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var abslist = (json && Array.isArray(json.abslist)) ? json.abslist : [];
    var items = [];
    var seen = {};

    for (var i = 0; i < abslist.length; i++) {
        var card = parseTrackCard(abslist[i]);
        if (card && !seen[card.id]) {
            seen[card.id] = true;
            items.push(card);
        }
    }

    var nextCursor = abslist.length >= 20 ? String(pn + 1) : null;
    var pageResult = {
        filters: [],
        sections: [
            { title: "Bài hát", layout: "list", items: items }
        ],
        items: items,
        next: nextCursor
    };

    cacheSet(cacheKey, pageResult, 60000);
    return Response.success(pageResult);
}
