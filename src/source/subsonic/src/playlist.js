load("common.js");

function execute(input) {
    input = input || {};
    var id = trimText(input.id || input.query || "");
    if (!id) {
        return Response.error("Thiếu mã danh sách phát (id) Subsonic", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "pl:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var plRes = subsonicGet("getPlaylist.view", { id: id });
    if (plRes.failure) {
        return plRes.failure;
    }

    var pl = plRes.data && plRes.data.playlist;
    if (!pl) {
        return Response.error("Không tìm thấy danh sách phát trên máy chủ Subsonic", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var info = parsePlaylistCard(pl, plRes.baseUrl, plRes.auth);
    var rawEntries = Array.isArray(pl.entry) ? pl.entry : [];
    var tracks = [];

    for (var i = 0; i < rawEntries.length; i++) {
        var t = parseTrackCard(rawEntries[i], plRes.baseUrl, plRes.auth);
        if (t) tracks.push(t);
    }

    var result = {
        info: info,
        tracks: tracks,
        sections: [
            {
                title: "Danh sách bài hát",
                layout: "list",
                items: tracks
            }
        ],
        next: null
    };

    cacheSet(cacheKey, result, 120000);
    return Response.success(result);
}
