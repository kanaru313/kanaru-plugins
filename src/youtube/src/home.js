load("common.js");

function execute(input) {
    var cacheKey = "home";
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var browseUrl = YT_BASE + "/youtubei/v1/browse?prettyPrint=false";
    var body = {
        browseId: "UC-9-kyTW8ZkZNDHQJ6FgpwQ", // YouTube Music Topic
        context: {
            client: {
                clientName: "WEB",
                clientVersion: "2.20260320.01.00",
                hl: YT_PREFERRED_HL,
                gl: YT_PREFERRED_GL
            }
        }
    };

    var rsp = fetch(browseUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Origin": YT_BASE,
            "Referer": YT_BASE + "/"
        },
        body: JSON.stringify(body)
    });

    if (!rsp.ok) {
        return Response.error("Không tải được trang chủ YouTube (" + rsp.status + ")", { kind: ERROR_KIND.NETWORK });
    }

    var json = safeJsonParse(rsp.text());
    if (!json) {
        return Response.error("Dữ liệu trang chủ YouTube không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var sections = [];
    var richSections = collectRenderers(json, "richSectionRenderer");

    for (var i = 0; i < richSections.length; i++) {
        var rs = richSections[i];
        var shelf = rs.content ? rs.content.richShelfRenderer : null;
        if (!shelf) continue;

        var title = getTextValue(shelf.title) || "Nổi bật";
        var contents = shelf.contents || [];
        var items = [];
        var seen = {};

        for (var j = 0; j < contents.length; j++) {
            var item = contents[j];
            var lockup = item.richItemRenderer && item.richItemRenderer.content ? item.richItemRenderer.content.lockupViewModel : null;
            if (lockup) {
                var card = parseCardFromLockup(lockup);
                if (card && !seen[card.id]) {
                    seen[card.id] = true;
                    items.push(card);
                }
            }
        }

        if (items.length > 0) {
            sections.push({
                title: title,
                layout: i === 0 ? "list" : "shelf",
                items: items
            });
        }
    }

    // Fallback if richSectionRenderer changed
    if (sections.length === 0) {
        var parsed = parseCardsFromInitialData(json);
        if (parsed.items.length > 0) {
            sections.push({
                title: "Thịnh hành âm nhạc",
                layout: "list",
                items: parsed.items.slice(0, 20)
            });
        }
    }

    var page = {
        sections: sections,
        next: null
    };

    cacheSet(cacheKey, page, 300000); // Cache 5 minutes
    return Response.success(page);
}
