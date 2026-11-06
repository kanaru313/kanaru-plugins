load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    var next = input.next ? trimText(input.next) : null;

    // Cache check
    var cacheKey = "s:" + (next ? ("n:" + next) : ("q:" + query));
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Case 1: Pasted direct HTTP live stream link
    if (/^https?:\/\//i.test(query) && !next) {
        var card = {
            id: query,
            title: "Đài phát thanh trực tiếp",
            artist: "Live Audio Stream",
            durationMs: 0,
            artworkUrl: "",
            webUrl: query
        };
        var directRes = { items: [card], next: null };
        cacheSet(cacheKey, directRes, 120000);
        return Response.success(directRes);
    }

    var offset = next ? (parseInt(next, 10) || 0) : 0;
    var limit = 20;

    var url = "";
    if (query) {
        url = RADIO_API_BASE + "/json/stations/search?name=" + encodeURIComponent(query)
            + "&limit=" + limit
            + "&offset=" + offset
            + "&order=votes&reverse=true";
    } else {
        // Empty query: fetch popular stations by preferred country or global topvote
        var country = "";
        try {
            if (typeof localConfig !== "undefined" && localConfig.getItem) {
                country = trimText(localConfig.getItem("country") || "");
            }
        } catch (e) {}

        if (country) {
            url = RADIO_API_BASE + "/json/stations/bycountry/" + encodeURIComponent(country)
                + "?limit=" + limit
                + "&offset=" + offset
                + "&order=votes&reverse=true";
        } else {
            url = RADIO_API_BASE + "/json/stations/topvote?limit=" + limit + "&offset=" + offset;
        }
    }

    var rsp = fetch(url, {
        headers: {
            "Accept": "application/json",
            "User-Agent": "Kanaru/1.0 (+https://github.com/hieu313/kanaru)"
        }
    });

    if (rsp.status >= 500) {
        return Response.error("Máy chủ Radio Browser gặp sự cố (HTTP " + rsp.status + ")", { kind: ERROR_KIND.NETWORK });
    }

    if (!rsp.ok) {
        return Response.error("Lỗi khi tìm kiếm đài phát thanh (HTTP " + rsp.status + ")", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var json = safeJsonParse(rsp.text());
    if (!Array.isArray(json)) {
        return Response.error("Định dạng dữ liệu Radio Browser không đúng", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var items = [];
    var seen = {};
    for (var i = 0; i < json.length; i++) {
        var c = parseRadioCard(json[i]);
        if (c && !seen[c.id]) {
            seen[c.id] = true;
            items.push(c);
        }
    }

    var nextToken = (json.length >= limit) ? String(offset + limit) : null;
    var result = {
        items: items,
        next: nextToken
    };

    cacheSet(cacheKey, result, 60000);
    return Response.success(result);
}
