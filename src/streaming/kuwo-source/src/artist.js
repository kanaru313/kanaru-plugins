load("common.js");

function execute(input) {
    input = input || {};
    var id = trimText(input.id || input.artistId || "");
    if (!id) {
        return Response.error("Thiếu mã hoặc tên nghệ sĩ", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "art:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var searchUrl = "https://search.kuwo.cn/r.s?client=kt&all=" + encodeURIComponent(id) +
        "&pn=0&rn=25&vipver=1&ft=music&encoding=utf8&rformat=json&mobi=1";

    var resWrap = kuwoGet(searchUrl);
    if (resWrap.failure) return resWrap.failure;

    var json = null;
    try {
        json = resWrap.res.json();
    } catch (e) {
        return Response.error("Phản hồi nghệ sĩ Kuwo không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var abslist = (json && Array.isArray(json.abslist)) ? json.abslist : [];
    var songs = [];
    var artistName = id;
    var artworkUrl = "";

    for (var i = 0; i < abslist.length; i++) {
        var card = parseTrackCard(abslist[i]);
        if (card) {
            songs.push(card);
            if (!artworkUrl && card.artworkUrl) {
                artworkUrl = card.artworkUrl;
            }
            if (abslist[i].ARTIST && artistName === id) {
                artistName = decodeHtml(abslist[i].ARTIST);
            }
        }
    }

    var sections = [];
    if (songs.length > 0) {
        sections.push({
            title: "Bài hát nổi bật",
            layout: "list",
            items: songs
        });
    }

    var result = {
        info: {
            title: artistName,
            subtitle: "Nghệ sĩ trên Kuwo Music",
            artworkUrl: artworkUrl,
            description: "",
            webUrl: "https://www.kuwo.cn/singer_detail/" + id
        },
        sections: sections
    };

    cacheSet(cacheKey, result, 180000);
    return Response.success(result);
}
