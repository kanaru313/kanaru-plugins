load("common.js");

function execute(input) {
    input = input || {};
    var id = trimText(input.id || "");
    if (!id) {
        return Response.error("Thiếu mã album (id)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "alb:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var appName = getAppName();
    var plUrl = AUDIUS_API_BASE + "/v1/playlists/" + encodeURIComponent(id) + "?app_name=" + encodeURIComponent(appName);
    var rsp = fetch(plUrl);

    if (rsp.status === 404) {
        return Response.error("Không tìm thấy album trên Audius", { kind: ERROR_KIND.UNAVAILABLE });
    }
    if (!rsp.ok) {
        return Response.error("Không tải được album Audius (HTTP " + rsp.status + ")", { kind: ERROR_KIND.NETWORK });
    }

    var json = safeJsonParse(rsp.text());
    var pl = json && json.data ? (Array.isArray(json.data) ? json.data[0] : json.data) : null;
    if (!pl) {
        return Response.error("Dữ liệu album Audius không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var tracksUrl = AUDIUS_API_BASE + "/v1/playlists/" + encodeURIComponent(id) + "/tracks?app_name=" + encodeURIComponent(appName);
    var tracksRsp = fetch(tracksUrl);
    var tracksJson = tracksRsp.ok ? safeJsonParse(tracksRsp.text()) : null;

    var tracks = [];
    var rawTracks = tracksJson && Array.isArray(tracksJson.data) ? tracksJson.data : [];
    for (var i = 0; i < rawTracks.length; i++) {
        var card = parseTrackCard(rawTracks[i]);
        if (card) tracks.push(card);
    }

    var title = trimText(pl.playlist_name || pl.title || "Album");
    var artist = pl.user ? trimText(pl.user.name || pl.user.handle || "Audius") : "Audius";
    var artworkUrl = chooseArtworkUrl(pl.artwork);
    var webUrl = pl.permalink ? (AUDIUS_WEB_BASE + pl.permalink) : (AUDIUS_WEB_BASE + "/playlists/" + id);

    var result = {
        info: {
            title: title,
            subtitle: (artist ? artist + " · " : "") + "Album (" + tracks.length + " bài hát)",
            artworkUrl: artworkUrl,
            description: trimText(pl.description || ""),
            webUrl: webUrl,
            artists: [{ id: String(pl.user ? pl.user.id : ""), title: artist }]
        },
        tracks: tracks,
        next: null,
        sections: []
    };

    cacheSet(cacheKey, result, 120000);
    return Response.success(result);
}
