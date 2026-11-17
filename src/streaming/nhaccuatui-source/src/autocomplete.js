load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    if (!query) {
        return Response.success([]);
    }

    try {
        var res = nctGet("/search/song", { keyword: query, pageindex: 1, pagesize: 10, correct: "false" });
        if (res.failure || !res.data || !Array.isArray(res.data.songs)) {
            return Response.success([]);
        }

        var suggestions = [];
        var raw = res.data.songs;

        for (var i = 0; i < raw.length && suggestions.length < 10; i++) {
            var s = raw[i];
            if (!s) continue;
            var name = trimText(s.name || "");
            if (name && suggestions.indexOf(name) === -1) {
                suggestions.push(name);
            }
            var artist = trimText(s.artistName || "");
            if (artist && suggestions.indexOf(artist) === -1 && suggestions.length < 10) {
                suggestions.push(artist);
            }
        }

        return Response.success(suggestions.slice(0, 10));
    } catch (e) {
        return Response.success([]);
    }
}
