load("common.js");

function execute(input) {
    input = input || {};
    var id = extractSongId(input.id || input.query || "");
    if (!id) {
        return Response.error("Thiếu mã bài hát (id) Subsonic", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "rel:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var tracks = [];
    var simRes = subsonicGet("getSimilarSongs.view", { id: id, count: 20 });
    if (simRes.data && simRes.data.similarSongs && Array.isArray(simRes.data.similarSongs.song)) {
        var rawSongs = simRes.data.similarSongs.song;
        for (var i = 0; i < rawSongs.length; i++) {
            var t = parseTrackCard(rawSongs[i], simRes.baseUrl, simRes.auth);
            if (t && t.id !== id) tracks.push(t);
        }
    }

    // Fallback: if server doesn't support getSimilarSongs or returns empty, fetch random songs
    if (tracks.length === 0) {
        var randRes = subsonicGet("getRandomSongs.view", { size: 20 });
        if (randRes.data && randRes.data.randomSongs && Array.isArray(randRes.data.randomSongs.song)) {
            var rSongs = randRes.data.randomSongs.song;
            for (var j = 0; j < rSongs.length; j++) {
                var rt = parseTrackCard(rSongs[j], randRes.baseUrl, randRes.auth);
                if (rt && rt.id !== id) tracks.push(rt);
            }
        }
    }

    var result = {
        items: tracks,
        next: null
    };

    cacheSet(cacheKey, result, 120000);
    return Response.success(result);
}
