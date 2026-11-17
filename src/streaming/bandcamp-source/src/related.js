load("common.js");

function execute(input) {
    input = input || {};
    var rawUrl = (typeof input === "string") ? input : (input.id || input.url || "");
    var pageUrl = normalizeBandcampUrl(rawUrl);

    if (!pageUrl.startsWith("http")) {
        return Response.error("Thiếu đường dẫn bài hát Bandcamp", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "rel:" + pageUrl;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var fetchWrap = bandcampGet(pageUrl);
    if (fetchWrap.failure) return fetchWrap.failure;

    var html = "";
    try {
        html = fetchWrap.res.text();
    } catch (e) {
        return Response.error("Không thể đọc nội dung bài hát Bandcamp", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var tralbum = extractTralbumFromHtml(html);
    var artist = (tralbum && tralbum.artist) ? tralbum.artist : "";

    if (!artist) {
        var subMatch = pageUrl.match(/https?:\/\/([a-zA-Z0-9-]+)\.bandcamp\.com/);
        if (subMatch && subMatch[1]) artist = subMatch[1];
    }

    var items = [];
    if (artist) {
        var searchUrl = "https://bandcamp.com/api/fuzzysearch/2/app_autocomplete?q=" + encodeURIComponent(artist);
        var sWrap = bandcampGet(searchUrl);
        if (!sWrap.failure) {
            try {
                var json = sWrap.res.json();
                var results = (json && Array.isArray(json.results)) ? json.results : [];
                for (var i = 0; i < results.length; i++) {
                    var it = results[i];
                    var norm = normalizeBandcampUrl(it.url);
                    if (norm === pageUrl) continue;
                    var card = parseBandcampSearchItem(it);
                    if (card) items.push(card);
                }
            } catch (ignored) {}
        }
    }

    var result = {
        title: "Tác phẩm liên quan",
        items: items
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
