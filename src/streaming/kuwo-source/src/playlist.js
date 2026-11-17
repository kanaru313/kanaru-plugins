load("common.js");

function execute(input) {
    input = input || {};
    var idParam = (typeof input === "string") ? input : (input.id || input.pid || "");
    var id = extractKuwoId(idParam);

    if (!id) {
        return Response.error("Thiếu mã danh sách phát Kuwo Music", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "pl:" + id;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var url = "http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=" + id + "&pn=0&rn=50&encode=utf-8&keyset=pl2012&identity=kuwo";
    var resWrap = kuwoGet(url);
    if (resWrap.failure) return resWrap.failure;

    var json = null;
    try {
        json = resWrap.res.json();
    } catch (e) {
        return Response.error("Phản hồi danh sách phát Kuwo không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var title = trimText(json.title || "Danh sách phát");
    var artist = trimText(json.uname || "Kuwo Music");
    var artworkUrl = json.pic || "";
    var rawList = Array.isArray(json.musiclist) ? json.musiclist : [];
    var items = [];

    for (var i = 0; i < rawList.length; i++) {
        var m = rawList[i];
        if (!m) continue;
        var mId = String(m.id || "").replace(/^MUSIC_/, "").trim();
        if (!mId) continue;
        items.push({
            kind: "track",
            id: mId,
            title: decodeHtml(m.name || ""),
            subtitle: decodeHtml(m.artist || artist),
            artist: decodeHtml(m.artist || artist),
            artists: [{ id: "", title: decodeHtml(m.artist || artist) }],
            durationMs: (parseInt(m.duration || "0", 10) || 0) * 1000,
            artworkUrl: m.pic || artworkUrl,
            webUrl: "https://www.kuwo.cn/play_detail/" + mId
        });
    }

    var result = {
        id: id,
        title: title,
        artist: artist,
        artworkUrl: artworkUrl,
        items: items,
        next: null
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
