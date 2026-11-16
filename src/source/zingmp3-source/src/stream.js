load("common.js");

function execute(input) {
    input = input || {};
    var isFresh = false;
    var idParam = "";
    if (typeof input === "string") {
        idParam = input;
    } else {
        idParam = input.id || input.encodeId || "";
        isFresh = Boolean(input.fresh);
    }

    var id = extractEncodeId(idParam);
    var cacheKey = id ? ("st:" + id) : "";

    function fail(message, kind) {
        if (isFresh && cacheKey) {
            cacheRemove(cacheKey);
        }
        return Response.error(message, { kind: kind || ERROR_KIND.INVALID_RESPONSE });
    }

    if (!id) {
        return fail("Thiếu mã bài hát (encodeId) ZingMP3 hợp lệ", ERROR_KIND.UNAVAILABLE);
    }

    // Cache check
    var nowMs = Date.now();
    if (!isFresh) {
        var cached = cacheGet(cacheKey);
        if (cached && cached.expiresAtMs) {
            if (cached.expiresAtMs - nowMs > 60000) {
                return Response.success(cached);
            }
        }
    }

    var streamRes = zingGet("/song/get/streaming", { id: id });
    if (streamRes.failure) {
        return streamRes.failure;
    }

    var data = streamRes.data || {};
    var streamUrl = data["128"] || "";

    if (streamUrl === "VIP" || data["320"] === "VIP" && !streamUrl) {
        return fail("Bài hát yêu cầu tài khoản Zing VIP để phát", ERROR_KIND.AUTH);
    }

    if (!streamUrl || typeof streamUrl !== "string") {
        return fail("Không tìm thấy đường link phát cho bài hát này", ERROR_KIND.UNAVAILABLE);
    }

    // Extract expire timestamp from query e.g. authen=exp=1794122958~acl=...
    var expiresAtMs = nowMs + 24 * 60 * 60 * 1000;
    var expMatch = streamUrl.match(/exp=(\d+)/);
    if (expMatch && expMatch[1]) {
        expiresAtMs = parseInt(expMatch[1], 10) * 1000;
    }

    var result = {
        url: streamUrl,
        headers: {
            "Referer": "https://zingmp3.vn/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
        mimeType: "audio/mpeg",
        bitrate: 128000,
        expiresAtMs: expiresAtMs
    };

    var ttlMs = Math.min(30 * 60 * 1000, expiresAtMs - nowMs - 60000);
    if (ttlMs > 0) {
        cacheSet(cacheKey, result, ttlMs);
    } else if (isFresh) {
        cacheRemove(cacheKey);
    }

    return Response.success(result);
}
