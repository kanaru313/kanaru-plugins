load("common.js");

function execute(input) {
    input = input || {};
    var rawId = (typeof input === "string") ? input : (input.id || "");
    var parsed = extractJamendoId(rawId);
    var playlistId = parsed.id || rawId;

    if (!playlistId || !/^\d+$/.test(playlistId)) {
        return Response.error("Mã danh sách phát Jamendo không hợp lệ", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "pl:" + playlistId;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var fetchWrap = jamendoGet("playlists/tracks/", { id: playlistId });
    if (fetchWrap.failure) return fetchWrap.failure;

    var list = (fetchWrap.json && Array.isArray(fetchWrap.json.results)) ? fetchWrap.json.results : [];
    if (list.length === 0) {
        return Response.error("Không tìm thấy danh sách phát trên Jamendo", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var plData = list[0];
    var title = decodeHtml(plData.name || "Danh sách phát");
    var creator = decodeHtml(plData.user_name || "Jamendo Community");
    var rawTracks = Array.isArray(plData.tracks) ? plData.tracks : [];
    var items = [];
    var artworkUrl = "";

    for (var i = 0; i < rawTracks.length; i++) {
        var tr = rawTracks[i];
        if (!tr) continue;
        var card = parseJamendoTrack(tr);
        if (card) {
            if (!artworkUrl && card.artworkUrl) artworkUrl = card.artworkUrl;
            items.push(card);
        }
    }

    var result = {
        kind: "playlist",
        id: playlistId,
        title: title,
        artist: creator,
        artworkUrl: artworkUrl,
        items: items
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
