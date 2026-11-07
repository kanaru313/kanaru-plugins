load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    if (!query) {
        return Response.success([]);
    }

    try {
        var url = "https://ac.zingmp3.vn/complete?type=artist,song,key,code&num=10&query=" + encodeURIComponent(query);
        var rsp = fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
        });
        if (!rsp.ok) {
            return Response.success([]);
        }

        var json = safeJsonParse(rsp.text());
        if (!json || !json.data || !Array.isArray(json.data) || json.data.length === 0) {
            return Response.success([]);
        }

        var suggestions = [];
        var firstBlock = json.data[0];

        // Song titles
        if (Array.isArray(firstBlock.song)) {
            for (var i = 0; i < firstBlock.song.length && suggestions.length < 5; i++) {
                var sName = trimText(firstBlock.song[i].name || firstBlock.song[i].title || "");
                if (sName && suggestions.indexOf(sName) === -1) {
                    suggestions.push(sName);
                }
            }
        }

        // Artist names
        if (Array.isArray(firstBlock.artist)) {
            for (var j = 0; j < firstBlock.artist.length && suggestions.length < 10; j++) {
                var aName = trimText(firstBlock.artist[j].name || "");
                if (aName && suggestions.indexOf(aName) === -1) {
                    suggestions.push(aName);
                }
            }
        }

        return Response.success(suggestions.slice(0, 10));
    } catch (e) {
        return Response.success([]);
    }
}
