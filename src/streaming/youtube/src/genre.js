load("common.js");

var GENRES = [
    { title: "V-Pop", group: "Thể loại", color: "#e11d48", input: "Nhạc Trẻ V-Pop", script: "genre.js" },
    { title: "K-Pop", group: "Thể loại", color: "#ec4899", input: "K-Pop hits", script: "genre.js" },
    { title: "US-UK", group: "Thể loại", color: "#3b82f6", input: "US-UK top hits", script: "genre.js" },
    { title: "EDM", group: "Thể loại", color: "#f59e0b", input: "EDM festival hits", script: "genre.js" },
    { title: "Rap Việt", group: "Thể loại", color: "#ef4444", input: "Rap Việt hot", script: "genre.js" },
    { title: "Bolero", group: "Thể loại", color: "#6366f1", input: "Tuyệt phẩm Bolero", script: "genre.js" },
    { title: "Rock", group: "Thể loại", color: "#84cc16", input: "Rock hits", script: "genre.js" },
    { title: "Lofi Chill", group: "Tâm trạng", color: "#8b5cf6", input: "Lofi chill beats", script: "genre.js" },
    { title: "Acoustic", group: "Tâm trạng", color: "#10b981", input: "Nhạc Acoustic thư giãn", script: "genre.js" },
    { title: "Tập trung", group: "Tâm trạng", color: "#06b6d4", input: "Nhạc tập trung làm việc", script: "genre.js" },
    { title: "Giấc ngủ", group: "Tâm trạng", color: "#1e293b", input: "Nhạc ngủ êm dịu", script: "genre.js" },
    { title: "Tập luyện", group: "Tâm trạng", color: "#f97316", input: "Workout gym motivation music", script: "genre.js" }
];

function execute(input) {
    input = input || {};

    // If called with {input: "..."} to view a specific genre
    var genreQuery = trimText(input.input || input.query || "");
    if (genreQuery) {
        var searchUrl = YT_BASE + "/results?search_query=" + encodeURIComponent(genreQuery) + "&hl=" + YT_PREFERRED_HL + "&gl=" + YT_PREFERRED_GL;
        var searchRsp = fetch(searchUrl, { headers: buildPreferredHeaders() });
        var searchHtml = searchRsp.text();
        var initialData = extractInitialDataFromHtml(searchHtml);
        var parsed = initialData ? parseCardsFromInitialData(initialData) : { items: [], next: null };

        return Response.success({
            sections: [
                {
                    title: genreQuery,
                    layout: "list",
                    items: parsed.items
                }
            ],
            next: parsed.next
        });
    }

    // Default: Return genre list
    return Response.success(GENRES);
}
