load("common.js");

function execute(input) {
    input = input || {};
    var id = trimText(input.id || input.query || "");
    if (!id) {
        return Response.error("Thiếu mã album (id) Subsonic", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "alb:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var albumRes = subsonicGet("getAlbum.view", { id: id });
    if (albumRes.failure) {
        return albumRes.failure;
    }

    var alb = albumRes.data && albumRes.data.album;
    if (!alb) {
        return Response.error("Không tìm thấy album trên máy chủ Subsonic", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var info = parseAlbumCard(alb, albumRes.baseUrl, albumRes.auth);
    var rawSongs = Array.isArray(alb.song) ? alb.song : [];
    var tracks = [];

    for (var i = 0; i < rawSongs.length; i++) {
        var t = parseTrackCard(rawSongs[i], albumRes.baseUrl, albumRes.auth);
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
