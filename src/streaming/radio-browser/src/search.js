load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    var next = input.next ? trimText(input.next) : null;
    var filter = input.filter ? trimText(input.filter) : "all";

    // Cache check
    var cacheKey = "s:" + filter + ":" + (next ? ("n:" + next) : ("q:" + query));
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Direct HTTP live stream link pasted
    if (/^https?:\/\//i.test(query) && !next) {
        var card = {
            kind: "track",
            id: query,
            title: "Đài phát thanh trực tiếp",
            subtitle: "Live Audio Stream",
            artist: "Live Audio Stream",
            artists: [{ id: "", title: "Live Audio Stream" }],
            durationMs: 0,
            artworkUrl: "",
            webUrl: query
        };
        var directRes = {
            filters: [],
            sections: [{ title: "Kết quả", layout: "list", items: [card] }],
            items: [card],
            next: null
        };
        cacheSet(cacheKey, directRes, 120000);
        return Response.success(directRes);
    }

    var offset = next ? (parseInt(next, 10) || 0) : 0;
    var limit = 20;

    var filters = [
        { title: "Tất cả", input: { query: query, filter: "all" } },
        { title: "Đài phát", input: { query: query, filter: "station" } },
        { title: "Thể loại", input: { query: query, filter: "tag" } },
        { title: "Quốc gia", input: { query: query, filter: "country" } }
    ];

    var path = "";
    if (filter === "tag") {
        path = "/json/tags/" + encodeURIComponent(query || "") + "?limit=" + limit + "&offset=" + offset + "&order=stationcount&reverse=true";
    } else if (filter === "country") {
        path = "/json/countries/" + encodeURIComponent(query || "") + "?limit=" + limit + "&offset=" + offset + "&order=stationcount&reverse=true";
    } else if (query) {
        path = "/json/stations/search?name=" + encodeURIComponent(query)
            + "&limit=" + limit
            + "&offset=" + offset
            + "&order=votes&reverse=true";
    } else {
        var country = "";
        try {
            if (typeof localConfig !== "undefined" && localConfig.getItem) {
                country = trimText(localConfig.getItem("country") || "");
            }
        } catch (e) {}

        if (country) {
            path = "/json/stations/bycountry/" + encodeURIComponent(country)
                + "?limit=" + limit
                + "&offset=" + offset
                + "&order=votes&reverse=true";
        } else {
            path = "/json/stations/topvote?limit=" + limit + "&offset=" + offset;
        }
    }

    var apiRes = fetchApi(path);
    if (!apiRes.ok || !Array.isArray(apiRes.data)) {
        return Response.error("Không thể kết nối đến hệ thống Radio Browser", { kind: ERROR_KIND.NETWORK });
    }

    var rawList = apiRes.data;
    var items = [];
    var seen = {};

    if (filter === "tag") {
        for (var i = 0; i < rawList.length; i++) {
            var tagCard = parseTagCard(rawList[i]);
            if (tagCard && !seen[tagCard.id]) {
                seen[tagCard.id] = true;
                items.push(tagCard);
            }
        }
    } else if (filter === "country") {
        for (var j = 0; j < rawList.length; j++) {
            var cCard = parseCountryCard(rawList[j]);
            if (cCard && !seen[cCard.id]) {
                seen[cCard.id] = true;
                items.push(cCard);
            }
        }
    } else {
        for (var k = 0; k < rawList.length; k++) {
            var sCard = parseRadioCard(rawList[k]);
            if (sCard && !seen[sCard.id]) {
                seen[sCard.id] = true;
                items.push(sCard);
            }
        }
    }

    var nextToken = (rawList.length >= limit) ? String(offset + limit) : null;
    var sections = [];
    if (items.length > 0) {
        var layout = (filter === "tag" || filter === "country") ? "grid" : "list";
        var title = filter === "tag" ? "Thể loại" : (filter === "country" ? "Quốc gia" : "Đài phát thanh");
        sections.push({
            title: title,
            layout: layout,
            items: items
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
