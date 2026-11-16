load("common.js");

function execute(input) {
    input = input || {};
    var id = trimText(input.id || input.query || "");
    if (!id) {
        return Response.error("Thiếu mã hoặc chủ đề tuyển tập đài phát", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var next = input.next ? trimText(input.next) : null;
    var offset = next ? (parseInt(next, 10) || 0) : 0;
    var limit = 25;

    var cacheKey = "alb:" + id + ":" + offset;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Try stations by tag first, if empty try by country
    var path = "/json/stations/bytag/" + encodeURIComponent(id)
        + "?limit=" + limit
        + "&offset=" + offset
        + "&order=votes&reverse=true";

    var stRes = fetchApi(path);
    if (!stRes.ok || !Array.isArray(stRes.data) || stRes.data.length === 0) {
        path = "/json/stations/bycountry/" + encodeURIComponent(id)
            + "?limit=" + limit
            + "&offset=" + offset
            + "&order=votes&reverse=true";
        stRes = fetchApi(path);
    }

    var rawStations = (stRes.ok && Array.isArray(stRes.data)) ? stRes.data : [];
    var tracks = [];
    for (var i = 0; i < rawStations.length; i++) {
        var card = parseRadioCard(rawStations[i]);
        if (card) tracks.push(card);
    }

    var info = {
        kind: "album",
        id: id,
        title: "Tuyển tập đài phát: " + id,
        subtitle: tracks.length + " đài phát",
        artist: "Radio Browser",
        artworkUrl: tracks[0] ? tracks[0].artworkUrl : "",
        webUrl: "https://www.radio-browser.info"
    };

    var nextToken = (rawStations.length >= limit) ? String(offset + limit) : null;
    var result = {
        info: info,
        tracks: tracks,
        sections: [
            {
                title: "Danh sách đài phát",
                layout: "list",
                items: tracks
            }
        ],
        next: nextToken
    };

    cacheSet(cacheKey, result, 120000);
    return Response.success(result);
}
