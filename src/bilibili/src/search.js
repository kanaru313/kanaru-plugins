load("common.js");

function resolveBilibiliVideo(bvid) {
    var viewUrl = BILI_API_BASE + "/x/web-interface/view?bvid=" + encodeURIComponent(bvid);
    var rsp = fetch(viewUrl, {
        headers: {
            "User-Agent": "Kanaru/1.0 (+https://github.com/hieu313/kanaru)"
        }
    });

    if (rsp.status === 404) {
        return { error: "Không tìm thấy video Bilibili từ đường link này", kind: ERROR_KIND.UNAVAILABLE };
    }
    if (!rsp.ok) {
        return { error: "Không thể lấy thông tin video Bilibili (HTTP " + rsp.status + ")", kind: ERROR_KIND.NETWORK };
    }

    var json = safeJsonParse(rsp.text());
    if (!json || json.code !== 0 || !json.data) {
        return { error: (json && json.message) || "Video không tồn tại hoặc đã bị ẩn", kind: ERROR_KIND.UNAVAILABLE };
    }

    var card = parseTrackCard(json.data);
    return { items: card ? [card] : [], next: null };
}

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    var next = input.next ? trimText(input.next) : null;

    if (!query && !next) {
        return Response.success({ items: [], next: null });
    }

    // Cache check
    var cacheKey = "s:" + (next ? ("n:" + next) : ("q:" + query));
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Case 1: Pasted Bilibili URL or direct BV/av id
    var directBvid = extractBvid(query);
    if (directBvid && !next) {
        var resolved = resolveBilibiliVideo(directBvid);
        if (resolved.error) {
            return Response.error(resolved.error, { kind: resolved.kind || ERROR_KIND.INVALID_RESPONSE });
        }
        cacheSet(cacheKey, resolved, 120000);
        return Response.success(resolved);
    }

    // Case 2: Standard video search with page pagination
    var page = next ? (parseInt(next, 10) || 1) : 1;
    var searchUrl = BILI_API_BASE + "/x/web-interface/search/type?search_type=video&keyword="
        + encodeURIComponent(query)
        + "&page=" + page;

    var rsp = fetch(searchUrl, {
        headers: {
            "User-Agent": "Kanaru/1.0 (+https://github.com/hieu313/kanaru)"
        }
    });

    if (rsp.status >= 500) {
        return Response.error("Máy chủ Bilibili gặp sự cố tạm thời (HTTP " + rsp.status + ")", { kind: ERROR_KIND.NETWORK });
    }

    if (!rsp.ok) {
        return Response.error("Không đọc được kết quả tìm kiếm từ Bilibili (HTTP " + rsp.status + ")", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var json = safeJsonParse(rsp.text());
    if (!json || json.code !== 0 || !json.data || !Array.isArray(json.data.result)) {
        return Response.error((json && json.message) || "Định dạng dữ liệu tìm kiếm Bilibili không đúng", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var items = [];
    var seen = {};
    for (var i = 0; i < json.data.result.length; i++) {
        var card = parseTrackCard(json.data.result[i]);
        if (card && !seen[card.id]) {
            seen[card.id] = true;
            items.push(card);
        }
    }

    var numPages = json.data.numPages || 1;
    var nextToken = (page < numPages && json.data.result.length > 0) ? String(page + 1) : null;

    var result = {
        items: items,
        next: nextToken
    };

    cacheSet(cacheKey, result, 60000);
    return Response.success(result);
}
