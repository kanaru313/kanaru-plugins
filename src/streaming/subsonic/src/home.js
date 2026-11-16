load("common.js");

function execute(input) {
    var cacheKey = "h:default";
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var sections = [];

    // 1. Mới thêm gần đây (recent)
    var recentRes = subsonicGet("getAlbumList2.view", { type: "recent", size: 20 });
    if (recentRes.data && recentRes.data.albumList2 && Array.isArray(recentRes.data.albumList2.album)) {
        var recentItems = [];
        var albums = recentRes.data.albumList2.album;
        for (var i = 0; i < albums.length; i++) {
            var card = parseAlbumCard(albums[i], recentRes.baseUrl, recentRes.auth);
            if (card) recentItems.push(card);
        }
        if (recentItems.length > 0) {
            sections.push({
                title: "Mới thêm gần đây",
                layout: "shelf",
                items: recentItems
            });
        }
    }

    // 2. Nghe nhiều nhất (frequent)
    var freqRes = subsonicGet("getAlbumList2.view", { type: "frequent", size: 20 });
    if (freqRes.data && freqRes.data.albumList2 && Array.isArray(freqRes.data.albumList2.album)) {
        var freqItems = [];
        var fAlbums = freqRes.data.albumList2.album;
        for (var j = 0; j < fAlbums.length; j++) {
            var fCard = parseAlbumCard(fAlbums[j], freqRes.baseUrl, freqRes.auth);
            if (fCard) freqItems.push(fCard);
        }
        if (freqItems.length > 0) {
            sections.push({
                title: "Nghe nhiều nhất",
                layout: "shelf",
                items: freqItems
            });
        }
    }

    // 3. Đánh dấu yêu thích (starred)
    var starredRes = subsonicGet("getAlbumList2.view", { type: "starred", size: 20 });
    if (starredRes.data && starredRes.data.albumList2 && Array.isArray(starredRes.data.albumList2.album)) {
        var starItems = [];
        var sAlbums = starredRes.data.albumList2.album;
        for (var k = 0; k < sAlbums.length; k++) {
            var sCard = parseAlbumCard(sAlbums[k], starredRes.baseUrl, starredRes.auth);
            if (sCard) starItems.push(sCard);
        }
        if (starItems.length > 0) {
            sections.push({
                title: "Album yêu thích",
                layout: "shelf",
                items: starItems
            });
        }
    }

    var result = {
        sections: sections,
        next: null
    };

    cacheSet(cacheKey, result, 120000);
    return Response.success(result);
}
