load("common.js");

var GENRES = [
    { title: "Electronic", group: "Thể loại", color: "#3b82f6", input: "electronic", script: "genre.js" },
    { title: "Dance & EDM", group: "Thể loại", color: "#f59e0b", input: "edm", script: "genre.js" },
    { title: "Hip-Hop & Rap", group: "Thể loại", color: "#ef4444", input: "hiphop", script: "genre.js" },
    { title: "Pop", group: "Thể loại", color: "#ec4899", input: "pop", script: "genre.js" },
    { title: "R&B & Soul", group: "Thể loại", color: "#8b5cf6", input: "r&b", script: "genre.js" },
    { title: "Rock", group: "Thể loại", color: "#84cc16", input: "rock", script: "genre.js" },
    { title: "Deep House", group: "Tâm trạng", color: "#06b6d4", input: "deep house", script: "genre.js" },
    { title: "Lo-fi Chill", group: "Tâm trạng", color: "#10b981", input: "lofi", script: "genre.js" },
    { title: "Ambient", group: "Tâm trạng", color: "#6366f1", input: "ambient", script: "genre.js" },
    { title: "Piano", group: "Tâm trạng", color: "#64748b", input: "piano solo", script: "genre.js" }
];

function execute(input) {
    input = input || {};
    var genre = trimText(input.input || input.query || "");

    if (genre) {
        var searchUrl = SC_API_BASE + "/search/tracks?q=" + encodeURIComponent(genre) + "&limit=20";
        var rsp = fetchWithAuth(searchUrl);
        var json = rsp.ok ? safeJsonParse(rsp.text()) : null;
        var items = [];
        if (json && Array.isArray(json.collection)) {
            for (var i = 0; i < json.collection.length; i++) {
                var c = parseTrackCard(json.collection[i]);
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
