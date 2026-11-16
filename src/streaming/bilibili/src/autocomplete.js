load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    if (!query) {
        return Response.success([]);
    }

    try {
        var url = BILI_API_BASE + "/x/web-interface/suggest?term=" + encodeURIComponent(query);
        var rsp = fetchBili(url);
        if (!rsp.ok) {
            return Response.success([]);
        }

        var json = safeJsonParse(rsp.text());
        if (!json || json.code !== 0 || !json.data || !json.data.result || !Array.isArray(json.data.result.tag)) {
            return Response.success([]);
        }

        var suggestions = [];
        var tags = json.data.result.tag;
        for (var i = 0; i < tags.length && suggestions.length < 10; i++) {
            var val = trimText(tags[i].value || tags[i].term || "");
            if (val && val.length <= 200 && suggestions.indexOf(val) === -1) {
                suggestions.push(val);
            }
        }

        return Response.success(suggestions);
    } catch (e) {
        return Response.success([]);
    }
}
