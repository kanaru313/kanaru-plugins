load("common.js");

function execute(input) {
    input = input || {};
    var url = trimText((typeof input === "string") ? input : (input.url || input.id || ""));

    var mylistMatch = url.match(/nicovideo\.jp\/mylist\/(\d+)/);
    if (mylistMatch) {
        return Response.success({
            kind: "playlist",
            id: mylistMatch[1],
            title: "NicoNico Mylist #" + mylistMatch[1],
            artist: "NicoNico Community",
            artworkUrl: "",
            webUrl: "https://www.nicovideo.jp/mylist/" + mylistMatch[1]
        });
    }

    var videoId = extractNicoId(url);
    if (!videoId) {
        return Response.error("Đường dẫn NicoNico không hợp lệ", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "res:" + videoId;
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    var nowMs = Date.now();
    var watchUrl = "https://www.nicovideo.jp/api/watch/v3_guest/" + encodeURIComponent(videoId) +
        "?actionTrackId=AAAAAAAAAA_" + nowMs;

    var resWrap = nicoGet(watchUrl);
    if (resWrap.failure) return resWrap.failure;

    var json = null;
    try {
        json = resWrap.res.json();
    } catch (e) {
        return Response.error("Phản hồi dữ liệu NicoNico không hợp lệ", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var watchData = (json && json.data) ? json.data : {};
    var vInfo = watchData.video || {};
    var owner = watchData.owner || {};

    var title = decodeHtml(vInfo.title || ("NicoNico " + videoId));
    var artist = decodeHtml(owner.nickname || "NicoNico Producer");
    var durationSec = parseInt(vInfo.duration || "0", 10) || 0;
    var artworkUrl = (vInfo.thumbnail && vInfo.thumbnail.url) ? vInfo.thumbnail.url : "";

    var card = {
        kind: "track",
        id: videoId,
        title: title,
        subtitle: artist,
        artist: artist,
        artists: [{ id: String(owner.id || ""), title: artist }],
        durationMs: durationSec * 1000,
        artworkUrl: artworkUrl,
        webUrl: "https://www.nicovideo.jp/watch/" + videoId
    };

    cacheSet(cacheKey, card, 300000);
    return Response.success(card);
}
