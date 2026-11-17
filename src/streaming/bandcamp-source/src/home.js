load("common.js");

function execute() {
    var cached = cacheGet("home_feed");
    if (cached) {
        return Response.success(cached);
    }

    var sections = [];

    // 1. Lofi & Chill
    var lofiUrl = "https://bandcamp.com/api/fuzzysearch/2/app_autocomplete?q=lofi";
    var lofiWrap = bandcampGet(lofiUrl);
    if (!lofiWrap.failure) {
        try {
            var j1 = lofiWrap.res.json();
            var res1 = (j1 && Array.isArray(j1.results)) ? j1.results : [];
            var lofiItems = [];
            for (var i = 0; i < res1.length && lofiItems.length < 8; i++) {
                if (res1[i].type === "a" || res1[i].type === "t") {
                    var c1 = parseBandcampSearchItem(res1[i]);
                    if (c1) lofiItems.push(c1);
                }
            }
            if (lofiItems.length > 0) {
                sections.push({
                    title: "Lofi Hip Hop & Chill Beats",
                    layout: "grid",
                    items: lofiItems
                });
            }
        } catch (e) {}
    }

    // 2. Synthwave
    var synthUrl = "https://bandcamp.com/api/fuzzysearch/2/app_autocomplete?q=synthwave";
    var synthWrap = bandcampGet(synthUrl);
    if (!synthWrap.failure) {
        try {
            var j2 = synthWrap.res.json();
            var res2 = (j2 && Array.isArray(j2.results)) ? j2.results : [];
            var synthItems = [];
            for (var k = 0; k < res2.length && synthItems.length < 8; k++) {
                if (res2[k].type === "a" || res2[k].type === "t") {
                    var c2 = parseBandcampSearchItem(res2[k]);
                    if (c2) synthItems.push(c2);
                }
            }
            if (synthItems.length > 0) {
                sections.push({
                    title: "Synthwave & Cyberpunk",
                    layout: "grid",
                    items: synthItems
                });
            }
        } catch (e2) {}
    }

    // 3. Game OST
    var gameUrl = "https://bandcamp.com/api/fuzzysearch/2/app_autocomplete?q=game+soundtrack";
    var gameWrap = bandcampGet(gameUrl);
    if (!gameWrap.failure) {
        try {
            var j3 = gameWrap.res.json();
            var res3 = (j3 && Array.isArray(j3.results)) ? j3.results : [];
            var gameItems = [];
            for (var m = 0; m < res3.length && gameItems.length < 8; m++) {
                if (res3[m].type === "a" || res3[m].type === "t") {
                    var c3 = parseBandcampSearchItem(res3[m]);
                    if (c3) gameItems.push(c3);
                }
            }
            if (gameItems.length > 0) {
                sections.push({
                    title: "Game OST & Chiptune",
                    layout: "list",
                    items: gameItems
                });
            }
        } catch (e3) {}
    }

    var result = { sections: sections };
    cacheSet("home_feed", result, 300000);
    return Response.success(result);
}
