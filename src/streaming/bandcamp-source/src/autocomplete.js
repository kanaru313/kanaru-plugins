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

    var searchUrl = "https://bandcamp.com/api/fuzzysearch/2/app_autocomplete?q=" + encodeURIComponent(query);
    var fetchWrap = bandcampGet(searchUrl);
    if (fetchWrap.failure) {
        return Response.success({ suggestions: [] });
    }

    var suggestions = [];
    try {
        var json = fetchWrap.res.json();
        var results = (json && Array.isArray(json.results)) ? json.results : [];
        var seen = {};

        for (var i = 0; i < results.length; i++) {
            var item = results[i];
            var name = decodeHtml(item.name || "");
            if (name && !seen[name.toLowerCase()]) {
                seen[name.toLowerCase()] = true;
                suggestions.push(name);
            }
            var band = decodeHtml(item.band_name || "");
            if (band && !seen[band.toLowerCase()] && suggestions.length < 8) {
                seen[band.toLowerCase()] = true;
                suggestions.push(band);
            }
        }
    } catch (e) {}

    cacheSet(cacheKey, suggestions, 120000);
    return Response.success({ suggestions: suggestions });
}
