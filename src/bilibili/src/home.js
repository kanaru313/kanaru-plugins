load("common.js");

function execute(input) {
    var cacheKey = "home";
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var rankUrl = BILI_API_BASE + "/x/web-interface/ranking/v2?rid=3&type=all";
    var rankRsp = fetchBili(rankUrl);
    var rankJson = rankRsp.ok ? safeJsonParse(rankRsp.text()) : null;

    var rankItems = [];
    var rawRank = rankJson && rankJson.data && Array.isArray(rankJson.data.list) ? rankJson.data.list : [];
    for (var i = 0; i < Math.min(rawRank.length, 20); i++) {
        var c = parseTrackCard(rawRank[i]);
        if (c) rankItems.push(c);
    }

    var popUrl = BILI_API_BASE + "/x/web-interface/popular?pn=1&ps=15";
    var popRsp = fetchBili(popUrl);
    var popJson = popRsp.ok ? safeJsonParse(popRsp.text()) : null;

    var popItems = [];
    var rawPop = popJson && popJson.data && Array.isArray(popJson.data.list) ? popJson.data.list : [];
    for (var j = 0; j < rawPop.length; j++) {
        var pCard = parseTrackCard(rawPop[j]);
        if (pCard) popItems.push(pCard);
    }

    var sections = [];
    if (rankItems.length > 0) {
        sections.push({
            title: "Bảng xếp hạng Âm nhạc",
            layout: "list",
            items: rankItems
        });
    }
    if (popItems.length > 0) {
        sections.push({
            title: "Thịnh hành Bilibili",
            layout: "shelf",
            items: popItems
        });
    }

    var page = {
        sections: sections,
        next: null
    };

    cacheSet(cacheKey, page, 300000);
    return Response.success(page);
}
