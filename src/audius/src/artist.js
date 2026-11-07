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

    var appName = getAppName();
    var userUrl = AUDIUS_API_BASE + "/v1/users/" + encodeURIComponent(id) + "?app_name=" + encodeURIComponent(appName);
    var rsp = fetch(userUrl);

    if (rsp.status === 404 || !rsp.ok) {
        userUrl = AUDIUS_API_BASE + "/v1/users/handle/" + encodeURIComponent(id) + "?app_name=" + encodeURIComponent(appName);
        rsp = fetch(userUrl);
    }

    if (!rsp.ok) {
        return Response.error("Không tải được thông tin nghệ sĩ trên Audius", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var json = safeJsonParse(rsp.text());
    var user = json && json.data ? (Array.isArray(json.data) ? json.data[0] : json.data) : null;
    if (!user) {
        return Response.error("Dữ liệu nghệ sĩ Audius không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var numericId = user.id ? String(user.id) : id;
    var tracksUrl = AUDIUS_API_BASE + "/v1/users/" + encodeURIComponent(numericId) + "/tracks?limit=20&app_name=" + encodeURIComponent(appName);
    var tracksRsp = fetch(tracksUrl);
    var tracksJson = tracksRsp.ok ? safeJsonParse(tracksRsp.text()) : null;

    var tracks = [];
    var rawTracks = tracksJson && Array.isArray(tracksJson.data) ? tracksJson.data : [];
    for (var i = 0; i < rawTracks.length; i++) {
        var card = parseTrackCard(rawTracks[i]);
        if (card) tracks.push(card);
    }

    var name = trimText(user.name || user.handle || id);
    var subs = user.follower_count ? (user.follower_count + " followers") : "Audius Creator";
    var artworkUrl = chooseArtworkUrl(user.profile_picture);
    var webUrl = user.handle ? (AUDIUS_WEB_BASE + "/" + user.handle) : (AUDIUS_WEB_BASE + "/users/" + id);

    var result = {
        info: {
            title: name,
            subtitle: subs,
            artworkUrl: artworkUrl,
            description: trimText(user.bio || ""),
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
