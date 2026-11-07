load("common.js");

function execute(input) {
    input = input || {};
    var id = trimText(input.id || input.query || "");
    if (!id) {
        return Response.error("Thiếu mã nghệ sĩ (id) Subsonic", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "art:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var artRes = subsonicGet("getArtist.view", { id: id });
    if (artRes.failure) {
        return artRes.failure;
    }

    var art = artRes.data && artRes.data.artist;
    if (!art) {
        return Response.error("Không tìm thấy thông tin nghệ sĩ trên máy chủ Subsonic", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var info = parseArtistCard(art, artRes.baseUrl, artRes.auth);
    var rawAlbums = Array.isArray(art.album) ? art.album : [];
    var albums = [];

    for (var i = 0; i < rawAlbums.length; i++) {
        var al = parseAlbumCard(rawAlbums[i], artRes.baseUrl, artRes.auth);
        if (al) albums.push(al);
    }

    var sections = [];

    // Optional top songs
    if (art.name) {
        var topRes = subsonicGet("getTopSongs.view", { artist: art.name, count: 10 });
        if (topRes.data && topRes.data.topSongs && Array.isArray(topRes.data.topSongs.song)) {
            var topSongs = [];
            var tSongs = topRes.data.topSongs.song;
            for (var j = 0; j < tSongs.length; j++) {
                var t = parseTrackCard(tSongs[j], topRes.baseUrl, topRes.auth);
                if (t) topSongs.push(t);
            }
            if (topSongs.length > 0) {
                sections.push({
                    title: "Bài hát nổi bật",
                    layout: "list",
                    items: topSongs
                });
            }
        }
    }

    if (albums.length > 0) {
        sections.push({
            title: "Album",
            layout: "shelf",
            items: albums
        });
    }

    var result = {
        info: info,
        sections: sections,
        next: null
    };

    cacheSet(cacheKey, result, 120000);
    return Response.success(result);
}
