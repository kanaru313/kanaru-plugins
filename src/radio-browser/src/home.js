load("common.js");

function execute(input) {
    var cacheKey = "h:default";
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var sections = [];

    // 1. Đài phát nghe nhiều nhất
    var topClickRes = fetchApi("/json/stations/topclick/20");
    if (topClickRes.ok && Array.isArray(topClickRes.data)) {
        var clickItems = [];
        for (var i = 0; i < topClickRes.data.length; i++) {
            var cCard = parseRadioCard(topClickRes.data[i]);
            if (cCard) clickItems.push(cCard);
        }
        if (clickItems.length > 0) {
            sections.push({
                title: "Nghe nhiều nhất",
                layout: "shelf",
                items: clickItems
            });
        }
    }

    // 2. Bình chọn cao nhất
    var topVoteRes = fetchApi("/json/stations/topvote/20");
    if (topVoteRes.ok && Array.isArray(topVoteRes.data)) {
        var voteItems = [];
        for (var j = 0; j < topVoteRes.data.length; j++) {
            var vCard = parseRadioCard(topVoteRes.data[j]);
            if (vCard) voteItems.push(vCard);
        }
        if (voteItems.length > 0) {
            sections.push({
                title: "Bình chọn cao nhất",
                layout: "shelf",
                items: voteItems
            });
        }
    }

    // 3. Thể loại phổ biến
    var tagsRes = fetchApi("/json/tags?order=stationcount&reverse=true&limit=16");
    if (tagsRes.ok && Array.isArray(tagsRes.data)) {
        var tagItems = [];
        for (var k = 0; k < tagsRes.data.length; k++) {
            var tCard = parseTagCard(tagsRes.data[k]);
            if (tCard) tagItems.push(tCard);
        }
        if (tagItems.length > 0) {
            sections.push({
                title: "Thể loại phổ biến",
                layout: "shelf",
                items: tagItems
            });
        }
    }

    var result = {
        sections: sections,
        next: null
    };

    cacheSet(cacheKey, result, 120000);
    return Response.success(result);
}
