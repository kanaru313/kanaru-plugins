load("common.js");

function execute(input) {
    input = input || {};
    var rawId = (typeof input === "string") ? input : (input.id || "");
    var parsed = extractJamendoId(rawId);
    var trackId = parsed.id || rawId;

    if (!trackId || !/^\d+$/.test(trackId)) {
        return Response.error("Mã bài hát Jamendo không hợp lệ", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var quality = getAudioQuality();
    var cacheKey = "stream:" + trackId + ":" + quality;

    if (!input.fresh) {
        var cached = cacheGet(cacheKey);
        if (cached) {
            return Response.success(cached);
        }
    }

    var fetchWrap = jamendoGet("tracks/", {
        id: trackId,
        audioformat: quality
    });
    if (fetchWrap.failure) return fetchWrap.failure;

    var list = (fetchWrap.json && Array.isArray(fetchWrap.json.results)) ? fetchWrap.json.results : [];
    if (list.length === 0) {
        return Response.error("Không tìm thấy bài hát trên Jamendo", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var trackData = list[0];
    var streamUrl = trackData.audio || trackData.audiodownload || "";
    if (!streamUrl) {
        return Response.error("Bài hát không có luồng phát trực tuyến khả dụng", { kind: ERROR_KIND.UNSUPPORTED });
    }

    var bitrate = quality === "mp32" ? 320000 : 128000;
    // Jamendo audio tokens expire after roughly 6 hours
    var expiresAtMs = Date.now() + (6 * 3600 * 1000);

    var result = {
        url: streamUrl,
        headers: {
            "User-Agent": USER_AGENT,
            "Referer": "https://www.jamendo.com/"
        },
        mimeType: "audio/mpeg",
        bitrate: bitrate,
        expiresAtMs: expiresAtMs
    };

    cacheSet(cacheKey, result, 300000);
    return Response.success(result);
}
