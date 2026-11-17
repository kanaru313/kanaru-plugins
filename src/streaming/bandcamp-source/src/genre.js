load("common.js");

var GENRE_LIST = [
    { id: "lofi", title: "Lofi & Chillhop" },
    { id: "synthwave", title: "Synthwave & Retrowave" },
    { id: "indie", title: "Indie Rock & Pop" },
    { id: "ambient", title: "Ambient & Drone" },
    { id: "soundtrack", title: "Game OST & Soundtrack" },
    { id: "electronic", title: "Electronic & IDM" },
    { id: "metal", title: "Metal & Post-Metal" },
    { id: "punk", title: "Punk & Post-Punk" }
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
                artworkUrl: "https://bandcamp.com/img/favicon/apple-touch-icon-180x180.png"
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

    var cacheKey = "genre:" + genreId;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var searchUrl = "https://bandcamp.com/api/fuzzysearch/2/app_autocomplete?q=" + encodeURIComponent(genreId);
    var fetchWrap = bandcampGet(searchUrl);
    if (fetchWrap.failure) return fetchWrap.failure;

    var json = null;
    try {
        json = fetchWrap.res.json();
    } catch (e) {
        return Response.error("Phản hồi danh mục Bandcamp không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var rawResults = (json && Array.isArray(json.results)) ? json.results : [];
    var items = [];

    for (var k = 0; k < rawResults.length; k++) {
        var card = parseBandcampSearchItem(rawResults[k]);
        if (card) items.push(card);
    }

    var result = {
        id: genreId,
        title: selectedTitle,
        items: items
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
