load("common.js");

function resolveAudiusUrl(url) {
    var appName = getAppName();
    var resolveUrl = AUDIUS_API_BASE + "/v1/resolve?url=" + encodeURIComponent(url) + "&app_name=" + encodeURIComponent(appName);
    var rsp = fetch(resolveUrl);

    if (rsp.status === 404) {
        return { error: "Không tìm thấy nội dung Audius từ đường link này", kind: ERROR_KIND.UNAVAILABLE };
    }

    var directJson = safeJsonParse(rsp.text());
    var dDirect = directJson && directJson.data ? (Array.isArray(directJson.data) ? directJson.data[0] : directJson.data) : null;
    if (dDirect) {
        var directCard = null;
        if (dDirect.playlist_name) directCard = parsePlaylistCard(dDirect);
        else if (dDirect.handle && !dDirect.duration) directCard = parseUserCard(dDirect);
        else directCard = parseTrackCard(dDirect);
        if (directCard) {
            return {
                filters: [],
                sections: [{ title: "Kết quả", layout: "list", items: [directCard] }],
                items: [directCard],
                next: null
            };
        }
    }

    var location = rsp.header ? rsp.header("location") : (rsp.headers && rsp.headers["location"]);
    if (rsp.status === 302 && location) {
        var targetUrl = location.indexOf("http") === 0 ? location : (AUDIUS_API_BASE + location);
        if (targetUrl.indexOf("app_name=") === -1) {
            targetUrl += (targetUrl.indexOf("?") === -1 ? "?" : "&") + "app_name=" + encodeURIComponent(appName);
        }
        var followed = fetch(targetUrl);
        if (followed.ok) {
            var dataJson = safeJsonParse(followed.text());
            var d = dataJson && dataJson.data ? dataJson.data : null;
            if (d) {
                var card = null;
                if (location.indexOf("/tracks/") !== -1) card = parseTrackCard(d);
                else if (location.indexOf("/playlists/") !== -1) card = parsePlaylistCard(d);
                else if (location.indexOf("/users/") !== -1) card = parseUserCard(d);
                if (card) {
                    return {
                        filters: [],
                        sections: [{ title: "Kết quả", layout: "list", items: [card] }],
                        items: [card],
                        next: null
                    };
                }
            }
        }
    }

    return { error: "Không thể giải mã liên kết Audius", kind: ERROR_KIND.INVALID_RESPONSE };
}

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    var filter = trimText(input.filter || "");
    var next = input.next ? trimText(input.next) : null;

    if (!query && !next) {
        return Response.success({ filters: [], sections: [], items: [], next: null });
    }

    var filters = [
        { title: "Tracks", input: "tracks" },
        { title: "Playlists", input: "playlists" },
        { title: "Nghệ sĩ", input: "users" }
    ];

    var cacheKey = "s:" + (next ? ("n:" + next) : ("q:" + query + ":f:" + filter));
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Direct link resolve
    if (isAudiusUrl(query) && !next) {
        var resolved = resolveAudiusUrl(query);
        if (resolved.error) {
            return Response.error(resolved.error, { kind: resolved.kind || ERROR_KIND.INVALID_RESPONSE });
        }
        cacheSet(cacheKey, resolved, 120000);
        return Response.success(resolved);
    }

    var offset = next ? (parseInt(next, 10) || 0) : 0;
    var limit = 20;
    var appName = getAppName();

    if (filter === "playlists") {
        var plUrl = AUDIUS_API_BASE + "/v1/playlists/search?query=" + encodeURIComponent(query)
            + "&limit=" + limit + "&offset=" + offset + "&app_name=" + encodeURIComponent(appName);
        var plRsp = fetch(plUrl);
        var plJson = plRsp.ok ? safeJsonParse(plRsp.text()) : null;
        var plItems = [];
        if (plJson && Array.isArray(plJson.data)) {
            for (var p = 0; p < plJson.data.length; p++) {
                var pCard = parsePlaylistCard(plJson.data[p]);
                if (pCard) plItems.push(pCard);
            }
        }
        var plNext = (plJson && plJson.data && plJson.data.length >= limit) ? String(offset + limit) : null;
        var plPage = {
            filters: filters,
            sections: [{ title: "Playlists", layout: "shelf", items: plItems }],
            items: plItems,
            next: plNext
        };
        cacheSet(cacheKey, plPage, 60000);
        return Response.success(plPage);
    }

    if (filter === "users") {
        var uUrl = AUDIUS_API_BASE + "/v1/users/search?query=" + encodeURIComponent(query)
            + "&limit=" + limit + "&offset=" + offset + "&app_name=" + encodeURIComponent(appName);
        var uRsp = fetch(uUrl);
        var uJson = uRsp.ok ? safeJsonParse(uRsp.text()) : null;
        var uItems = [];
        if (uJson && Array.isArray(uJson.data)) {
            for (var u = 0; u < uJson.data.length; u++) {
                var uCard = parseUserCard(uJson.data[u]);
                if (uCard) uItems.push(uCard);
            }
        }
        var uNext = (uJson && uJson.data && uJson.data.length >= limit) ? String(offset + limit) : null;
        var uPage = {
            filters: filters,
            sections: [{ title: "Nghệ sĩ", layout: "list", items: uItems }],
            items: uItems,
            next: uNext
        };
        cacheSet(cacheKey, uPage, 60000);
        return Response.success(uPage);
    }

    // Default: Tracks search
    var searchUrl = AUDIUS_API_BASE + "/v1/tracks/search?query=" + encodeURIComponent(query)
        + "&limit=" + limit + "&offset=" + offset + "&app_name=" + encodeURIComponent(appName);
    var rsp = fetch(searchUrl);

    if (rsp.status >= 500) {
        return Response.error("Máy chủ Audius gặp sự cố tạm thời (HTTP " + rsp.status + ")", { kind: ERROR_KIND.NETWORK });
    }
    if (!rsp.ok) {
        return Response.error("Không đọc được kết quả tìm kiếm từ Audius (HTTP " + rsp.status + ")", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var json = safeJsonParse(rsp.text());
    if (!json || !Array.isArray(json.data)) {
        return Response.error("Định dạng dữ liệu tìm kiếm Audius không đúng", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var items = [];
    var seen = {};
    for (var i = 0; i < json.data.length; i++) {
        var item = json.data[i];
        var c = parseTrackCard(item);
        if (c && !seen[c.id]) {
            seen[c.id] = true;
            items.push(c);
        }
    }

    var nextToken = (json.data.length >= limit) ? String(offset + limit) : null;

    var sections = [];
    if (items.length > 0) {
        sections.push({
            title: "Kết quả hàng đầu",
            layout: "top",
            items: [items[0]]
        });
        sections.push({
            title: "Bài hát nổi bật",
            layout: "list",
            items: items.slice(1),
            more: { filter: "tracks" }
        });
    }

    var result = {
        filters: filters,
        sections: sections,
        items: items,
        next: nextToken
    };

    cacheSet(cacheKey, result, 60000);
    return Response.success(result);
}
