load("common.js");

function execute(input) {
    input = input || {};
    var selectedGenre = trimText(input.genre || input.title || input.name || "");
    var next = input.next ? trimText(input.next) : null;
    var offset = next ? (parseInt(next, 10) || 0) : 0;
    var limit = 24;

    var cacheKey = "g:" + (selectedGenre ? (selectedGenre + ":" + offset) : "list");
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    if (!selectedGenre) {
        // List popular genres (tags)
        var tagsRes = fetchApi("/json/tags?order=stationcount&reverse=true&limit=48");
        if (!tagsRes.ok || !Array.isArray(tagsRes.data)) {
            return Response.error("Không thể tải danh sách thể loại từ Radio Browser", { kind: ERROR_KIND.NETWORK });
        }

        var genreItems = [];
        for (var i = 0; i < tagsRes.data.length; i++) {
            var g = parseTagCard(tagsRes.data[i]);
            if (g) genreItems.push(g);
        }

        var listResult = {
            genres: genreItems,
            sections: [
                {
                    title: "Thể loại phát thanh",
                    layout: "grid",
                    items: genreItems
                }
            ],
            next: null
        };
        cacheSet(cacheKey, listResult, 300000);
        return Response.success(listResult);
    }

    // List stations in genre
    var path = "/json/stations/bytag/" + encodeURIComponent(selectedGenre)
        + "?limit=" + limit
        + "&offset=" + offset
        + "&order=votes&reverse=true";

    var stRes = fetchApi(path);
    if (!stRes.ok || !Array.isArray(stRes.data)) {
        return Response.error("Không thể tải danh sách đài phát cho thể loại: " + selectedGenre, { kind: ERROR_KIND.NETWORK });
    }

    var stations = [];
    for (var j = 0; j < stRes.data.length; j++) {
        var card = parseRadioCard(stRes.data[j]);
        if (card) stations.push(card);
    }

    var nextToken = (stRes.data.length >= limit) ? String(offset + limit) : null;
    var detailResult = {
        title: selectedGenre,
        sections: [
            {
                title: "Đài phát thể loại: " + selectedGenre,
                layout: "list",
                items: stations
            }
        ],
        items: stations,
        next: nextToken
    };

    cacheSet(cacheKey, detailResult, 120000);
    return Response.success(detailResult);
}
