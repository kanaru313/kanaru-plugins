load("common.js");

function execute(input) {
    input = input || {};
    var idParam = (typeof input === "string") ? input : (input.id || input.albumId || "");
    var id = extractKuwoId(idParam);

    if (!id) {
        return Response.error("Thiếu mã album Kuwo Music", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "alb:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var searchUrl = "https://search.kuwo.cn/r.s?client=kt&all=" + encodeURIComponent(id) +
        "&pn=0&rn=30&vipver=1&ft=music&encoding=utf8&rformat=json&mobi=1";

    var resWrap = kuwoGet(searchUrl);
    if (resWrap.failure) return resWrap.failure;

    var json = null;
    try {
        json = resWrap.res.json();
    } catch (e) {
        return Response.error("Phản hồi album Kuwo không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var abslist = (json && Array.isArray(json.abslist)) ? json.abslist : [];
    var tracks = [];
    var albumTitle = "Album #" + id;
    var artist = "Kuwo Music";
    var artworkUrl = "";

    for (var i = 0; i < abslist.length; i++) {
        var card = parseTrackCard(abslist[i]);
        if (card) {
            tracks.push(card);
            if (abslist[i].ALBUM && albumTitle.indexOf("#") !== -1) {
                albumTitle = decodeHtml(abslist[i].ALBUM);
            }
            if (abslist[i].ARTIST && artist === "Kuwo Music") {
                artist = decodeHtml(abslist[i].ARTIST);
            }
            if (!artworkUrl && card.artworkUrl) {
                artworkUrl = card.artworkUrl;
            }
        }
    }

    var result = {
        info: {
            title: albumTitle,
            subtitle: artist + " · Album (" + tracks.length + " bài hát)",
            artworkUrl: artworkUrl,
            description: "",
            webUrl: "https://www.kuwo.cn/album_detail/" + id,
            artists: [{ id: "", title: artist }]
        },
        tracks: tracks,
        next: null,
        sections: []
    };

    cacheSet(cacheKey, result, 180000);
    return Response.success(result);
}
