load("common.js");

var GENRE_LIST = [
    { id: "vocaloid", title: "VOCALOID (初音ミク)", tag: "VOCALOID" },
    { id: "utaite", title: "Utaite (歌ってみた)", tag: "歌ってみた" },
    { id: "touhou", title: "Touhou Project (東方)", tag: "東方" },
    { id: "music", title: "Âm nhạc chung (音楽)", tag: "音楽" },
    { id: "doujin", title: "Doujin Music (同人音楽)", tag: "同人音楽" },
    { id: "anime", title: "Anime Song (アニメ)", tag: "アニメ" },
    { id: "game", title: "Game BGM (ゲーム)", tag: "ゲーム" }
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
                artworkUrl: "https://nicovideo.cdn.nimg.jp/web/images/favicon/192.png"
            });
        }
        return Response.success({ items: catalog });
    }

    var selectedTag = genreId;
    var selectedTitle = genreId;
    for (var j = 0; j < GENRE_LIST.length; j++) {
        if (GENRE_LIST[j].id === genreId) {
            selectedTag = GENRE_LIST[j].tag;
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

    var url = "https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search?q=" + encodeURIComponent(selectedTag) +
        "&targets=tags&fields=contentId,title,lengthSeconds,thumbnailUrl,categoryTags,tags" +
        "&filters[tags][0]=" + encodeURIComponent(selectedTag) +
        "&_sort=-viewCounter&_limit=20&_offset=" + offset;

    var fetchWrap = nicoGet(url);
    if (fetchWrap.failure) return fetchWrap.failure;

    var json = null;
    try {
        json = fetchWrap.res.json();
    } catch (e) {
        return Response.error("Phản hồi danh mục NicoNico không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var rawData = (json && Array.isArray(json.data)) ? json.data : [];
    var items = [];

    for (var k = 0; k < rawData.length; k++) {
        var card = parseNicoSnapshotItem(rawData[k]);
        if (card) items.push(card);
    }

    var result = {
        id: genreId,
        title: selectedTitle,
        items: items,
        next: rawData.length >= 20 ? String(offset + 20) : null
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
