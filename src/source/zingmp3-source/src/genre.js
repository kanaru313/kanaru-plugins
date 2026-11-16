load("common.js");

var GENRES = [
    { title: "V-Pop", group: "Thể loại", color: "#e11d48", input: "V-Pop", script: "genre.js" },
    { title: "Nhạc Trẻ", group: "Thể loại", color: "#ec4899", input: "Nhạc Trẻ", script: "genre.js" },
    { title: "Rap Việt", group: "Thể loại", color: "#ef4444", input: "Rap Việt", script: "genre.js" },
    { title: "Bolero", group: "Thể loại", color: "#8b5cf6", input: "Bolero", script: "genre.js" },
    { title: "US-UK", group: "Thể loại", color: "#3b82f6", input: "US-UK", script: "genre.js" },
    { title: "K-Pop", group: "Thể loại", color: "#06b6d4", input: "K-Pop", script: "genre.js" },
    { title: "EDM", group: "Thể loại", color: "#f59e0b", input: "EDM", script: "genre.js" },
    { title: "Acoustic", group: "Tâm trạng", color: "#10b981", input: "Acoustic", script: "genre.js" },
    { title: "Lofi Chill", group: "Tâm trạng", color: "#6366f1", input: "Lofi", script: "genre.js" },
    { title: "Cà Phê Sáng", group: "Tâm trạng", color: "#b45309", input: "Cà phê sáng", script: "genre.js" }
];

function execute(input) {
    input = input || {};
    var genre = trimText(input.input || input.query || "");

    if (genre) {
        var res = zingGet("/search/multi", { q: genre });
        var songs = [];
        if (!res.failure && res.data && Array.isArray(res.data.songs)) {
            for (var i = 0; i < res.data.songs.length; i++) {
                var c = parseTrackCard(res.data.songs[i]);
                if (c) songs.push(c);
            }
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
