load("common.js");

var GENRES = [
    { title: "Electronic", group: "Thể loại", color: "#3b82f6", input: "Electronic", script: "genre.js" },
    { title: "Hip-Hop/Rap", group: "Thể loại", color: "#ef4444", input: "Hip-Hop/Rap", script: "genre.js" },
    { title: "Pop", group: "Thể loại", color: "#ec4899", input: "Pop", script: "genre.js" },
    { title: "R&B/Soul", group: "Thể loại", color: "#8b5cf6", input: "R&B/Soul", script: "genre.js" },
    { title: "Rock", group: "Thể loại", color: "#84cc16", input: "Rock", script: "genre.js" },
    { title: "Lo-Fi", group: "Tâm trạng", color: "#10b981", input: "Lo-Fi", script: "genre.js" },
    { title: "Trap", group: "Thể loại", color: "#f59e0b", input: "Trap", script: "genre.js" },
    { title: "Deep House", group: "Tâm trạng", color: "#06b6d4", input: "Deep House", script: "genre.js" },
    { title: "Ambient", group: "Tâm trạng", color: "#6366f1", input: "Ambient", script: "genre.js" },
    { title: "Techno", group: "Thể loại", color: "#1e293b", input: "Techno", script: "genre.js" }
];

function execute(input) {
    input = input || {};
    var genre = trimText(input.input || input.query || "");

    if (genre) {
        var appName = getAppName();
        var searchUrl = AUDIUS_API_BASE + "/v1/tracks/trending?genre=" + encodeURIComponent(genre)
            + "&limit=20&app_name=" + encodeURIComponent(appName);
        var rsp = fetch(searchUrl);
        var json = rsp.ok ? safeJsonParse(rsp.text()) : null;
        var items = [];
        if (json && Array.isArray(json.data)) {
            for (var i = 0; i < json.data.length; i++) {
                var c = parseTrackCard(json.data[i]);
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
