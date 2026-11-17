load("common.js");

function execute(input) {
    input = input || {};
    var isFresh = false;
    var idParam = "";
    if (typeof input === "string") {
        idParam = input;
    } else {
        idParam = input.id || input.songKey || input.key || "";
        isFresh = Boolean(input.fresh);
    }

    var id = extractNctKey(idParam);
    var cacheKey = id ? ("st:" + id) : "";

    function fail(message, kind) {
        if (isFresh && cacheKey) {
            cacheRemove(cacheKey);
        }
        return Response.error(message, { kind: kind || ERROR_KIND.INVALID_RESPONSE });
    }

    if (!id) {
        return fail("Thiếu mã bài hát (songKey) NhacCuaTui hợp lệ", ERROR_KIND.UNAVAILABLE);
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

    var detailRes = nctGet("/song/detail/" + id);
    if (detailRes.failure) {
        return detailRes.failure;
    }
    if (detailRes.empty || !detailRes.data) {
        return fail("Không tìm thấy bài hát trên NhacCuaTui", ERROR_KIND.UNAVAILABLE);
    }

    var data = detailRes.data;
    var streamList = Array.isArray(data.streamURL) ? data.streamURL : [];
    if (!streamList.length) {
        return fail("Không có luồng phát trực tuyến cho bài hát này", ERROR_KIND.UNSUPPORTED);
    }

    var qualityPref = "";
    try {
        if (typeof localConfig !== "undefined" && localConfig.getItem) {
            qualityPref = String(localConfig.getItem("quality") || "");
        }
    } catch (e) {}

    var prefer128 = /128/i.test(qualityPref);

    var chosen = null;
    var chosenBitrate = 128000;

    // Quality selection
    var s128 = null;
    var s320 = null;
    var allVip = true;

    for (var i = 0; i < streamList.length; i++) {
        var s = streamList[i];
        if (!s || !s.stream) continue;
        if (!s.onlyVIP) allVip = false;

        if (s.type === "128" && !s.onlyVIP) {
            s128 = s;
        } else if (s.type === "320" && !s.onlyVIP) {
            s320 = s;
        }
    }

    if (allVip && !s128 && !s320) {
        return fail("Bài hát yêu cầu tài khoản NhacCuaTui VIP", ERROR_KIND.AUTH);
    }

    if (prefer128) {
        chosen = s128 || s320;
        chosenBitrate = (chosen === s320) ? 320000 : 128000;
    } else {
        chosen = s320 || s128;
        chosenBitrate = (chosen === s320) ? 320000 : 128000;
    }

    if (!chosen || !chosen.stream) {
        return fail("Không tìm thấy đường link stream khả dụng", ERROR_KIND.UNSUPPORTED);
    }

    var streamUrl = chosen.stream;

    // Extract expire timestamp (e.g. &e=1795444260)
    var expiresAtMs = nowMs + 2 * 60 * 60 * 1000;
    var eMatch = streamUrl.match(/[?&]e=(\d+)/);
    if (eMatch && eMatch[1]) {
        expiresAtMs = parseInt(eMatch[1], 10) * 1000;
    }

    var result = {
        url: streamUrl,
        headers: {
            "Referer": "https://www.nhaccuatui.com/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        mimeType: "audio/mpeg",
        bitrate: chosenBitrate,
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
