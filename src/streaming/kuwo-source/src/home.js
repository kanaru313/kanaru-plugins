load("common.js");

function execute(input) {
    var cacheKey = "home";
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var queries = [
        { label: "Bảng xếp hạng Hot · 热歌榜", query: "热歌" },
        { label: "Thịnh hành Douyin · 抖音热歌", query: "抖音" },
        { label: "Nhạc Hoa Bất hủ · 经典老歌", query: "经典" },
        { label: "Anime & ACG · 动漫原声", query: "动漫" }
    ];

    var sections = [];

    for (var i = 0; i < queries.length; i++) {
        var item = queries[i];
        var searchUrl = "https://search.kuwo.cn/r.s?client=kt&all=" + encodeURIComponent(item.query) +
            "&pn=0&rn=12&vipver=1&ft=music&encoding=utf8&rformat=json&mobi=1";

        var resWrap = kuwoGet(searchUrl);
        if (!resWrap.failure && resWrap.res) {
            try {
                var json = resWrap.res.json();
                var abslist = (json && Array.isArray(json.abslist)) ? json.abslist : [];
                var cards = [];
                for (var j = 0; j < abslist.length; j++) {
                    var card = parseTrackCard(abslist[j]);
                    if (card) cards.push(card);
                }
                if (cards.length) {
                    sections.push({
                        title: item.label,
                        layout: "shelf",
                        items: cards
                    });
                }
            } catch (e) {}
        }
    }

    var result = {
        sections: sections
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
