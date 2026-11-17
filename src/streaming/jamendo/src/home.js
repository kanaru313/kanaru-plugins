load("common.js");

function execute() {
    var cached = cacheGet("home_feed");
    if (cached) {
        return Response.success(cached);
    }

    var quality = getAudioQuality();
    var sections = [];

    // 1. Weekly Hot
    var hotWrap = jamendoGet("tracks/", {
        order: "popularity_week",
        limit: 10,
        audioformat: quality
    });
    if (!hotWrap.failure) {
        var hotList = (hotWrap.json && Array.isArray(hotWrap.json.results)) ? hotWrap.json.results : [];
        var hotItems = [];
        for (var i = 0; i < hotList.length; i++) {
            var c1 = parseJamendoTrack(hotList[i]);
            if (c1) hotItems.push(c1);
        }
        if (hotItems.length > 0) {
            sections.push({
                title: "Thịnh hành trong tuần (Jamendo Hot)",
                layout: "grid",
                items: hotItems
            });
        }
    }

    // 2. Acoustic & Indie
    var acWrap = jamendoGet("tracks/", {
        fuzzytags: "acoustic",
        order: "popularity_month",
        limit: 8,
        audioformat: quality
    });
    if (!acWrap.failure) {
        var acList = (acWrap.json && Array.isArray(acWrap.json.results)) ? acWrap.json.results : [];
        var acItems = [];
        for (var j = 0; j < acList.length; j++) {
            var c2 = parseJamendoTrack(acList[j]);
            if (c2) acItems.push(c2);
        }
        if (acItems.length > 0) {
            sections.push({
                title: "Acoustic & Indie chọn lọc",
                layout: "list",
                items: acItems
            });
        }
    }

    // 3. Electronic & Chillout
    var elWrap = jamendoGet("tracks/", {
        fuzzytags: "chillout",
        order: "popularity_total",
        limit: 8,
        audioformat: quality
    });
    if (!elWrap.failure) {
        var elList = (elWrap.json && Array.isArray(elWrap.json.results)) ? elWrap.json.results : [];
        var elItems = [];
        for (var k = 0; k < elList.length; k++) {
            var c3 = parseJamendoTrack(elList[k]);
            if (c3) elItems.push(c3);
        }
        if (elItems.length > 0) {
            sections.push({
                title: "Chillout & Thư giãn",
                layout: "grid",
                items: elItems
            });
        }
    }

    var result = { sections: sections };
    cacheSet("home_feed", result, 300000);
    return Response.success(result);
}
