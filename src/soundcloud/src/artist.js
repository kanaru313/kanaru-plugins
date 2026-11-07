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

    var user = null;
    if (/^\d+$/.test(id)) {
        var uRsp = fetchWithAuth(SC_API_BASE + "/users/" + id);
        if (uRsp.ok) user = safeJsonParse(uRsp.text());
    } else {
        var resRsp = fetchWithAuth(SC_API_BASE + "/resolve?url=" + encodeURIComponent(SC_WEB_BASE + "/" + id));
        if (resRsp.ok) user = safeJsonParse(resRsp.text());
    }

    if (!user) {
        return Response.error("Không tìm thấy thông tin nghệ sĩ trên SoundCloud", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var numericId = user.id ? String(user.id) : id;
    var tracksRsp = fetchWithAuth(SC_API_BASE + "/users/" + numericId + "/tracks?limit=20");
    var tracksJson = tracksRsp.ok ? safeJsonParse(tracksRsp.text()) : null;

    var tracks = [];
    var rawTracks = tracksJson && Array.isArray(tracksJson.collection) ? tracksJson.collection : [];
    for (var i = 0; i < rawTracks.length; i++) {
        var card = parseTrackCard(rawTracks[i]);
        if (card) tracks.push(card);
    }

    var name = trimText(user.username || user.full_name || id);
    var subs = user.followers_count ? (user.followers_count + " followers") : "Nghệ sĩ SoundCloud";
    var artworkUrl = chooseArtworkUrl(user.avatar_url);
    var webUrl = user.permalink_url || (SC_WEB_BASE + "/" + id);

    var result = {
        info: {
            title: name,
            subtitle: subs,
            artworkUrl: artworkUrl,
            description: trimText(user.description || ""),
            webUrl: webUrl
        },
        sections: [
            {
                title: "Tracks nổi bật",
                layout: "list",
                items: tracks
            }
        ]
    };

    cacheSet(cacheKey, result, 120000);
    return Response.success(result);
}
