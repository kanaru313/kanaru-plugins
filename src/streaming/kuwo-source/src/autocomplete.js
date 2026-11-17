load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    if (!query) {
        return Response.success([]);
    }

    try {
        var searchUrl = "https://search.kuwo.cn/r.s?client=kt&all=" + encodeURIComponent(query) +
            "&pn=0&rn=10&vipver=1&ft=music&encoding=utf8&rformat=json&mobi=1";

        var resWrap = kuwoGet(searchUrl);
        if (resWrap.failure || !resWrap.res) {
            return Response.success([]);
        }

        var json = resWrap.res.json();
        var abslist = (json && Array.isArray(json.abslist)) ? json.abslist : [];
        var suggestions = [];

        for (var i = 0; i < abslist.length && suggestions.length < 10; i++) {
            var item = abslist[i];
            if (!item) continue;
            var name = decodeHtml(item.SONGNAME || item.FSONGNAME || item.NAME || "");
            if (name && suggestions.indexOf(name) === -1) {
                suggestions.push(name);
            }
            var artist = decodeHtml(item.ARTIST || item.FARTIST || "");
            if (artist && suggestions.indexOf(artist) === -1 && suggestions.length < 10) {
                suggestions.push(artist);
            }
        }

        return Response.success(suggestions.slice(0, 10));
    } catch (e) {
        return Response.success([]);
    }
}
