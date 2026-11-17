load("common.js");

var GENRE_LIST = [
    { id: "etree", title: "Live Concerts (Etree)", query: "collection:(etree)" },
    { id: "78rpm", title: "The Great 78 Project (Đĩa than)", query: "collection:(georgeblood)" },
    { id: "classical", title: "Nhạc cổ điển", query: "collection:(classical_music)" },
    { id: "oldtimeradio", title: "Old Time Radio", query: "collection:(oldtimeradio)" },
    { id: "audiobooks", title: "Sách nói & Văn học", query: "collection:(audio_bookspoetry)" },
    { id: "netlabels", title: "Netlabels & Electronic", query: "collection:(netlabels)" }
];

function execute(input) {
    input = input || {};
    var genreId = trimText((typeof input === "string") ? input : (input.id || input.genre || ""));

    // If no genre requested, return catalog
    if (!genreId) {
        var catalog = [];
        for (var i = 0; i < GENRE_LIST.length; i++) {
            catalog.push({
                id: GENRE_LIST[i].id,
                title: GENRE_LIST[i].title,
                artworkUrl: "https://archive.org/images/ia-logo.png"
            });
        }
        return Response.success({ items: catalog });
    }

    var selected = null;
    for (var j = 0; j < GENRE_LIST.length; j++) {
        if (GENRE_LIST[j].id === genreId) {
            selected = GENRE_LIST[j];
            break;
        }
    }
    if (!selected) {
        selected = { id: genreId, title: genreId, query: "collection:(" + genreId + ")" };
    }

    var next = input.next || "";
    var page = next ? (parseInt(next, 10) || 1) : 1;
    var cacheKey = "genre:" + genreId + ":" + page;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var query = selected.query + " AND format:(MP3)";
    var url = "https://archive.org/advancedsearch.php?q=" + encodeURIComponent(query) +
        "&fl[]=identifier,title,creator,year,downloads&sort[]=downloads+desc&rows=20&page=" + page + "&output=json";

    var resWrap = archiveGet(url);
    if (resWrap.failure) return resWrap.failure;

    var json = null;
    try {
        json = resWrap.res.json();
    } catch (e) {
        return Response.error("Phản hồi danh mục Internet Archive không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var docs = (json && json.response && Array.isArray(json.response.docs)) ? json.response.docs : [];
    var items = [];
    var seen = {};

    for (var k = 0; k < docs.length; k++) {
        var card = parseArchiveDoc(docs[k]);
        if (card && !seen[card.id]) {
            seen[card.id] = true;
            items.push(card);
        }
    }

    var result = {
        id: selected.id,
        title: selected.title,
        items: items,
        next: docs.length >= 20 ? String(page + 1) : null
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
