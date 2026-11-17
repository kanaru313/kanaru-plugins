load("common.js");

function execute(input) {
    input = input || {};
    var rawId = (typeof input === "string") ? input : (input.id || "");
    var artistName = trimText(rawId);

    if (!artistName) {
        return Response.error("Thiếu thông tin nghệ sĩ Internet Archive", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var next = input.next || "";
    var page = next ? (parseInt(next, 10) || 1) : 1;
    var cacheKey = "artist:" + artistName + ":" + page;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var safeArtist = artistName.replace(/[^\w\s\u00C0-\u024F\u1EA0-\u1EF9]/gi, " ").trim();
    var query = 'mediatype:(audio) AND format:(MP3) AND (creator:("' + (safeArtist || artistName) + '") OR "' + (safeArtist || artistName) + '")';
    var searchUrl = "https://archive.org/advancedsearch.php?q=" + encodeURIComponent(query) +
        "&fl[]=identifier,title,creator,year,downloads&sort[]=downloads+desc&rows=20&page=" + page + "&output=json";

    var resWrap = archiveGet(searchUrl);
    if (resWrap.failure) return resWrap.failure;

    var json = null;
    try {
        json = resWrap.res.json();
    } catch (e) {
        return Response.error("Phản hồi thông tin nghệ sĩ không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var docs = (json && json.response && Array.isArray(json.response.docs)) ? json.response.docs : [];
    var items = [];
    var seen = {};

    for (var i = 0; i < docs.length; i++) {
        var card = parseArchiveDoc(docs[i]);
        if (card && !seen[card.id]) {
            seen[card.id] = true;
            items.push(card);
        }
    }

    var firstDoc = docs[0];
    var artworkUrl = firstDoc ? ("https://archive.org/services/img/" + encodeURIComponent(firstDoc.identifier)) : "";

    var result = {
        kind: "artist",
        id: artistName,
        title: artistName,
        artworkUrl: artworkUrl,
        items: items,
        next: docs.length >= 20 ? String(page + 1) : null
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
