load("common.js");

function execute(input) {
    input = input || {};
    var id = trimText(input.id || "");
    if (!id) {
        return Response.error("Thiếu mã bài hát (id)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "rel:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var nextUrl = YT_BASE + "/youtubei/v1/next?prettyPrint=false";
    var body = {
        videoId: id,
        context: {
            client: {
                clientName: "WEB",
                clientVersion: "2.20260320.01.00",
                hl: YT_PREFERRED_HL,
                gl: YT_PREFERRED_GL
            }
        }
    };

    var rsp = fetch(nextUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Origin": YT_BASE,
            "Referer": YT_BASE + "/"
        },
        body: JSON.stringify(body)
    });

    if (!rsp.ok) {
        return Response.error("Không lấy được bài hát liên quan (" + rsp.status + ")", { kind: ERROR_KIND.NETWORK });
    }

    var json = safeJsonParse(rsp.text());
    if (!json) {
        return Response.error("Dữ liệu liên quan không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var parsed = parseCardsFromInitialData(json);
    var trackItems = parsed.items.filter(function(x) { return x.kind === "track" && x.id !== id; });

    var result = {
        items: trackItems,
        next: parsed.next
    };

    cacheSet(cacheKey, result, 120000);
    return Response.success(result);
}
