load("common.js");

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

    var appName = getAppName();
    var trackId = extractTrackId(idParam);

    // If ID is a full audius URL, resolve it first
    if (!trackId && isAudiusUrl(idParam)) {
        var resolveUrl = AUDIUS_API_BASE + "/v1/resolve?url=" + encodeURIComponent(idParam) + "&app_name=" + encodeURIComponent(appName);
        try {
            var resolveRsp = fetch(resolveUrl, {
                headers: {
                    "Accept": "application/json",
                    "User-Agent": "Kanaru/0.1.0 (+https://github.com/hieu313/kanaru)"
                }
            });
            if (resolveRsp.ok) {
                var resolveJson = safeJsonParse(resolveRsp.text());
                if (resolveJson && resolveJson.data) {
                    var target = Array.isArray(resolveJson.data) ? resolveJson.data[0] : resolveJson.data;
                    if (target && (target.id || target.track_id)) {
                        trackId = String(target.id || target.track_id);
                    }
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
        return fail("Thiếu ID track Audius hợp lệ", ERROR_KIND.UNAVAILABLE);
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

    var streamUrl = "";

    // 1. Resolve redirect stream URL via /v1/tracks/:id/stream
    var streamEndpoint = AUDIUS_API_BASE + "/v1/tracks/" + encodeURIComponent(trackId) + "/stream?app_name=" + encodeURIComponent(appName);
    var rsp = fetch(streamEndpoint, {
        headers: {
            "Accept": "*/*",
            "User-Agent": "Kanaru/0.1.0 (+https://github.com/hieu313/kanaru)"
        }
    });

    if (rsp.status === 400) {
        return fail("ID track Audius không hợp lệ: " + trackId, ERROR_KIND.UNAVAILABLE);
    }
    if (rsp.status === 403) {
        return fail("Track này bị khoá (gated/NFT hoặc yêu cầu mua USDC)", ERROR_KIND.AUTH);
    }
    if (rsp.status === 404) {
        return fail("Track Audius không tồn tại hoặc đã bị gỡ bỏ", ERROR_KIND.UNAVAILABLE);
    }
    if (rsp.status >= 500) {
        return fail("Máy chủ Audius gặp sự cố tạm thời (HTTP " + rsp.status + ")", ERROR_KIND.NETWORK);
    }

    if (rsp.status === 302 || rsp.status === 301 || rsp.status === 307) {
        streamUrl = rsp.header("location") || (rsp.headers && (rsp.headers.location || rsp.headers["location"])) || "";
    } else if (rsp.status === 200) {
        streamUrl = rsp.url || streamEndpoint;
    }

    // 2. Fallback: query track details if stream endpoint didn't provide direct link
    if (!streamUrl) {
        var trackDetailUrl = AUDIUS_API_BASE + "/v1/tracks/" + encodeURIComponent(trackId) + "?app_name=" + encodeURIComponent(appName);
        var detailRsp = fetch(trackDetailUrl, {
            headers: {
                "Accept": "application/json",
                "User-Agent": "Kanaru/0.1.0 (+https://github.com/hieu313/kanaru)"
            }
        });
        if (detailRsp.status === 404) {
            return fail("Không tìm thấy thông tin track Audius: " + trackId, ERROR_KIND.UNAVAILABLE);
        }
        var detailJson = safeJsonParse(detailRsp.text());
        var trackObj = detailJson && detailJson.data ? detailJson.data : null;
        if (!trackObj) {
            return fail("Không đọc được dữ liệu track Audius", ERROR_KIND.INVALID_RESPONSE);
        }
        if (trackObj.is_stream_gated) {
            return fail("Track này yêu cầu trả phí hoặc khoá quyền truy cập", ERROR_KIND.AUTH);
        }
        if (trackObj.is_streamable === false) {
            return fail("Track này không cho phép phát trực tuyến", ERROR_KIND.UNSUPPORTED);
        }
        if (trackObj.stream && trackObj.stream.url) {
            streamUrl = trackObj.stream.url;
        }
    }

    if (!streamUrl) {
        return fail("Không tìm thấy luồng âm thanh khả dụng cho track này", ERROR_KIND.UNSUPPORTED);
    }

    // Audius CDN and signed URLs are valid for ~2 hours
    var expiresAtMs = nowMs + 2 * 60 * 60 * 1000;

    var result = {
        url: streamUrl,
        headers: {
            "User-Agent": "Kanaru/0.1.0 (+https://github.com/hieu313/kanaru)"
        },
        mimeType: "audio/mpeg",
        bitrate: 320000,
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
