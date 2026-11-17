load("common.js");

function execute(input) {
    input = input || {};
    var idParam = (typeof input === "string") ? input : (input.id || input.playlistKey || input.key || "");
    var id = extractNctKey(idParam);

    if (!id) {
        return Response.error("Thiếu mã danh sách phát NhacCuaTui", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "pl:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var res = nctGet("/playlist/detail/" + id);
    if (res.failure) return res.failure;
    if (res.empty || !res.data) {
        return Response.error("Danh sách phát không tồn tại hoặc đã bị xóa", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var data = res.data;
    var rawSongs = Array.isArray(data.listSong) ? data.listSong : [];
    var items = [];

    for (var i = 0; i < rawSongs.length; i++) {
        var card = parseTrackCard(rawSongs[i]);
        if (card) items.push(card);
    }

    var title = trimText(data.name || "Danh sách phát");
    var artist = trimText(data.artistName || data.subName || "NhacCuaTui");
    var artworkUrl = data.image || data.imageShare || "";

    var result = {
        id: id,
        title: title,
        artist: artist,
        artworkUrl: artworkUrl,
        items: items,
        next: null
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
