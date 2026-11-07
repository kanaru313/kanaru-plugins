load("common.js");

function resolveAudiusUrl(url, appName) {
    var resolveUrl = AUDIUS_API_BASE + "/v1/resolve?url=" + encodeURIComponent(url) + "&app_name=" + encodeURIComponent(appName);
    var rsp = fetch(resolveUrl, {
        headers: {
            "Accept": "application/json",
            "User-Agent": "Kanaru/0.1.0 (+https://github.com/hieu313/kanaru)"
        }
    });

    if (rsp.status === 404) {
        return { error: "Không tìm thấy nội dung Audius từ đường link này", kind: ERROR_KIND.UNAVAILABLE };
    }
    if (!rsp.ok && rsp.status !== 302 && rsp.status !== 301) {
        return { error: "Không thể giải mã liên kết Audius (HTTP " + rsp.status + ")", kind: ERROR_KIND.NETWORK };
    }

    var json = safeJsonParse(rsp.text());
    if (!json || typeof json.data === "undefined") {
        return { error: "Phản hồi giải mã link Audius không hợp lệ", kind: ERROR_KIND.INVALID_RESPONSE };
    }

    var rawData = json.data;
    var rawTracks = [];

    if (Array.isArray(rawData)) {
        if (rawData.length > 0 && rawData[0] && Array.isArray(rawData[0].tracks)) {
            // Playlist or Album response
            rawTracks = rawData[0].tracks;
        } else {
            rawTracks = rawData;
        }
    } else if (rawData && typeof rawData === "object") {
        if (Array.isArray(rawData.tracks)) {
            // Playlist or Album object
            rawTracks = rawData.tracks;
        } else {
            // Single track object
            rawTracks = [rawData];
        }
    }

    var cards = [];
    var seen = {};
    for (var i = 0; i < rawTracks.length; i++) {
        var card = parseTrackCard(rawTracks[i]);
        if (card && !seen[card.id]) {
            seen[card.id] = true;
            cards.push(card);
        }
    }

    return { items: cards, next: null };
}

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    var next = input.next ? trimText(input.next) : null;

    if (!query && !next) {
        return Response.success({ items: [], next: null });
    }

    var appName = getAppName();

    // Cache check
    var cacheKey = "s:" + (next ? ("n:" + next) : ("q:" + query));
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Case 1: Audius URL pasted (track, playlist, or album)
    if (isAudiusUrl(query) && !next) {
        var resolved = resolveAudiusUrl(query, appName);
        if (resolved.error) {
            return Response.error(resolved.error, { kind: resolved.kind || ERROR_KIND.INVALID_RESPONSE });
        }
        cacheSet(cacheKey, resolved, 120000);
        return Response.success(resolved);
    }

    // Case 2: Standard track search with offset pagination
    var offset = next ? (parseInt(next, 10) || 0) : 0;
    var limit = 20;

    var searchUrl = AUDIUS_API_BASE + "/v1/tracks/search?query=" + encodeURIComponent(query)
        + "&limit=" + limit
        + "&offset=" + offset
        + "&app_name=" + encodeURIComponent(appName);

    var rsp = fetch(searchUrl, {
        headers: {
            "Accept": "application/json",
            "User-Agent": "Kanaru/0.1.0 (+https://github.com/hieu313/kanaru)"
        }
    });

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
        var card = parseTrackCard(json.data[i]);
        if (card && !seen[card.id]) {
            seen[card.id] = true;
            items.push(card);
        }
    }

    var nextToken = (json.data.length >= limit) ? String(offset + limit) : null;
    var result = {
        items: items,
        next: nextToken
    };

    cacheSet(cacheKey, result, 60000);
    return Response.success(result);
}
