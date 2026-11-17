load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText((typeof input === "string") ? input : (input.query || ""));

    if (!query || query.length < 2) {
        return Response.success({ suggestions: [] });
    }

    var cacheKey = "auto:" + query;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success({ suggestions: cached });
    }

    var fetchWrap = jamendoGet("tracks/", {
        namesearch: query,
        limit: 8,
        order: "popularity_total"
    });

    if (fetchWrap.failure) {
        return Response.success({ suggestions: [] });
    }

    var suggestions = [];
    var list = (fetchWrap.json && Array.isArray(fetchWrap.json.results)) ? fetchWrap.json.results : [];
    var seen = {};

    for (var i = 0; i < list.length; i++) {
        var tName = decodeHtml(list[i].name || "");
        if (tName && !seen[tName.toLowerCase()]) {
            seen[tName.toLowerCase()] = true;
            suggestions.push(tName);
        }
        var aName = decodeHtml(list[i].artist_name || "");
        if (aName && !seen[aName.toLowerCase()] && suggestions.length < 8) {
            seen[aName.toLowerCase()] = true;
            suggestions.push(aName);
        }
    }

    cacheSet(cacheKey, suggestions, 120000);
    return Response.success({ suggestions: suggestions });
}
