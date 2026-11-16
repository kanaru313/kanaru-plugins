load("common.js");

function execute(input) {
    input = input || {};
    var id = trimText(input.id || "");
    if (!id) {
        return Response.error("Thiếu mã nghệ sĩ (id)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "art:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var res = zingGet("/search/multi", { q: id.replace(/-/g, " ") });
    if (res.failure) {
        return res.failure;
    }

    var songs = [];
    var rawSongs = Array.isArray(res.data.songs) ? res.data.songs : [];
    for (var i = 0; i < rawSongs.length; i++) {
        var sc = parseTrackCard(rawSongs[i]);
        if (sc) songs.push(sc);
    }

    var playlists = [];
    var rawPlaylists = Array.isArray(res.data.playlists) ? res.data.playlists : [];
    for (var j = 0; j < rawPlaylists.length; j++) {
        var pc = parsePlaylistCard(rawPlaylists[j]);
        if (pc) playlists.push(pc);
    }

    var artistObj = (res.data.artists && res.data.artists.length) ? res.data.artists[0] : null;
    var name = artistObj ? trimText(artistObj.name || "") : id;
    var artworkUrl = artistObj ? (artistObj.thumbnailM || artistObj.thumbnail || "") : "";
    var webUrl = artistObj && artistObj.link ? ("https://zingmp3.vn" + artistObj.link) : ("https://zingmp3.vn/nghe-si/" + id);

    var sections = [];
    if (songs.length > 0) {
        sections.push({
            title: "Bài hát nổi bật",
            layout: "list",
            items: songs
        });
    }
    if (playlists.length > 0) {
        sections.push({
            title: "Tuyển tập & Album",
            layout: "shelf",
            items: playlists
        });
    }

    var result = {
        info: {
            title: name,
            subtitle: "Nghệ sĩ trên ZingMP3",
            artworkUrl: artworkUrl,
            description: "",
            webUrl: webUrl
        },
        sections: sections
    };

    cacheSet(cacheKey, result, 120000);
    return Response.success(result);
}
