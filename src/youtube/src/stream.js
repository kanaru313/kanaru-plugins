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
    var idParam = input.id || input.videoId || input;
    var videoId = extractVideoId(idParam);

    if (!videoId) {
        return Response.error("Thiếu ID video YouTube hợp lệ", { kind: "invalidResponse" });
    }

    // Cache check
    var cacheKey = "st:" + videoId;
    var cached = cacheGet(cacheKey);
    if (cached && cached.expiresAt) {
        var nowSec = Math.floor(Date.now() / 1000);
        // If still valid for at least 60 seconds
        if (cached.expiresAt - nowSec > 60) {
            return Response.success(cached);
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
                return Response.error("Video giới hạn độ tuổi hoặc yêu cầu xác thực: " + reason, { kind: "auth" });
            }
            lastError = "Yêu cầu đăng nhập: " + reason;
            continue;
        }

        if (playerJson.videoDetails && (playerJson.videoDetails.isLive || playerJson.videoDetails.isLiveContent)) {
            return Response.error("Livestream chưa hỗ trợ phát audio", { kind: "invalidResponse" });
        }

        if (status && status !== "OK") {
            if (status === "UNPLAYABLE" || status === "GEO_RESTRICTED" || /chặn|vùng|quốc gia|country/i.test(reason)) {
                return Response.error("Video không khả dụng hoặc bị chặn theo vùng: " + (reason || status), { kind: "invalidResponse" });
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
        return Response.error(lastError || "Không tìm thấy stream audio khả dụng", { kind: "invalidResponse" });
    }

    var expireMatch = String(chosenFormat.url || "").match(/[?&]expire=(\d+)/);
    var expiresAt = expireMatch ? parseInt(expireMatch[1], 10) : 0;

    var result = {
        url: chosenFormat.url,
        headers: {
            "User-Agent": chosenClient.userAgent,
            "Referer": YT_BASE + "/"
        },
        mimeType: chosenFormat.mimeType || "audio/mp4",
        bitrate: chosenFormat.bitrate || 0,
        expiresAt: expiresAt
    };

    // Cache stream for TTL based on expiresAt (up to 30 minutes, or until 60s before expiry)
    var nowSec = Math.floor(Date.now() / 1000);
    var ttlSec = expiresAt > nowSec ? Math.min(1800, expiresAt - nowSec - 60) : 300;
    if (ttlSec > 0) {
        cacheSet(cacheKey, result, ttlSec * 1000);
    }

    return Response.success(result);
}
