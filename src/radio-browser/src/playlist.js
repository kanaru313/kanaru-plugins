load("common.js");

function execute(input) {
    input = input || {};
    var id = trimText(input.id || input.query || "topvote");
    var next = input.next ? trimText(input.next) : null;
    var offset = next ? (parseInt(next, 10) || 0) : 0;
    var limit = 25;

    var cacheKey = "pl:" + id + ":" + offset;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var path = "";
    var title = "Danh sách đài phát";

    if (id === "topvote") {
        path = "/json/stations/topvote?limit=" + limit + "&offset=" + offset;
        title = "Đài phát bình chọn cao nhất";
    } else if (id === "topclick") {
        path = "/json/stations/topclick?limit=" + limit + "&offset=" + offset;
        title = "Đài phát nghe nhiều nhất";
    } else {
        path = "/json/stations/bytag/" + encodeURIComponent(id)
            + "?limit=" + limit
            + "&offset=" + offset
            + "&order=votes&reverse=true";
        title = "Danh sách đài phát: " + id;
    }

    var stRes = fetchApi(path);
    if ((!stRes.ok || !Array.isArray(stRes.data) || stRes.data.length === 0) && id !== "topvote" && id !== "topclick") {
        path = "/json/stations/bycountry/" + encodeURIComponent(id)
            + "?limit=" + limit
            + "&offset=" + offset
            + "&order=votes&reverse=true";
        stRes = fetchApi(path);
        title = "Đài phát quốc gia: " + id;
    }

    var rawStations = (stRes.ok && Array.isArray(stRes.data)) ? stRes.data : [];
    var tracks = [];
    for (var i = 0; i < rawStations.length; i++) {
        var card = parseRadioCard(rawStations[i]);
        if (card) tracks.push(card);
    }

    var info = {
        kind: "playlist",
        id: id,
        title: title,
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
