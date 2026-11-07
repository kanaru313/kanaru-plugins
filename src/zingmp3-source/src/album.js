load("common.js");

function execute(input) {
    input = input || {};
    var id = extractEncodeId(input.id || "");
    if (!id) {
        return Response.error("Thiếu mã album (id)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "alb:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var res = zingGet("/page/get/playlist", { id: id });
    if (res.failure) {
        return res.failure;
    }

    var pl = res.data;
    var title = trimText(pl.title || "") || "Album";
    var artist = trimText(pl.artistsNames || "ZingMP3");
    var artworkUrl = pl.thumbnailM || pl.thumbnail || "";
    var description = trimText(pl.description || pl.sortDescription || "");
    var webUrl = pl.link ? ("https://zingmp3.vn" + pl.link) : ("https://zingmp3.vn/album/" + id + ".html");

    var tracks = [];
    var songItems = pl.song && Array.isArray(pl.song.items) ? pl.song.items : [];
    for (var i = 0; i < songItems.length; i++) {
        var card = parseTrackCard(songItems[i]);
        if (card) tracks.push(card);
    }

    var result = {
        info: {
            title: title,
            subtitle: artist + " · Album (" + tracks.length + " bài hát)",
            artworkUrl: artworkUrl,
            description: description,
            webUrl: webUrl,
            artists: [{ id: "", title: artist }]
        },
        tracks: tracks,
        next: null,
        sections: []
    };

    cacheSet(cacheKey, result, 120000);
    return Response.success(result);
}
