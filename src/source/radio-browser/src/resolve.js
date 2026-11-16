load("common.js");

function execute(input) {
    input = input || {};
    var url = trimText(input.url || input.query || input.id || "");
    if (!url) {
        return Response.error("Thiếu URL hoặc ID cần resolve", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "res:" + url;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // UUID extract: 8-4-4-4-12 hex format or alphanumeric uuid
    var uuidMatch = url.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
    var uuid = uuidMatch ? uuidMatch[1] : "";

    if (!uuid && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(url)) {
        uuid = url;
    }

    if (uuid) {
        var stRes = fetchApi("/json/stations/byuuid?uuids=" + encodeURIComponent(uuid));
        if (stRes.ok && Array.isArray(stRes.data) && stRes.data.length > 0) {
            var card = parseRadioCard(stRes.data[0]);
            if (card) {
                cacheSet(cacheKey, card, 300000);
                return Response.success(card);
            }
        }
    }

    // Direct HTTP live stream URL
    if (/^https?:\/\//i.test(url)) {
        // Check if it's already an active station URL in radio browser
        var byUrlRes = fetchApi("/json/stations/byurl?url=" + encodeURIComponent(url));
        if (byUrlRes.ok && Array.isArray(byUrlRes.data) && byUrlRes.data.length > 0) {
            var sCard = parseRadioCard(byUrlRes.data[0]);
            if (sCard) {
                cacheSet(cacheKey, sCard, 300000);
                return Response.success(sCard);
            }
        }

        var directCard = {
            kind: "track",
            id: url,
            title: "Đài phát thanh trực tiếp",
            subtitle: "Live Audio Stream",
            artist: "Live Audio Stream",
            artists: [{ id: "", title: "Live Audio Stream" }],
            durationMs: 0,
            artworkUrl: "",
            webUrl: url
        };
        cacheSet(cacheKey, directCard, 300000);
        return Response.success(directCard);
    }

    return Response.error("Không tìm thấy đài phát thanh tương ứng với URL: " + url, { kind: ERROR_KIND.UNAVAILABLE });
}
