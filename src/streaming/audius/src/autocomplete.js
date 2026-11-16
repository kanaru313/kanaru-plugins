load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    if (!query) {
        return Response.success([]);
    }

    try {
        var appName = getAppName();
        var tUrl = AUDIUS_API_BASE + "/v1/tracks/search?query=" + encodeURIComponent(query)
            + "&limit=5&app_name=" + encodeURIComponent(appName);
        var tRsp = fetch(tUrl);
        var tJson = tRsp.ok ? safeJsonParse(tRsp.text()) : null;

        var suggestions = [];
        if (tJson && Array.isArray(tJson.data)) {
            for (var i = 0; i < tJson.data.length && suggestions.length < 5; i++) {
                var title = trimText(tJson.data[i].title || "");
                if (title && suggestions.indexOf(title) === -1) {
                    suggestions.push(title);
                }
            }
        }

        var uUrl = AUDIUS_API_BASE + "/v1/users/search?query=" + encodeURIComponent(query)
            + "&limit=5&app_name=" + encodeURIComponent(appName);
        var uRsp = fetch(uUrl);
        var uJson = uRsp.ok ? safeJsonParse(uRsp.text()) : null;
        if (uJson && Array.isArray(uJson.data)) {
            for (var j = 0; j < uJson.data.length && suggestions.length < 10; j++) {
                var name = trimText(uJson.data[j].name || uJson.data[j].handle || "");
                if (name && suggestions.indexOf(name) === -1) {
                    suggestions.push(name);
                }
            }
        }

        return Response.success(suggestions.slice(0, 10));
    } catch (e) {
        return Response.success([]);
    }
}
