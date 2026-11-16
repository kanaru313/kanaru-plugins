load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    if (!query) {
        return Response.success([]);
    }

    var cacheKey = "ac:" + query;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var suggestions = [];
    var seen = {};

    function addSug(text) {
        var t = trimText(text);
        if (t && !seen[t.toLowerCase()]) {
            seen[t.toLowerCase()] = true;
            suggestions.push(t);
        }
    }

    var stRes = fetchApi("/json/stations/search?name=" + encodeURIComponent(query) + "&limit=10&order=votes&reverse=true");
    if (stRes.ok && Array.isArray(stRes.data)) {
        for (var i = 0; i < stRes.data.length; i++) {
            if (stRes.data[i].name) addSug(stRes.data[i].name);
        }
    }

    var tagRes = fetchApi("/json/tags/" + encodeURIComponent(query) + "?limit=5&order=stationcount&reverse=true");
    if (tagRes.ok && Array.isArray(tagRes.data)) {
        for (var j = 0; j < tagRes.data.length; j++) {
            if (tagRes.data[j].name) addSug(tagRes.data[j].name);
        }
    }

    cacheSet(cacheKey, suggestions, 60000);
    return Response.success(suggestions);
}
