load("common.js");

function execute(input) {
    var cacheKey = "home";
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var res = nctGet("/app/playlist/top-100");
    if (res.failure) return res.failure;

    var rawAreas = Array.isArray(res.data) ? res.data : [];
    var sections = [];

    for (var i = 0; i < rawAreas.length; i++) {
        var area = rawAreas[i];
        if (!area || !Array.isArray(area.data) || !area.data.length) continue;

        var items = [];
        for (var j = 0; j < area.data.length; j++) {
            var pl = parsePlaylistCard(area.data[j]);
            if (pl) items.push(pl);
        }

        if (items.length) {
            sections.push({
                title: "Bảng xếp hạng Top 100 · " + (area.area || "Thịnh hành"),
                layout: "shelf",
                items: items
            });
        }
    }

    // Fallback if top-100 is empty: query search top
    if (!sections.length) {
        var fallbackRes = nctGet("/search/all", { keyword: "top" });
        if (!fallbackRes.failure && fallbackRes.data) {
            var fallbackPl = Array.isArray(fallbackRes.data.playlists) ? fallbackRes.data.playlists : [];
            var fbItems = [];
            for (var k = 0; k < fallbackPl.length; k++) {
                var fbc = parsePlaylistCard(fallbackPl[k]);
                if (fbc) fbItems.push(fbc);
            }
            if (fbItems.length) {
                sections.push({
                    title: "Bảng xếp hạng & Tuyển tập",
                    layout: "shelf",
                    items: fbItems
                });
            }
        }
    }

    var result = {
        sections: sections
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
