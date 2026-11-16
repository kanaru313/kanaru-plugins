load("common.js");

function execute(input) {
    input = input || {};
    var rawId = input.id || input.query || "";
    var id = extractSongId(rawId);

    if (!id) {
        return Response.error("Thiếu mã bài hát (id) Subsonic hợp lệ", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var cacheKey = "st:" + id;
    var fresh = Boolean(input.fresh);

    if (fresh) {
        cacheRemove(cacheKey);
    } else {
        var cached = cacheGet(cacheKey);
        if (cached) {
            return Response.success(cached);
        }
    }

    // Step 1: Query song metadata to verify existence, contentType, bitRate
    var songRes = subsonicGet("getSong.view", { id: id });
    if (songRes.failure) {
        cacheRemove(cacheKey);
        return songRes.failure;
    }

    var song = songRes.data && songRes.data.song;
    if (!song) {
        cacheRemove(cacheKey);
        return Response.error("Bài hát không tồn tại trên máy chủ Subsonic", { kind: ERROR_KIND.UNAVAILABLE });
    }

    // Step 2: Build streaming parameters
    var maxBitRateKbps = parseInt(cfg("maxBitRate", "0"), 10) || 0;
    var auth = getAuthParams();
    var streamParams = {};
    for (var ak in auth) streamParams[ak] = auth[ak];
    streamParams.id = id;

    var bitrate = 320000;
    if (maxBitRateKbps > 0) {
        streamParams.maxBitRate = maxBitRateKbps;
        bitrate = maxBitRateKbps * 1000;
    } else if (song.bitRate && Number(song.bitRate) > 0) {
        bitrate = Number(song.bitRate) * 1000;
    }

    var baseUrl = songRes.baseUrl || getServerUrl();
    var streamUrl = baseUrl + "/rest/stream.view?" + toQueryString(streamParams);
    var mimeType = song.contentType || "audio/mpeg";

    var result = {
        url: streamUrl,
        headers: {
            "User-Agent": "Kanaru/1.0 (+https://github.com/hieu313/kanaru)",
            "Accept": "*/*"
        },
        mimeType: mimeType,
        bitrate: bitrate,
        expiresAtMs: Date.now() + 24 * 60 * 60 * 1000
    };

    cacheSet(cacheKey, result, 3600000);
    return Response.success(result);
}
