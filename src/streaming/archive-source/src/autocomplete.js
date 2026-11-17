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

    var safeQuery = query.replace(/[^\w\s\u00C0-\u024F\u1EA0-\u1EF9]/gi, " ").trim();
    var url = "https://archive.org/advancedsearch.php?q=mediatype:(audio)+AND+(" + encodeURIComponent(safeQuery || query) + ")&fl[]=title,creator&rows=6&output=json";

    var resWrap = archiveGet(url);
    if (resWrap.failure) {
        return Response.success({ suggestions: [] });
    }

    var suggestions = [];
    try {
        var json = resWrap.res.json();
        var docs = (json && json.response && Array.isArray(json.response.docs)) ? json.response.docs : [];
        var seen = {};

        for (var i = 0; i < docs.length; i++) {
            var t = decodeHtml(docs[i].title || "");
            if (t && !seen[t.toLowerCase()]) {
                seen[t.toLowerCase()] = true;
                suggestions.push(t);
            }
            var c = decodeHtml(docs[i].creator || "");
            if (c && !seen[c.toLowerCase()] && suggestions.length < 8) {
                seen[c.toLowerCase()] = true;
                suggestions.push(c);
            }
        }
    } catch (e) {}

    cacheSet(cacheKey, suggestions, 120000);
    return Response.success({ suggestions: suggestions });
}
