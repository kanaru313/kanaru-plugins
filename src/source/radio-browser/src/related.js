load("common.js");

function execute(input) {
    input = input || {};
    var id = trimText(input.id || input.query || "");
    if (!id) {
        return Response.error("Thiếu mã đài phát (UUID)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "rel:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var relatedStations = [];

    // Step 1: Lookup station to get its tag and country
    var stRes = fetchApi("/json/stations/byuuid?uuids=" + encodeURIComponent(id));
    if (stRes.ok && Array.isArray(stRes.data) && stRes.data.length > 0) {
        var station = stRes.data[0];
        var tag = "";
        if (station.tags) {
            var tagList = station.tags.split(",");
            if (tagList.length > 0) tag = trimText(tagList[0]);
        }

        if (tag) {
            var tagRes = fetchApi("/json/stations/bytag/" + encodeURIComponent(tag) + "?limit=20&order=votes&reverse=true");
            if (tagRes.ok && Array.isArray(tagRes.data)) {
                for (var i = 0; i < tagRes.data.length; i++) {
                    var card = parseRadioCard(tagRes.data[i]);
                    if (card && card.id !== id) {
                        relatedStations.push(card);
                    }
                }
            }
        }

        if (relatedStations.length === 0 && station.country) {
            var countryRes = fetchApi("/json/stations/bycountry/" + encodeURIComponent(station.country) + "?limit=20&order=votes&reverse=true");
            if (countryRes.ok && Array.isArray(countryRes.data)) {
                for (var j = 0; j < countryRes.data.length; j++) {
                    var cCard = parseRadioCard(countryRes.data[j]);
                    if (cCard && cCard.id !== id) {
                        relatedStations.push(cCard);
                    }
                }
            }
        }
    }

    // Fallback: topclick
    if (relatedStations.length === 0) {
        var fallbackRes = fetchApi("/json/stations/topclick/20");
        if (fallbackRes.ok && Array.isArray(fallbackRes.data)) {
            for (var k = 0; k < fallbackRes.data.length; k++) {
                var fCard = parseRadioCard(fallbackRes.data[k]);
                if (fCard && fCard.id !== id) {
                    relatedStations.push(fCard);
                }
            }
        }
    }

    var result = {
        items: relatedStations,
        next: null
    };

    cacheSet(cacheKey, result, 120000);
    return Response.success(result);
}
