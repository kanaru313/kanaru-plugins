load("common.js");

function execute(input) {
    var cacheKey = "home";
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var appName = getAppName();
    var tracksUrl = AUDIUS_API_BASE + "/v1/tracks/trending?limit=15&app_name=" + encodeURIComponent(appName);
    var tracksRsp = fetch(tracksUrl);
    var tracksJson = tracksRsp.ok ? safeJsonParse(tracksRsp.text()) : null;

    var trackItems = [];
    if (tracksJson && Array.isArray(tracksJson.data)) {
        for (var i = 0; i < tracksJson.data.length; i++) {
            var c = parseTrackCard(tracksJson.data[i]);
            if (c) trackItems.push(c);
        }
    }

    var plUrl = AUDIUS_API_BASE + "/v1/playlists/trending?limit=10&app_name=" + encodeURIComponent(appName);
    var plRsp = fetch(plUrl);
    var plJson = plRsp.ok ? safeJsonParse(plRsp.text()) : null;

    var plItems = [];
    if (plJson && Array.isArray(plJson.data)) {
        for (var j = 0; j < plJson.data.length; j++) {
            var plCard = parsePlaylistCard(plJson.data[j]);
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
            title: "Playlists thịnh hành",
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
