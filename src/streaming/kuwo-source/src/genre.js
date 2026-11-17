load("common.js");

var GENRES = [
    { title: "C-Pop (华语)", group: "Khu vực", color: "#e11d48", input: "华语", script: "genre.js" },
    { title: "Cổ phong (古风)", group: "Khu vực", color: "#d97706", input: "古风", script: "genre.js" },
    { title: "J-Pop & Anime", group: "Khu vực", color: "#ec4899", input: "动漫", script: "genre.js" },
    { title: "K-Pop (韩语)", group: "Khu vực", color: "#06b6d4", input: "韩语", script: "genre.js" },
    { title: "US-UK (欧美)", group: "Khu vực", color: "#3b82f6", input: "欧美", script: "genre.js" },
    { title: "Trữ tình (抒情)", group: "Thể loại", color: "#8b5cf6", input: "抒情", script: "genre.js" },
    { title: "Rock (摇滚)", group: "Thể loại", color: "#ef4444", input: "摇滚", script: "genre.js" },
    { title: "EDM (电音)", group: "Thể loại", color: "#10b981", input: "电音", script: "genre.js" },
    { title: "Lofi & Nhẹ nhàng", group: "Tâm trạng", color: "#6366f1", input: "轻音乐", script: "genre.js" }
];

function execute(input) {
    input = input || {};
    var genre = trimText(input.input || input.query || "");

    if (genre) {
        var searchUrl = "https://search.kuwo.cn/r.s?client=kt&all=" + encodeURIComponent(genre) +
            "&pn=0&rn=25&vipver=1&ft=music&encoding=utf8&rformat=json&mobi=1";

        var resWrap = kuwoGet(searchUrl);
        var songs = [];
        if (!resWrap.failure && resWrap.res) {
            try {
                var json = resWrap.res.json();
                var abslist = (json && Array.isArray(json.abslist)) ? json.abslist : [];
                for (var i = 0; i < abslist.length; i++) {
                    var card = parseTrackCard(abslist[i]);
                    if (card) songs.push(card);
                }
            } catch (e) {}
        }
        return Response.success({
            sections: [
                {
                    title: genre,
                    layout: "list",
                    items: songs
                }
            ],
            next: null
        });
    }

    return Response.success(GENRES);
}
