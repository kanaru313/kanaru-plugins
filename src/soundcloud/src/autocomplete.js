load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    if (!query) {
        return Response.success([]);
    }

    try {
        var url = SC_API_BASE + "/search/queries?q=" + encodeURIComponent(query) + "&limit=10";
        var rsp = fetchWithAuth(url);
        if (!rsp.ok) {
            return Response.success([]);
        }

        var json = safeJsonParse(rsp.text());
        if (!json || !Array.isArray(json.collection)) {
            return Response.success([]);
        }

        var suggestions = [];
        for (var i = 0; i < json.collection.length && suggestions.length < 10; i++) {
            var item = json.collection[i];
            var q = trimText(item.query || "");
            if (q && q.length <= 200) {
                suggestions.push(q);
            }
        }

        return Response.success(suggestions);
    } catch (e) {
        return Response.success([]);
    }
}
