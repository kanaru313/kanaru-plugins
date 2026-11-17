load("common.js");

function execute(input) {
    input = input || {};
    var idParam = (typeof input === "string") ? input : (input.id || input.albumKey || input.key || "");
    var id = extractNctKey(idParam);

    if (!id) {
        return Response.error("Thiếu mã album NhacCuaTui", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "alb:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var res = nctGet("/playlist/detail/" + id);
    if (res.failure) return res.failure;
    if (res.empty || !res.data) {
        return Response.error("Album không tồn tại hoặc đã bị gỡ bỏ", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var data = res.data;
    var title = trimText(data.name || "Album");
    var artist = trimText(data.artistName || data.subName || data.singerName || "NhacCuaTui");
    var artworkUrl = data.image || data.imageShare || "";
    var webUrl = "https://www.nhaccuatui.com/playlist/" + id;

    var rawSongs = Array.isArray(data.listSong) ? data.listSong : [];
    var tracks = [];
    for (var i = 0; i < rawSongs.length; i++) {
        var card = parseTrackCard(rawSongs[i]);
        if (card) tracks.push(card);
    }

    var result = {
        info: {
            title: title,
            subtitle: artist + " · Album (" + tracks.length + " bài hát)",
            artworkUrl: artworkUrl,
            description: trimText(data.description || ""),
            webUrl: webUrl,
            artists: [{ id: String(data.artistId || ""), title: artist }]
        },
        tracks: tracks,
        next: null,
        sections: []
    };

    cacheSet(cacheKey, result, 180000);
    return Response.success(result);
}
