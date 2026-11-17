load("common.js");

function execute(input) {
    input = input || {};
    var rawId = (typeof input === "string") ? input : (input.id || "");
    var parsed = extractArchiveId(rawId);

    if (!parsed.identifier) {
        return Response.error("Thiếu mã bản ghi Internet Archive", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "rel:" + parsed.identifier;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // First fetch metadata to get creator & collection
    var metaUrl = "https://archive.org/metadata/" + encodeURIComponent(parsed.identifier) + "/metadata";
    var resWrap = archiveGet(metaUrl);
    if (resWrap.failure) return resWrap.failure;

    var json = null;
    try {
        json = resWrap.res.json();
    } catch (e) {
        return Response.error("Phản hồi thông tin liên quan không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var meta = (json && json.result) ? json.result : {};
    var creator = meta.creator || "";
    var collection = Array.isArray(meta.collection) ? meta.collection[0] : (meta.collection || "");

    var query = "mediatype:(audio) AND format:(MP3)";
    if (creator) {
        var safeCreator = creator.replace(/[^\w\s\u00C0-\u024F\u1EA0-\u1EF9]/gi, " ").trim();
        query += ' AND creator:("' + (safeCreator || creator) + '")';
    } else if (collection) {
        query += ' AND collection:(' + collection + ')';
    }

    var searchUrl = "https://archive.org/advancedsearch.php?q=" + encodeURIComponent(query) +
        "&fl[]=identifier,title,creator,year,downloads&sort[]=downloads+desc&rows=15&output=json";

    var searchWrap = archiveGet(searchUrl);
    if (searchWrap.failure) return searchWrap.failure;

    var searchJson = null;
    try {
        searchJson = searchWrap.res.json();
    } catch (e2) {
        return Response.error("Lỗi dữ liệu tìm kiếm bản ghi liên quan", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var docs = (searchJson && searchJson.response && Array.isArray(searchJson.response.docs)) ? searchJson.response.docs : [];
    var items = [];

    for (var i = 0; i < docs.length; i++) {
        var doc = docs[i];
        if (doc.identifier === parsed.identifier) continue;
        var card = parseArchiveDoc(doc);
        if (card) items.push(card);
    }

    var result = {
        title: "Bản ghi tương tự",
        items: items
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
