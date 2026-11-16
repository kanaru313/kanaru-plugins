load("common.js");

function execute(input) {
    input = input || {};
    var url = trimText(input.url || "");
    if (!url) {
        return Response.error("Thiếu đường dẫn (url)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var appName = getAppName();
    var resolveUrl = AUDIUS_API_BASE + "/v1/resolve?url=" + encodeURIComponent(url) + "&app_name=" + encodeURIComponent(appName);
    var rsp = fetch(resolveUrl);

    if (rsp.status === 404) {
        return Response.error("Không tìm thấy nội dung Audius từ đường link này", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var location = rsp.header ? rsp.header("location") : (rsp.headers && rsp.headers["location"]);
    if ((rsp.status === 302 || rsp.status === 200) && location) {
        var targetUrl = location.indexOf("http") === 0 ? location : (AUDIUS_API_BASE + location);
        if (targetUrl.indexOf("app_name=") === -1) {
            targetUrl += (targetUrl.indexOf("?") === -1 ? "?" : "&") + "app_name=" + encodeURIComponent(appName);
        }
        var followed = fetch(targetUrl);
        if (followed.ok) {
            var dataJson = safeJsonParse(followed.text());
            var d = dataJson && dataJson.data ? (Array.isArray(dataJson.data) ? dataJson.data[0] : dataJson.data) : null;
            if (d) {
                var card = null;
                if (location.indexOf("/tracks/") !== -1) card = parseTrackCard(d);
                else if (location.indexOf("/playlists/") !== -1) card = parsePlaylistCard(d);
                else if (location.indexOf("/users/") !== -1) card = parseUserCard(d);
                if (card) return Response.success(card);
            }
        }
    }

    // Direct JSON response without redirect
    var directJson = safeJsonParse(rsp.text());
    var d2 = directJson && directJson.data ? (Array.isArray(directJson.data) ? directJson.data[0] : directJson.data) : null;
    if (d2) {
        var card2 = null;
        if (d2.track_cid || d2.duration) card2 = parseTrackCard(d2);
        else if (d2.playlist_name) card2 = parsePlaylistCard(d2);
        else if (d2.handle) card2 = parseUserCard(d2);
        if (card2) return Response.success(card2);
    }

    return Response.error("Không thể giải mã liên kết Audius", { kind: ERROR_KIND.INVALID_RESPONSE });
}
