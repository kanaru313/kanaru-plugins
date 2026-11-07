load("common.js");

function execute(input) {
    var cacheKey = "home";
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var res = zingGet("/page/get/home", { page: "1", segment: "1", count: "30" });
    if (res.failure) {
        return res.failure;
    }

    var rawSections = res.data && Array.isArray(res.data.items) ? res.data.items : [];
    var sections = [];

    for (var i = 0; i < rawSections.length; i++) {
        var s = rawSections[i];
        if (!s || !s.title || !Array.isArray(s.items) || s.items.length === 0) continue;

        var items = [];
        var layout = "shelf";

        if (s.sectionType === "newReleaseChart" || s.sectionType === "song") {
            layout = "list";
            for (var j = 0; j < s.items.length; j++) {
                var tCard = parseTrackCard(s.items[j]);
                if (tCard) items.push(tCard);
            }
        } else if (s.sectionType === "playlist" || s.sectionType === "album") {
            layout = "shelf";
            for (var k = 0; k < s.items.length; k++) {
                var pCard = parsePlaylistCard(s.items[k]);
                if (pCard) items.push(pCard);
            }
        }

        if (items.length > 0) {
            sections.push({
                title: s.title,
                layout: layout,
                items: items
            });
        }
    }

    var page = {
        sections: sections,
        next: null
    };

    cacheSet(cacheKey, page, 300000);
    return Response.success(page);
}
