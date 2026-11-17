load("common.js");

function execute(input) {
    input = input || {};
    var isFresh = false;
    var idParam = "";
    if (typeof input === "string") {
        idParam = input;
    } else {
        idParam = input.id || input.rid || input.mid || "";
        isFresh = Boolean(input.fresh);
    }

    var id = extractKuwoId(idParam);
    var cacheKey = id ? ("st:" + id) : "";

    function fail(message, kind) {
        if (isFresh && cacheKey) {
            cacheRemove(cacheKey);
        }
        return Response.error(message, { kind: kind || ERROR_KIND.INVALID_RESPONSE });
    }

    if (!id) {
        return fail("Thiếu mã bài hát (rid) Kuwo Music hợp lệ", ERROR_KIND.UNAVAILABLE);
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

    var streamApi = "http://antiserver.kuwo.cn/anti.s?type=convert_url&rid=" + id + "&format=mp3&response=url";
    var resWrap = kuwoGet(streamApi);
    if (resWrap.failure) return resWrap.failure;

    var streamUrl = "";
    try {
        streamUrl = trimText(resWrap.res.text());
    } catch (e) {
        return fail("Không đọc được phản hồi từ máy chủ âm thanh Kuwo", ERROR_KIND.INVALID_RESPONSE);
    }

    if (!streamUrl || streamUrl.indexOf("http") !== 0 || streamUrl.indexOf("refuse") !== -1) {
        return fail("Bài hát yêu cầu tài khoản VIP hoặc bị khóa bản quyền Kuwo", ERROR_KIND.AUTH);
    }

    // Parse hex epoch timestamp from URL path (e.g. /6afb2470/)
    var expiresAtMs = nowMs + 2 * 60 * 60 * 1000;
    var hexMatch = streamUrl.match(/\/([0-9a-f]{8})\//i);
    if (hexMatch && hexMatch[1]) {
        var parsedSec = parseInt(hexMatch[1], 16);
        if (parsedSec > 1600000000) {
            expiresAtMs = parsedSec * 1000;
        }
    }

    var result = {
        url: streamUrl,
        headers: {
            "User-Agent": USER_AGENT,
            "Referer": "https://www.kuwo.cn/"
        },
        mimeType: "audio/mpeg",
        bitrate: 320000,
        expiresAtMs: expiresAtMs
    };

    var ttlMs = 0;
    if (expiresAtMs > nowMs + 60000) {
        ttlMs = Math.min(30 * 60 * 1000, expiresAtMs - nowMs - 60000);
    }

    if (ttlMs > 0) {
        cacheSet(cacheKey, result, ttlMs);
    } else if (isFresh) {
        cacheRemove(cacheKey);
    }

    return Response.success(result);
}
