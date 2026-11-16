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

    var plUrl = SC_API_BASE + "/playlists/" + encodeURIComponent(id);
    var rsp = fetchWithAuth(plUrl);

    if (rsp.status === 404) {
        return Response.error("Không tìm thấy album trên SoundCloud", { kind: ERROR_KIND.UNAVAILABLE });
    }
    if (!rsp.ok) {
        return Response.error("Không tải được album SoundCloud (HTTP " + rsp.status + ")", { kind: ERROR_KIND.NETWORK });
    }

    var json = safeJsonParse(rsp.text());
    if (!json) {
        return Response.error("Dữ liệu album SoundCloud không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var title = trimText(json.title) || "Album";
    var artist = json.user ? trimText(json.user.username || json.user.full_name || "") : "SoundCloud";
    var artworkUrl = chooseArtworkUrl(json.artwork_url, json.user && json.user.avatar_url);
    var webUrl = json.permalink_url || (SC_WEB_BASE + "/playlists/" + id);
    var description = trimText(json.description || "");

    var tracks = [];
    var rawTracks = Array.isArray(json.tracks) ? json.tracks : [];
    for (var i = 0; i < rawTracks.length; i++) {
        var card = parseTrackCard(rawTracks[i]);
        if (card) tracks.push(card);
    }

    var result = {
        info: {
            title: title,
            subtitle: (artist ? artist + " · " : "") + (tracks.length + " bài hát"),
            artworkUrl: artworkUrl,
            description: description,
            webUrl: webUrl,
            artists: [{ id: String(json.user ? json.user.id : ""), title: artist }]
        },
        tracks: tracks,
        next: null,
        sections: []
    };

    cacheSet(cacheKey, result, 120000);
    return Response.success(result);
}
