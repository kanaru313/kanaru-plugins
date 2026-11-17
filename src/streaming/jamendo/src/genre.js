load("common.js");

var GENRE_LIST = [
    { id: "pop", title: "Pop & R&B" },
    { id: "rock", title: "Rock & Alternative" },
    { id: "electronic", title: "Electronic & Dance" },
    { id: "hiphop", title: "Hip-Hop & Rap" },
    { id: "jazz", title: "Jazz & Blues" },
    { id: "classical", title: "Cổ điển (Classical)" },
    { id: "chillout", title: "Chillout & Lofi" },
    { id: "ambient", title: "Ambient & Không gian" },
    { id: "soundtrack", title: "Nhạc phim (Soundtrack)" },
    { id: "metal", title: "Metal & Hardcore" }
];

function execute(input) {
    input = input || {};
    var genreId = trimText((typeof input === "string") ? input : (input.id || input.genre || ""));

    if (!genreId) {
        var catalog = [];
        for (var i = 0; i < GENRE_LIST.length; i++) {
            catalog.push({
                id: GENRE_LIST[i].id,
                title: GENRE_LIST[i].title,
                artworkUrl: "https://www.jamendo.com/images/genres/" + GENRE_LIST[i].id + ".jpg"
            });
        }
        return Response.success({ items: catalog });
    }

    var selectedTitle = genreId;
    for (var j = 0; j < GENRE_LIST.length; j++) {
        if (GENRE_LIST[j].id === genreId) {
            selectedTitle = GENRE_LIST[j].title;
            break;
        }
    }

    var next = input.next || "";
    var offset = next ? (parseInt(next, 10) || 0) : 0;
    var cacheKey = "genre:" + genreId + ":" + offset;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var fetchWrap = jamendoGet("tracks/", {
        fuzzytags: genreId,
        limit: 20,
        offset: offset,
        order: "popularity_total",
        audioformat: getAudioQuality()
    });
    if (fetchWrap.failure) return fetchWrap.failure;

    var rawTracks = (fetchWrap.json && Array.isArray(fetchWrap.json.results)) ? fetchWrap.json.results : [];
    var items = [];

    for (var k = 0; k < rawTracks.length; k++) {
        var c = parseJamendoTrack(rawTracks[k]);
        if (c) items.push(c);
    }

    var result = {
        id: genreId,
        title: selectedTitle,
        items: items,
        next: rawTracks.length >= 20 ? String(offset + 20) : null
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
