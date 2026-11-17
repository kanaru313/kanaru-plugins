load("common.js");

function execute(input) {
    input = input || {};
    var idParam = (typeof input === "string") ? input : (input.id || input.songKey || input.key || "");
    var id = extractNctKey(idParam);

    if (!id) {
        return Response.error("Thiếu mã bài hát NhacCuaTui", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "rel:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var items = [];

    // 1. Query NCT similar songs endpoint
    var simRes = nctGet("/song/similar/" + id);
    if (!simRes.failure && simRes.data && Array.isArray(simRes.data.list)) {
        for (var i = 0; i < simRes.data.list.length; i++) {
            var c = parseTrackCard(simRes.data.list[i]);
            if (c && c.id !== id) {
                items.push(c);
            }
        }
    }

    // 2. Fallback: if similar songs is empty, search by song's artist
    if (!items.length) {
        var detailRes = nctGet("/song/detail/" + id);
        var artist = "";
        if (!detailRes.failure && detailRes.data) {
            artist = trimText(detailRes.data.artistName || "");
        }
        if (artist) {
            var searchRes = nctGet("/search/song", { keyword: artist, pageindex: 1, pagesize: 15, correct: "false" });
            if (!searchRes.failure && searchRes.data && Array.isArray(searchRes.data.songs)) {
                for (var j = 0; j < searchRes.data.songs.length; j++) {
                    var tc = parseTrackCard(searchRes.data.songs[j]);
                    if (tc && tc.id !== id) {
                        items.push(tc);
                    }
                }
            }
        }
    }

    var result = {
        items: items,
        next: null
    };

    cacheSet(cacheKey, result, 180000);
    return Response.success(result);
}
