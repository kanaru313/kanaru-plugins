load("common.js");

function selectBestAudioFormat(formats, preferLowQuality) {
    var audioOnly = [];
    for (var i = 0; i < (formats || []).length; i++) {
        var f = formats[i];
        if (!f || !f.url) continue;
        var mime = String(f.mimeType || "").toLowerCase();
        if (mime.indexOf("audio/") === 0) {
            audioOnly.push(f);
        }
    }
    if (!audioOnly.length) return null;

    // Sort by bitrate descending
    audioOnly.sort(function(a, b) {
        return (b.bitrate || 0) - (a.bitrate || 0);
    });

    if (preferLowQuality) {
        // Find format around 128kbps or lowest bitrate
        for (var j = audioOnly.length - 1; j >= 0; j--) {
            if ((audioOnly[j].bitrate || 0) >= 120000) return audioOnly[j];
        }
        return audioOnly[audioOnly.length - 1];
    }

    // Default: highest bitrate
    return audioOnly[0];
}

function execute(input) {
    input = input || {};
    var isFresh = false;
    var idParam = "";
    if (typeof input === "string") {
        idParam = input;
    } else {
        idParam = input.id || input.videoId || "";
        isFresh = Boolean(input.fresh);
    }
    var videoId = extractVideoId(idParam);

    var cacheKey = videoId ? ("st:" + videoId) : "";

    function fail(message, kind) {
        if (isFresh && cacheKey) {
            cacheRemove(cacheKey);
        }
        return Response.error(message, { kind: kind || ERROR_KIND.INVALID_RESPONSE });
    }

    if (!videoId) {
        return fail("Thiếu ID video YouTube hợp lệ", ERROR_KIND.UNAVAILABLE);
    }

    // Cache check (ignored when fresh: true)
    if (!isFresh) {
        var cached = cacheGet(cacheKey);
        if (cached && cached.expiresAtMs) {
            var nowMs = Date.now();
            // If still valid for at least 60 seconds (60,000 ms)
            if (cached.expiresAtMs - nowMs > 60000) {
                return Response.success(cached);
            }
        }
    }

    // 1. Fetch watch context (HTML)
    var watchUrl = YT_BASE + "/watch?v=" + videoId + "&hl=" + YT_PREFERRED_HL + "&gl=" + YT_PREFERRED_GL;
    var watchRsp = fetch(watchUrl, { headers: buildPreferredHeaders() });
    var watchHtml = watchRsp.text();
    var config = extractWebClientConfigFromHtml(watchHtml);
    var sts = Number(matchValue(watchHtml, /"STS"\s*:\s*(\d+)/) || 0);

    var contextInfo = {
        apiKey: config.apiKey,
        visitorData: config.visitorData,
        signatureTimestamp: sts
    };

    if (!contextInfo.apiKey || !contextInfo.visitorData) {
        var embedUrl = YT_BASE + "/embed/" + videoId;
        var embedRsp = fetch(embedUrl, { headers: buildPreferredHeaders() });
        var embedHtml = embedRsp.text();
        var embedConfig = extractWebClientConfigFromHtml(embedHtml);
        if (!contextInfo.apiKey) contextInfo.apiKey = embedConfig.apiKey;
        if (!contextInfo.visitorData) contextInfo.visitorData = embedConfig.visitorData;
    }

    // 2. Try Innertube player clients
    var clients = [VISIONOS_CLIENT, ANDROID_VR_CLIENT, ANDROID_LEGACY_CLIENT];
    var chosenFormat = null;
    var chosenClient = null;
    var lastError = null;

    var qualityPref = "";
    try {
        if (typeof localConfig !== "undefined" && localConfig.getItem) {
            qualityPref = String(localConfig.getItem("quality") || "");
        }
    } catch (e) {}
    var preferLow = /tiết kiệm|low/i.test(qualityPref);

    for (var c = 0; c < clients.length; c++) {
        var client = clients[c];
        var playerResult = postPlayer(videoId, contextInfo, client);
        var playerJson = playerResult.json || {};
        var playability = playerJson.playabilityStatus || {};
        var status = playability.status || "";
        var reason = playability.reason || "";

        if (status === "LOGIN_REQUIRED") {
            if (/tuổi|age|robot|xác nhận|sign in/i.test(reason)) {
                return fail("Video giới hạn độ tuổi hoặc yêu cầu xác thực: " + reason, ERROR_KIND.AUTH);
            }
            lastError = "Yêu cầu đăng nhập: " + reason;
            continue;
        }

        if (playerJson.videoDetails && (playerJson.videoDetails.isLive || playerJson.videoDetails.isLiveContent)) {
            return fail("Livestream chưa hỗ trợ phát audio", ERROR_KIND.UNSUPPORTED);
        }

        if (status && status !== "OK") {
            if (status === "UNPLAYABLE" || status === "GEO_RESTRICTED" || /chặn|vùng|quốc gia|country/i.test(reason)) {
                return fail("Video không khả dụng hoặc bị chặn theo vùng: " + (reason || status), ERROR_KIND.UNAVAILABLE);
            }
            lastError = "YouTube báo không phát được: " + (reason || status);
            continue;
        }

        var streamingData = playerJson.streamingData || {};
        var adaptive = streamingData.adaptiveFormats || [];
        var formats = streamingData.formats || [];
        var allFormats = adaptive.concat(formats);

        var best = selectBestAudioFormat(allFormats, preferLow);
        if (best && best.url) {
            chosenFormat = best;
            chosenClient = client;
            break;
        }
    }

    if (!chosenFormat || !chosenFormat.url) {
        return fail(lastError || "Không tìm thấy stream audio khả dụng", ERROR_KIND.UNSUPPORTED);
    }

    var expireMatch = String(chosenFormat.url || "").match(/[?&]expire=(\d+)/);
    var nowMs = Date.now();
    var expiresAtMs = 0;
    if (expireMatch && expireMatch[1]) {
        expiresAtMs = parseInt(expireMatch[1], 10) * 1000;
    } else {
        expiresAtMs = nowMs + 5 * 60 * 1000;
        console.log("No expire parameter found on stream URL, defaulting expiresAtMs to now + 5m");
    }

    var result = {
        url: chosenFormat.url,
        headers: {
            "User-Agent": chosenClient.userAgent,
            "Referer": YT_BASE + "/"
        },
        mimeType: chosenFormat.mimeType || "audio/mp4",
        bitrate: chosenFormat.bitrate || 0,
        expiresAtMs: expiresAtMs
    };

    // Cache stream: max 30 min TTL, or until 60s before expiry
    var ttlMs = 0;
    if (expiresAtMs > nowMs + 60000) {
        ttlMs = Math.min(30 * 60 * 1000, expiresAtMs - nowMs - 60000);
    }

    if (ttlMs > 0) {
        cacheSet(cacheKey, result, ttlMs);
    } else if (isFresh) {
        // If expired or expiring immediately, clear old entry
        cacheRemove(cacheKey);
    }

    return Response.success(result);
}
