load("common.js");

function selectBestTranscoding(transcodings, preferLowQuality) {
    if (!transcodings || !transcodings.length) return null;

    var aac160 = null;
    var abrSq = null;
    var aac96 = null;
    var progressive = null;
    var any = null;

    for (var i = 0; i < transcodings.length; i++) {
        var t = transcodings[i];
        if (!t || !t.url) continue;
        if (t.snipped) continue; // Skip 30s previews for SoundCloud Go+
        if (!any) any = t;

        var preset = String(t.preset || "").toLowerCase();
        var protocol = String((t.format && t.format.protocol) || "").toLowerCase();

        if (protocol === "progressive") {
            progressive = t;
        }
        if (preset === "aac_160k") {
            aac160 = t;
        } else if (preset === "abr_sq" || preset === "mp3_128k") {
            abrSq = t;
        } else if (preset === "aac_96k") {
            aac96 = t;
        }
    }

    if (preferLowQuality) {
        return aac96 || abrSq || aac160 || progressive || any;
    }

    // Default: prioritize highest quality (aac_160k > abr_sq > progressive > aac96)
    return aac160 || abrSq || progressive || aac96 || any;
}

function execute(input) {
    input = input || {};
    var isFresh = false;
    var idParam = "";
    if (typeof input === "string") {
        idParam = input;
    } else {
        idParam = input.id || input.trackId || "";
        isFresh = Boolean(input.fresh);
    }

    var trackId = extractTrackId(idParam);

    // If ID is a soundcloud URL, resolve it to numeric ID
    if (!trackId && isSoundCloudUrl(idParam)) {
        try {
            var resolveRsp = fetchWithAuth(SC_API_BASE + "/resolve?url=" + encodeURIComponent(idParam));
            if (resolveRsp.ok) {
                var resolveJson = safeJsonParse(resolveRsp.text());
                if (resolveJson && resolveJson.id) {
                    trackId = String(resolveJson.id);
                }
            }
        } catch (e) {}
    }

    var cacheKey = trackId ? ("st:" + trackId) : "";

    function fail(message, kind) {
        if (isFresh && cacheKey) {
            cacheRemove(cacheKey);
        }
        return Response.error(message, { kind: kind || ERROR_KIND.INVALID_RESPONSE });
    }

    if (!trackId) {
        return fail("Thiếu ID track SoundCloud hợp lệ", ERROR_KIND.UNAVAILABLE);
    }

    // Cache check (bypassed if fresh: true)
    var nowMs = Date.now();
    if (!isFresh) {
        var cached = cacheGet(cacheKey);
        if (cached && cached.expiresAtMs) {
            if (cached.expiresAtMs - nowMs > 60000) {
                return Response.success(cached);
            }
        }
    }

    // 1. Fetch track metadata
    var trackUrl = SC_API_BASE + "/tracks/" + encodeURIComponent(trackId);
    var trackRsp = fetchWithAuth(trackUrl);

    if (trackRsp.status === 404) {
        return fail("Track SoundCloud không tồn tại hoặc đã bị gỡ bỏ: " + trackId, ERROR_KIND.UNAVAILABLE);
    }
    if (trackRsp.status >= 500) {
        return fail("Máy chủ SoundCloud gặp sự cố tạm thời (HTTP " + trackRsp.status + ")", ERROR_KIND.NETWORK);
    }
    if (!trackRsp.ok) {
        return fail("Không lấy được dữ liệu bài hát từ SoundCloud (HTTP " + trackRsp.status + ")", ERROR_KIND.INVALID_RESPONSE);
    }

    var trackJson = safeJsonParse(trackRsp.text());
    if (!trackJson) {
        return fail("Dữ liệu track SoundCloud không hợp lệ", ERROR_KIND.INVALID_RESPONSE);
    }

    if (trackJson.policy === "BLOCK") {
        return fail("Track bị chặn bản quyền theo vùng hoặc quốc gia", ERROR_KIND.UNAVAILABLE);
    }
    if (trackJson.policy === "SNIP") {
        return fail("Track yêu cầu gói SoundCloud Go+ (chỉ có bản nghe thử 30s)", ERROR_KIND.AUTH);
    }
    if (trackJson.streamable === false) {
        return fail("Track này không cho phép phát trực tuyến", ERROR_KIND.UNSUPPORTED);
    }

    var transcodings = (trackJson.media && trackJson.media.transcodings) || [];
    if (!transcodings.length) {
        return fail("Không tìm thấy transcoding âm thanh cho track này", ERROR_KIND.UNSUPPORTED);
    }

    var qualityPref = "";
    try {
        if (typeof localConfig !== "undefined" && localConfig.getItem) {
            qualityPref = String(localConfig.getItem("quality") || "");
        }
    } catch (e) {}
    var preferLow = /tiết kiệm|low/i.test(qualityPref);

    var chosen = selectBestTranscoding(transcodings, preferLow);
    if (!chosen || !chosen.url) {
        return fail("Không tìm thấy transcoding phù hợp khả dụng", ERROR_KIND.UNSUPPORTED);
    }

    // 2. Fetch stream URL from chosen transcoding
    var streamRsp = fetchWithAuth(chosen.url);
    if (!streamRsp.ok) {
        return fail("Không thể lấy luồng phát trực tiếp từ SoundCloud (HTTP " + streamRsp.status + ")", ERROR_KIND.NETWORK);
    }

    var streamJson = safeJsonParse(streamRsp.text());
    var playUrl = streamJson && streamJson.url;
    if (!playUrl) {
        return fail("SoundCloud không trả về URL stream", ERROR_KIND.INVALID_RESPONSE);
    }

    // Parse expiration from URL if present
    var expiresAtMs = nowMs + 2 * 60 * 60 * 1000; // Default: 2 hours
    var expMatch = playUrl.match(/[?&]expires=(\d+)/);
    if (expMatch && expMatch[1]) {
        expiresAtMs = parseInt(expMatch[1], 10) * 1000;
    }

    var mimeType = "application/x-mpegURL";
    var protocol = String((chosen.format && chosen.format.protocol) || "").toLowerCase();
    if (protocol === "progressive" || playUrl.indexOf(".mp3") !== -1) {
        mimeType = "audio/mpeg";
    } else if (chosen.format && chosen.format.mime_type) {
        mimeType = chosen.format.mime_type;
    }

    var bitrate = 160000;
    var preset = String(chosen.preset || "").toLowerCase();
    if (preset === "aac_160k") {
        bitrate = 160000;
    } else if (preset === "abr_sq" || preset === "mp3_128k") {
        bitrate = 128000;
    } else if (preset === "aac_96k") {
        bitrate = 96000;
    }

    var result = {
        url: playUrl,
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": SC_WEB_BASE + "/"
        },
        mimeType: mimeType,
        bitrate: bitrate,
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
