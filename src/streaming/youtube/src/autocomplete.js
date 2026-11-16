load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    if (!query) {
        return Response.success([]);
    }

    try {
        var url = YT_BASE + "/complete/search?client=youtube&ds=yt&q=" + encodeURIComponent(query);
        var rsp = fetch(url, { headers: buildPreferredHeaders() });
        if (!rsp.ok) {
            return Response.success([]);
        }

        var text = rsp.text();
        var match = text.match(/\((.*)\)/s);
        if (!match || !match[1]) {
            return Response.success([]);
        }

        var data = safeJsonParse(match[1]);
        if (!data || !Array.isArray(data[1])) {
            return Response.success([]);
        }

        var suggestions = [];
        for (var i = 0; i < data[1].length && suggestions.length < 10; i++) {
            var item = data[1][i];
            var s = Array.isArray(item) ? item[0] : (typeof item === "string" ? item : "");
            s = trimText(s);
            if (s && s.length <= 200) {
                suggestions.push(s);
            }
        }

        return Response.success(suggestions);
    } catch (e) {
        return Response.success([]);
    }
}
