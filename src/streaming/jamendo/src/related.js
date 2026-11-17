load("common.js");

function execute(input) {
    input = input || {};
    var rawId = (typeof input === "string") ? input : (input.id || "");
    var parsed = extractJamendoId(rawId);
    var trackId = parsed.id || rawId;

    if (!trackId || !/^\d+$/.test(trackId)) {
        return Response.error("Thiếu mã bài hát Jamendo", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "rel:" + trackId;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var fetchTrack = jamendoGet("tracks/", { id: trackId });
    if (fetchTrack.failure) return fetchTrack.failure;

    var list = (fetchTrack.json && Array.isArray(fetchTrack.json.results)) ? fetchTrack.json.results : [];
    if (list.length === 0) {
        return Response.error("Không tìm thấy bài hát Jamendo", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var current = list[0];
    var artistId = current.artist_id;
    var queryParams = {
        limit: 15,
        order: "popularity_total",
        audioformat: getAudioQuality()
    };
    if (artistId) {
        queryParams.artist_id = artistId;
    } else {
        queryParams.namesearch = current.name;
    }

    var fetchRel = jamendoGet("tracks/", queryParams);
    if (fetchRel.failure) return fetchRel.failure;

    var relList = (fetchRel.json && Array.isArray(fetchRel.json.results)) ? fetchRel.json.results : [];
    var items = [];

    for (var i = 0; i < relList.length; i++) {
        var tr = relList[i];
        if (String(tr.id) === String(trackId)) continue;
        var card = parseJamendoTrack(tr);
        if (card) items.push(card);
    }

    var result = {
        title: "Bài hát tương tự",
        items: items
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
