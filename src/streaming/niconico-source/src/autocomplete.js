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

    var url = "https://sug.search.nicovideo.jp/suggestion/complete/" + encodeURIComponent(query);
    var fetchWrap = nicoGet(url);
    if (fetchWrap.failure) {
        return Response.success({ suggestions: [] });
    }

    var suggestions = [];
    try {
        var json = fetchWrap.res.json();
        var candidates = (json && Array.isArray(json.candidates)) ? json.candidates : [];
        for (var i = 0; i < candidates.length && suggestions.length < 8; i++) {
            var c = decodeHtml(candidates[i]);
            if (c) suggestions.push(c);
        }
    } catch (e) {}

    cacheSet(cacheKey, suggestions, 120000);
    return Response.success({ suggestions: suggestions });
}
