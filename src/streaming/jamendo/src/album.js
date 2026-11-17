load("common.js");

function execute(input) {
    input = input || {};
    var rawId = (typeof input === "string") ? input : (input.id || "");
    var parsed = extractJamendoId(rawId);
    var albumId = parsed.id || rawId;

    if (!albumId || !/^\d+$/.test(albumId)) {
        return Response.error("Mã album Jamendo không hợp lệ", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "album:" + albumId;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var fetchWrap = jamendoGet("albums/tracks/", { id: albumId });
    if (fetchWrap.failure) return fetchWrap.failure;

    var list = (fetchWrap.json && Array.isArray(fetchWrap.json.results)) ? fetchWrap.json.results : [];
    if (list.length === 0) {
        return Response.error("Không tìm thấy album trên Jamendo", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var albumData = list[0];
    var albumTitle = decodeHtml(albumData.name || "Album");
    var artistName = decodeHtml(albumData.artist_name || "Jamendo Artist");
    var artworkUrl = albumData.image || "";
    var rawTracks = Array.isArray(albumData.tracks) ? albumData.tracks : [];
    var items = [];

    for (var i = 0; i < rawTracks.length; i++) {
        var tr = rawTracks[i];
        if (!tr) continue;
        tr.artist_name = tr.artist_name || artistName;
        tr.album_name = tr.album_name || albumTitle;
        tr.album_image = tr.album_image || artworkUrl;
        var card = parseJamendoTrack(tr);
        if (card) items.push(card);
    }

    var result = {
        kind: "album",
        id: albumId,
        title: albumTitle,
        artist: artistName,
        artists: [{ id: String(albumData.artist_id || ""), title: artistName }],
        artworkUrl: artworkUrl,
        items: items
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
