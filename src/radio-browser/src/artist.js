load("common.js");

function execute(input) {
    input = input || {};
    var id = trimText(input.id || input.query || "");
    if (!id) {
        return Response.error("Thiếu tên quốc gia hoặc mạng lưới phát thanh", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "art:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Try country stations first, if empty try search by name
    var path = "/json/stations/bycountry/" + encodeURIComponent(id) + "?limit=30&order=votes&reverse=true";
    var stRes = fetchApi(path);

    if (!stRes.ok || !Array.isArray(stRes.data) || stRes.data.length === 0) {
        path = "/json/stations/search?name=" + encodeURIComponent(id) + "&limit=30&order=votes&reverse=true";
        stRes = fetchApi(path);
    }

    var rawStations = (stRes.ok && Array.isArray(stRes.data)) ? stRes.data : [];
    var items = [];
    for (var i = 0; i < rawStations.length; i++) {
        var card = parseRadioCard(rawStations[i]);
        if (card) items.push(card);
    }

    var info = {
        kind: "artist",
        id: id,
        title: id,
        subtitle: items.length + " đài phát sóng",
        artist: id,
        artworkUrl: items[0] ? items[0].artworkUrl : "",
        webUrl: "https://www.radio-browser.info"
    };

    var sections = [];
    if (items.length > 0) {
        sections.push({
            title: "Đài phát sóng",
            layout: "list",
            items: items
        });
    }

    var result = {
        info: info,
        sections: sections,
        next: null
    };

    cacheSet(cacheKey, result, 120000);
    return Response.success(result);
}
