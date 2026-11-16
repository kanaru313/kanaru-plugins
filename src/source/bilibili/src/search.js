load("common.js");

function resolveBilibiliUrl(url) {
    var bvid = extractBvid(url);
    if (!bvid) {
        return { error: "Không tìm thấy mã video Bilibili (BV/av)", kind: ERROR_KIND.UNAVAILABLE };
    }

    var viewUrl = BILI_API_BASE + "/x/web-interface/view?bvid=" + encodeURIComponent(bvid);
    var rsp = fetchBili(viewUrl);

    if (rsp.status === 404) {
        return { error: "Không tìm thấy video trên Bilibili", kind: ERROR_KIND.UNAVAILABLE };
    }
    if (!rsp.ok) {
        return { error: "Không thể lấy thông tin video Bilibili (HTTP " + rsp.status + ")", kind: ERROR_KIND.NETWORK };
    }

    var json = safeJsonParse(rsp.text());
    if (!json || json.code !== 0 || !json.data) {
        return { error: (json && json.message) || "Video Bilibili không hợp lệ", kind: ERROR_KIND.INVALID_RESPONSE };
    }

    var card = parseTrackCard(json.data);
    if (!card) {
        return { error: "Không đọc được dữ liệu video Bilibili", kind: ERROR_KIND.INVALID_RESPONSE };
    }

    return {
        filters: [],
        sections: [{ title: "Kết quả liên kết", layout: "list", items: [card] }],
        items: [card],
        next: null
    };
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
        { title: "Video & Nhạc", input: "videos" },
        { title: "UP Chủ / Nghệ sĩ", input: "users" }
    ];

    var cacheKey = "s:" + (next ? ("n:" + next) : ("q:" + query + ":f:" + filter));
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Direct link resolve
    if (/(?:bilibili\.com|b23\.tv)/i.test(query) && !next) {
        var resolved = resolveBilibiliUrl(query);
        if (resolved.error) {
            return Response.error(resolved.error, { kind: resolved.kind || ERROR_KIND.INVALID_RESPONSE });
        }
        cacheSet(cacheKey, resolved, 120000);
        return Response.success(resolved);
    }

    var page = next ? (parseInt(next, 10) || 1) : 1;
    var pageSize = 20;

    if (filter === "users") {
        var uUrl = BILI_API_BASE + "/x/web-interface/search/type?search_type=bili_user&keyword=" + encodeURIComponent(query)
            + "&page=" + page + "&page_size=" + pageSize;
        var uRsp = fetchBili(uUrl);
        var uJson = uRsp.ok ? safeJsonParse(uRsp.text()) : null;
        var uItems = [];
        var rawUsers = (uJson && uJson.data && Array.isArray(uJson.data.result)) ? uJson.data.result : [];
        for (var u = 0; u < rawUsers.length; u++) {
            var uCard = parseUserCard(rawUsers[u]);
            if (uCard) uItems.push(uCard);
        }
        var uNext = (rawUsers.length >= pageSize) ? String(page + 1) : null;
        var uPage = {
            filters: filters,
            sections: [{ title: "UP Chủ / Nghệ sĩ", layout: "list", items: uItems }],
            items: uItems,
            next: uNext
        };
        cacheSet(cacheKey, uPage, 60000);
        return Response.success(uPage);
    }

    // Default: Video search
    var searchUrl = BILI_API_BASE + "/x/web-interface/search/type?search_type=video&keyword=" + encodeURIComponent(query)
        + "&page=" + page + "&page_size=" + pageSize;
    var rsp = fetchBili(searchUrl);

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
        var item = json.data.result[i];
        var c = parseTrackCard(item);
        if (c && !seen[c.id]) {
            seen[c.id] = true;
            items.push(c);
        }
    }

    var nextToken = (json.data.result.length >= pageSize) ? String(page + 1) : null;

    var sections = [];
    if (items.length > 0) {
        sections.push({
            title: "Kết quả hàng đầu",
            layout: "top",
            items: [items[0]]
        });
        sections.push({
            title: "Video & Bài hát",
            layout: "list",
            items: items.slice(1),
            more: { filter: "videos" }
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
