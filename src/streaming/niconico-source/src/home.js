load("common.js");

function execute() {
    var cached = cacheGet("home_feed");
    if (cached) {
        return Response.success(cached);
    }

    var sections = [];

    // 1. VOCALOID Hall of Fame
    var vocaUrl = "https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search?q=VOCALOID" +
        "&targets=tags&fields=contentId,title,lengthSeconds,thumbnailUrl,categoryTags,tags" +
        "&filters[tags][0]=VOCALOID&_sort=-viewCounter&_limit=8";
    var vocaWrap = nicoGet(vocaUrl);
    if (!vocaWrap.failure) {
        try {
            var j1 = vocaWrap.res.json();
            var d1 = (j1 && Array.isArray(j1.data)) ? j1.data : [];
            var vocaItems = [];
            for (var i = 0; i < d1.length; i++) {
                var c1 = parseNicoSnapshotItem(d1[i]);
                if (c1) vocaItems.push(c1);
            }
            if (vocaItems.length > 0) {
                sections.push({
                    title: "Bảng xếp hạng VOCALOID (Huyền thoại)",
                    layout: "grid",
                    items: vocaItems
                });
            }
        } catch (e1) {}
    }

    // 2. Utaite / Cover
    var utaUrl = "https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search?q=" + encodeURIComponent("歌ってみた") +
        "&targets=tags&fields=contentId,title,lengthSeconds,thumbnailUrl,categoryTags,tags" +
        "&filters[tags][0]=" + encodeURIComponent("歌ってみた") + "&_sort=-viewCounter&_limit=8";
    var utaWrap = nicoGet(utaUrl);
    if (!utaWrap.failure) {
        try {
            var j2 = utaWrap.res.json();
            var d2 = (j2 && Array.isArray(j2.data)) ? j2.data : [];
            var utaItems = [];
            for (var k = 0; k < d2.length; k++) {
                var c2 = parseNicoSnapshotItem(d2[k]);
                if (c2) utaItems.push(c2);
            }
            if (utaItems.length > 0) {
                sections.push({
                    title: "Utaite & Bản hát lại (歌ってみた)",
                    layout: "grid",
                    items: utaItems
                });
            }
        } catch (e2) {}
    }

    // 3. Touhou Project
    var touhouUrl = "https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search?q=" + encodeURIComponent("東方") +
        "&targets=tags&fields=contentId,title,lengthSeconds,thumbnailUrl,categoryTags,tags" +
        "&filters[tags][0]=" + encodeURIComponent("東方") + "&_sort=-viewCounter&_limit=8";
    var touhouWrap = nicoGet(touhouUrl);
    if (!touhouWrap.failure) {
        try {
            var j3 = touhouWrap.res.json();
            var d3 = (j3 && Array.isArray(j3.data)) ? j3.data : [];
            var touhouItems = [];
            for (var m = 0; m < d3.length; m++) {
                var c3 = parseNicoSnapshotItem(d3[m]);
                if (c3) touhouItems.push(c3);
            }
            if (touhouItems.length > 0) {
                sections.push({
                    title: "Touhou Project & Doujin Music (東方)",
                    layout: "list",
                    items: touhouItems
                });
            }
        } catch (e3) {}
    }

    var result = { sections: sections };
    cacheSet("home_feed", result, 300000);
    return Response.success(result);
}
