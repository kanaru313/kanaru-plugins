load("common.js");

function execute(input) {
    var cacheKey = "home";
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var tracksUrl = SC_API_BASE + "/search/tracks?q=top%20hits&limit=15";
    var tracksRsp = fetchWithAuth(tracksUrl);
    var tracksJson = tracksRsp.ok ? safeJsonParse(tracksRsp.text()) : null;

    var trackItems = [];
    if (tracksJson && Array.isArray(tracksJson.collection)) {
        for (var i = 0; i < tracksJson.collection.length; i++) {
            var c = parseTrackCard(tracksJson.collection[i]);
            if (c) trackItems.push(c);
        }
    }

    var plUrl = SC_API_BASE + "/search/playlists?q=hot%20hits&limit=10";
    var plRsp = fetchWithAuth(plUrl);
    var plJson = plRsp.ok ? safeJsonParse(plRsp.text()) : null;

    var plItems = [];
    if (plJson && Array.isArray(plJson.collection)) {
        for (var j = 0; j < plJson.collection.length; j++) {
            var plCard = parsePlaylistCard(plJson.collection[j]);
            if (plCard) plItems.push(plCard);
        }
    }

    var sections = [];
    if (trackItems.length > 0) {
        sections.push({
            title: "Thịnh hành hôm nay",
            layout: "list",
            items: trackItems
        });
    }
    if (plItems.length > 0) {
        sections.push({
            title: "Danh sách phát thịnh hành",
            layout: "shelf",
            items: plItems
        });
    }

    var page = {
        sections: sections,
        next: null
    };

    cacheSet(cacheKey, page, 300000);
    return Response.success(page);
}
