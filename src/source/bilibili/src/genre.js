load("common.js");

var GENRES = [
    { title: "Nhạc gốc (原创音乐)", group: "Thể loại", color: "#3b82f6", input: "原创音乐", script: "genre.js" },
    { title: "Cover (翻唱)", group: "Thể loại", color: "#ec4899", input: "翻唱", script: "genre.js" },
    { title: "VOCALOID", group: "Thể loại", color: "#06b6d4", input: "VOCALOID", script: "genre.js" },
    { title: "Anime Song (动漫音乐)", group: "Thể loại", color: "#f59e0b", input: "动漫音乐", script: "genre.js" },
    { title: "Biểu diễn Live (演奏)", group: "Thể loại", color: "#84cc16", input: "音乐现场", script: "genre.js" },
    { title: "Electronic (电音)", group: "Thể loại", color: "#8b5cf6", input: "电音", script: "genre.js" },
    { title: "BGM & Nhạc phim", group: "Tâm trạng", color: "#10b981", input: "影视BGM", script: "genre.js" },
    { title: "Lofi / Relax", group: "Tâm trạng", color: "#6366f1", input: "治愈音乐", script: "genre.js" }
];

function execute(input) {
    input = input || {};
    var genre = trimText(input.input || input.query || "");

    if (genre) {
        var searchUrl = BILI_API_BASE + "/x/web-interface/search/type?search_type=video&keyword=" + encodeURIComponent(genre) + "&page=1&page_size=20";
        var rsp = fetchBili(searchUrl);
        var json = rsp.ok ? safeJsonParse(rsp.text()) : null;
        var items = [];
        if (json && json.data && Array.isArray(json.data.result)) {
            for (var i = 0; i < json.data.result.length; i++) {
                var c = parseTrackCard(json.data.result[i]);
                if (c) items.push(c);
            }
        }
        return Response.success({
            sections: [
                {
                    title: genre,
                    layout: "list",
                    items: items
                }
            ],
            next: null
        });
    }

    return Response.success(GENRES);
}
