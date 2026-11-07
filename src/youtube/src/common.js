var YT_BASE = "https://www.youtube.com";
var YT_PREFERRED_HL = "vi";
var YT_PREFERRED_GL = "VN";

var VISIONOS_CLIENT = {
    name: "VISIONOS",
    clientName: "VISIONOS",
    clientVersion: "1.02",
    clientNum: "101",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
    context: {
        clientName: "VISIONOS",
        clientVersion: "1.02",
        deviceMake: "Apple",
        deviceModel: "RealityDevice17,1",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
        osName: "visionOS",
        osVersion: "26.5.23O471"
    }
};

var ANDROID_VR_CLIENT = {
    name: "ANDROID_VR",
    clientName: "ANDROID_VR",
    clientVersion: "1.65.10",
    clientNum: "28",
    userAgent: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    context: {
        clientName: "ANDROID_VR",
        clientVersion: "1.65.10",
        deviceMake: "Oculus",
        deviceModel: "Quest 3",
        androidSdkVersion: 32,
        userAgent: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
        osName: "Android",
        osVersion: "12L"
    }
};

var ANDROID_LEGACY_CLIENT = {
    name: "ANDROID_LEGACY",
    clientName: "ANDROID",
    clientVersion: "20.10.38",
    clientNum: "3",
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
    context: {
        clientName: "ANDROID",
        clientVersion: "20.10.38",
        androidSdkVersion: 30,
        userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
        osName: "Android",
        osVersion: "11"
    }
};

var ERROR_KIND = {
    AUTH: "auth",               // Giới hạn tuổi, cần đăng nhập
    UNAVAILABLE: "unavailable", // Video bị xoá, chặn vùng, ID sai
    UNSUPPORTED: "unsupported", // Livestream, không có audio
    NETWORK: "network",         // Lỗi kết nối mạng
    INVALID_RESPONSE: "invalidResponse" // YouTube đổi format, parse hỏng
};

function trimText(text) {
    return String(text || "").replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, "");
}

function safeJsonParse(text) {
    try {
        return JSON.parse(String(text || ""));
    } catch (e) {
        return null;
    }
}

function extractBalancedJson(text, start) {
    var depth = 0;
    var inString = false;
    var quote = "";
    var escaped = false;
    var i;
    for (i = start; i < text.length; i++) {
        var ch = text.charAt(i);
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === "\\") {
                escaped = true;
            } else if (ch === quote) {
                inString = false;
                quote = "";
            }
            continue;
        }
        if (ch === "\"" || ch === "'") {
            inString = true;
            quote = ch;
            continue;
        }
        if (ch === "{") {
            depth++;
        } else if (ch === "}") {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return "";
}

function extractQuotedLiteral(text, start) {
    var quote = text.charAt(start);
    var escaped = false;
    var i;
    if (quote !== "\"" && quote !== "'") return "";
    for (i = start + 1; i < text.length; i++) {
        var ch = text.charAt(i);
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === "\\") {
            escaped = true;
            continue;
        }
        if (ch === quote) return text.slice(start, i + 1);
    }
    return "";
}

function decodeJsStringLiteral(literal) {
    return literal.slice(1, -1).replace(/\\(?:x([0-9a-f]{2})|u([0-9a-f]{4})|([\s\S]))/gi, function(all, hex2, hex4, escaped) {
        if (hex2 || hex4) return String.fromCharCode(parseInt(hex2 || hex4, 16));
        if (escaped === "n") return "\n";
        if (escaped === "r") return "\r";
        if (escaped === "t") return "\t";
        if (escaped === "b") return "\b";
        if (escaped === "f") return "\f";
        return escaped;
    });
}

function extractInitialDataFromHtml(html) {
    var markers = [
        "var ytInitialData = ",
        "window['ytInitialData'] = ",
        "window[\"ytInitialData\"] = ",
        "ytInitialData = "
    ];
    var text = String(html || "");
    var i;
    for (i = 0; i < markers.length; i++) {
        var index = text.indexOf(markers[i]);
        if (index < 0) continue;
        var start = index + markers[i].length;
        while (start < text.length && /\s/.test(text.charAt(start))) start++;
        var raw = "";
        var json = null;
        if (text.charAt(start) === "{") {
            raw = extractBalancedJson(text, start);
            json = safeJsonParse(raw);
        } else if (text.charAt(start) === "\"" || text.charAt(start) === "'") {
            raw = extractQuotedLiteral(text, start);
            json = safeJsonParse(decodeJsStringLiteral(raw));
        }
        if (json) return json;
    }
    return null;
}

function extractInitialPlayerResponseFromHtml(html) {
    var markers = [
        "var ytInitialPlayerResponse = ",
        "window['ytInitialPlayerResponse'] = ",
        "window[\"ytInitialPlayerResponse\"] = ",
        "ytInitialPlayerResponse = ",
        "ytplayer.bootstrapPlayerResponse = ",
        "ytplayer.bootstrapPlayerResponse="
    ];
    var text = String(html || "");
    var i;
    for (i = 0; i < markers.length; i++) {
        var index = text.indexOf(markers[i]);
        if (index < 0) continue;
        var start = index + markers[i].length;
        while (start < text.length && /\s/.test(text.charAt(start))) start++;
        var raw = "";
        var json = null;
        if (text.charAt(start) === "{") {
            raw = extractBalancedJson(text, start);
            json = safeJsonParse(raw);
        } else if (text.charAt(start) === "\"" || text.charAt(start) === "'") {
            raw = extractQuotedLiteral(text, start);
            json = safeJsonParse(decodeJsStringLiteral(raw));
        }
        if (json) return json;
    }
    return null;
}

function matchValue(text, pattern) {
    var matched = String(text || "").match(pattern);
    return matched && matched[1] ? matched[1] : "";
}

function extractWebClientConfigFromHtml(html) {
    var apiKey = matchValue(html, /"INNERTUBE_API_KEY":"([^"]+)"/);
    var clientVersion = matchValue(html, /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
    var visitorData = matchValue(html, /"VISITOR_DATA":"([^"]+)"/);
    return {
        apiKey: apiKey,
        clientVersion: clientVersion,
        visitorData: visitorData
    };
}

function collectRenderers(root, key) {
    var items = [];
    var stack = [root];
    while (stack.length) {
        var node = stack.pop();
        if (!node || typeof node !== "object") continue;
        if (node[key] && typeof node[key] === "object") items.push(node[key]);
        if (Object.prototype.toString.call(node) === "[object Array]") {
            for (var i = node.length - 1; i >= 0; i--) stack.push(node[i]);
        } else {
            for (var prop in node) {
                if (Object.prototype.hasOwnProperty.call(node, prop)) stack.push(node[prop]);
            }
        }
    }
    return items;
}

function getTextValue(obj) {
    if (!obj) return "";
    if (typeof obj === "string") return trimText(obj);
    if (obj.simpleText) return trimText(obj.simpleText);
    if (obj.runs && obj.runs.length) {
        var out = [];
        for (var i = 0; i < obj.runs.length; i++) {
            if (obj.runs[i] && obj.runs[i].text) out.push(obj.runs[i].text);
        }
        return trimText(out.join(""));
    }
    if (obj.content) return trimText(obj.content);
    return "";
}

function parseDurationMs(durationStr) {
    if (!durationStr) return 0;
    if (typeof durationStr === "number") return durationStr;
    var str = trimText(durationStr);
    if (/^\d+$/.test(str)) return parseInt(str, 10) * 1000;
    var parts = str.split(":");
    if (parts.length === 2) {
        var m = parseInt(parts[0], 10) || 0;
        var s = parseInt(parts[1], 10) || 0;
        return (m * 60 + s) * 1000;
    }
    if (parts.length === 3) {
        var h = parseInt(parts[0], 10) || 0;
        var m2 = parseInt(parts[1], 10) || 0;
        var s2 = parseInt(parts[2], 10) || 0;
        return (h * 3600 + m2 * 60 + s2) * 1000;
    }
    return 0;
}

function extractVideoId(str) {
    var text = trimText(str);
    if (!text) return "";
    if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
    var vMatch = text.match(/[?&]v=([A-Za-z0-9_-]{11})/i);
    if (vMatch) return vMatch[1];
    var shortMatch = text.match(/youtu\.be\/([A-Za-z0-9_-]{11})/i);
    if (shortMatch) return shortMatch[1];
    var embedMatch = text.match(/\/(?:embed|shorts|v)\/([A-Za-z0-9_-]{11})/i);
    if (embedMatch) return embedMatch[1];
    return "";
}

function extractPlaylistId(str) {
    var text = trimText(str);
    if (!text) return "";
    var listMatch = text.match(/[?&]list=([A-Za-z0-9_-]+)/i);
    if (listMatch) return listMatch[1];
    if (/^PL[A-Za-z0-9_-]+$/i.test(text) || /^RD[A-Za-z0-9_-]+$/i.test(text)) return text;
    return "";
}

function extractChannelId(str) {
    var text = trimText(str);
    if (!text) return "";
    var cMatch = text.match(/\/(?:channel|c|user)\/([A-Za-z0-9_-]+)/i);
    if (cMatch) return cMatch[1];
    var atMatch = text.match(/@([A-Za-z0-9_.-]+)/i);
    if (atMatch) return atMatch[1];
    if (/^UC[A-Za-z0-9_-]{22}$/.test(text)) return text;
    return "";
}

function parseCardFromVideoRenderer(renderer) {
    if (!renderer || !renderer.videoId) return null;
    var id = renderer.videoId;
    var title = getTextValue(renderer.title);
    var artist = getTextValue(renderer.ownerText || renderer.shortBylineText);
    var durationMs = parseDurationMs(getTextValue(renderer.lengthText));
    var thumbnails = renderer.thumbnail && renderer.thumbnail.thumbnails ? renderer.thumbnail.thumbnails : null;
    var artworkUrl = chooseArtworkUrl(thumbnails, id);

    var channelId = "";
    var byline = renderer.ownerText || renderer.shortBylineText;
    if (byline && byline.runs && byline.runs.length && byline.runs[0].navigationEndpoint) {
        var ep = byline.runs[0].navigationEndpoint.browseEndpoint;
        if (ep && ep.browseId) channelId = ep.browseId;
    }

    return {
        kind: "track",
        id: id,
        title: title || "Không có tiêu đề",
        subtitle: artist || "YouTube",
        artist: artist || "YouTube",
        artists: [{ id: channelId || "", title: artist || "YouTube" }],
        durationMs: durationMs,
        artworkUrl: artworkUrl,
        webUrl: YT_BASE + "/watch?v=" + id
    };
}

function parseCardFromLockup(lockup) {
    if (!lockup) return null;
    var id = lockup.contentId || "";
    var isPlaylist = false;
    if (lockup.contentType === "LOCKUP_CONTENT_TYPE_PLAYLIST" || /^RD|PL|VL/.test(id)) {
        isPlaylist = true;
    }
    if (!id && lockup.rendererContext && lockup.rendererContext.commandContext) {
        var onTap = lockup.rendererContext.commandContext.onTap;
        if (onTap && onTap.innertubeCommand) {
            if (onTap.innertubeCommand.watchEndpoint) {
                id = onTap.innertubeCommand.watchEndpoint.videoId || "";
            } else if (onTap.innertubeCommand.watchPlaylistEndpoint) {
                id = onTap.innertubeCommand.watchPlaylistEndpoint.playlistId || "";
                isPlaylist = true;
            }
        }
    }
    if (!id) return null;

    var title = "";
    if (lockup.metadata && lockup.metadata.lockupMetadataViewModel) {
        title = getTextValue(lockup.metadata.lockupMetadataViewModel.title);
    }
    if (!title && lockup.rendererContext && lockup.rendererContext.accessibilityContext) {
        title = lockup.rendererContext.accessibilityContext.label || "";
    }

    var artist = "";
    if (lockup.metadata && lockup.metadata.lockupMetadataViewModel) {
        var vm = lockup.metadata.lockupMetadataViewModel;
        if (vm.metadataRows && vm.metadataRows.length && vm.metadataRows[0].metadataParts && vm.metadataRows[0].metadataParts.length) {
            artist = getTextValue(vm.metadataRows[0].metadataParts[0].text);
        } else if (vm.metadata && vm.metadata.contentMetadataViewModel && vm.metadata.contentMetadataViewModel.metadataRows) {
            var rows = vm.metadata.contentMetadataViewModel.metadataRows;
            if (rows.length && rows[0].metadataParts && rows[0].metadataParts.length) {
                artist = getTextValue(rows[0].metadataParts[0].text);
            }
        }
    }

    var durationMs = 0;
    var thumbnails = null;
    var contentImage = lockup.contentImage;
    if (contentImage) {
        if (contentImage.thumbnailViewModel && contentImage.thumbnailViewModel.image && contentImage.thumbnailViewModel.image.sources) {
            thumbnails = contentImage.thumbnailViewModel.image.sources;
        } else if (contentImage.image && contentImage.image.sources) {
            thumbnails = contentImage.image.sources;
        } else if (contentImage.collectionThumbnailViewModel && contentImage.collectionThumbnailViewModel.primaryThumbnail && contentImage.collectionThumbnailViewModel.primaryThumbnail.thumbnailViewModel) {
            var primary = contentImage.collectionThumbnailViewModel.primaryThumbnail.thumbnailViewModel;
            if (primary.image && primary.image.sources) {
                thumbnails = primary.image.sources;
            }
        }

        var overlays = (contentImage.thumbnailViewModel && contentImage.thumbnailViewModel.overlays) || contentImage.overlays || [];
        for (var i = 0; i < overlays.length; i++) {
            var badges = overlays[i].thumbnailBottomOverlayViewModel ? overlays[i].thumbnailBottomOverlayViewModel.badges : [];
            for (var j = 0; j < (badges || []).length; j++) {
                var badge = badges[j].thumbnailBadgeViewModel;
                if (badge && badge.text) {
                    var d = parseDurationMs(getTextValue(badge.text));
                    if (d > 0) durationMs = d;
                }
            }
        }
    }
    var artworkUrl = chooseArtworkUrl(thumbnails, id);

    if (isPlaylist) {
        return {
            kind: "playlist",
            id: id,
            title: title || "Danh sách phát",
            subtitle: artist || "YouTube",
            artist: artist || "YouTube",
            artworkUrl: artworkUrl,
            webUrl: YT_BASE + "/playlist?list=" + id
        };
    }

    return {
        kind: "track",
        id: id,
        title: title || "Không có tiêu đề",
        subtitle: artist || "YouTube",
        artist: artist || "YouTube",
        artists: [{ id: "", title: artist || "YouTube" }],
        durationMs: durationMs,
        artworkUrl: artworkUrl,
        webUrl: YT_BASE + "/watch?v=" + id
    };
}

function parseCardFromPlaylistRenderer(renderer) {
    if (!renderer || !renderer.playlistId) return null;
    var id = renderer.playlistId;
    var title = getTextValue(renderer.title);
    var artist = getTextValue(renderer.longBylineText || renderer.shortBylineText);
    var count = getTextValue(renderer.videoCountText || renderer.videoCount);
    var thumbnails = (renderer.thumbnails && renderer.thumbnails.length ? renderer.thumbnails[0].thumbnails : null)
        || (renderer.thumbnail && renderer.thumbnail.thumbnails ? renderer.thumbnail.thumbnails : null);

    return {
        kind: "playlist",
        id: id,
        title: title || "Danh sách phát",
        subtitle: (artist ? artist + " · " : "") + (count || "Danh sách phát"),
        artist: artist || "YouTube",
        artworkUrl: chooseArtworkUrl(thumbnails, id),
        webUrl: YT_BASE + "/playlist?list=" + id
    };
}

function parseCardFromChannelRenderer(renderer) {
    if (!renderer || !renderer.channelId) return null;
    var id = renderer.channelId;
    var title = getTextValue(renderer.title);
    var sub = getTextValue(renderer.subscriberCountText || renderer.videoCountText);
    var thumbnails = renderer.thumbnail && renderer.thumbnail.thumbnails ? renderer.thumbnail.thumbnails : null;

    return {
        kind: "artist",
        id: id,
        title: title || "Kênh YouTube",
        subtitle: sub || "Nghệ sĩ",
        artist: title || "YouTube",
        artworkUrl: chooseArtworkUrl(thumbnails, id),
        webUrl: YT_BASE + "/channel/" + id
    };
}

function parseCardsFromInitialData(initialData) {
    var items = [];
    var seen = {};
    var continuationToken = null;

    // Continuation token
    var continuations = collectRenderers(initialData, "continuationItemRenderer");
    for (var c = 0; c < continuations.length; c++) {
        var cont = continuations[c];
        if (cont && cont.continuationEndpoint && cont.continuationEndpoint.continuationCommand) {
            continuationToken = cont.continuationEndpoint.continuationCommand.token || null;
            if (continuationToken) break;
        }
    }

    // Video renderers
    var videoRenderers = collectRenderers(initialData, "videoRenderer");
    for (var i = 0; i < videoRenderers.length; i++) {
        var card = parseCardFromVideoRenderer(videoRenderers[i]);
        if (card && !seen[card.id]) {
            seen[card.id] = true;
            items.push(card);
        }
    }

    // Compact video renderers (used in watch next/related)
    var compactRenderers = collectRenderers(initialData, "compactVideoRenderer");
    for (var k = 0; k < compactRenderers.length; k++) {
        var cCard = parseCardFromVideoRenderer(compactRenderers[k]);
        if (cCard && !seen[cCard.id]) {
            seen[cCard.id] = true;
            items.push(cCard);
        }
    }

    // LockupViewModels
    var lockups = collectRenderers(initialData, "lockupViewModel");
    for (var j = 0; j < lockups.length; j++) {
        var lockupCard = parseCardFromLockup(lockups[j]);
        if (lockupCard && !seen[lockupCard.id]) {
            seen[lockupCard.id] = true;
            items.push(lockupCard);
        }
    }

    return {
        items: items,
        next: continuationToken
    };
}

function buildPreferredHeaders(headers) {
    var out = {
        "Referer": YT_BASE + "/",
        "Accept-Language": YT_PREFERRED_HL + ",en;q=0.9"
    };
    headers = headers || {};
    for (var k in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, k)) out[k] = headers[k];
    }
    return out;
}

// Storage helper: prefers cacheStorage (1 MiB), falls back to localStorage (64 KiB)
var CACHE_PREFIX = "yt:";

function getStorage() {
    if (typeof cacheStorage !== "undefined" && cacheStorage) {
        return cacheStorage;
    }
    if (typeof localStorage !== "undefined" && localStorage) {
        return localStorage;
    }
    return null;
}

function cacheGet(key) {
    var store = getStorage();
    if (!store) return null;
    try {
        var raw = store.getItem(CACHE_PREFIX + key);
        if (!raw) return null;
        var entry = safeJsonParse(raw);
        if (!entry || !entry.e || entry.e < Date.now()) {
            try {
                store.removeItem(CACHE_PREFIX + key);
            } catch (ignored) {}
            return null;
        }
        return entry.v;
    } catch (e) {
        return null;
    }
}

function cacheSet(key, value, ttlMs) {
    var store = getStorage();
    if (!store) return;
    try {
        var entry = {
            v: value,
            e: Date.now() + (ttlMs || 300000)
        };
        var raw = JSON.stringify(entry);
        try {
            store.setItem(CACHE_PREFIX + key, raw);
        } catch (quotaError) {
            // If quota exceeded, silently ignore and continue without caching
        }
    } catch (e) {}
}

function cacheRemove(key) {
    var store = getStorage();
    if (!store) return;
    try {
        store.removeItem(CACHE_PREFIX + key);
    } catch (ignored) {}
}

// Artwork helpers: ensures no letterboxed 4:3 hqdefault.jpg is used
function sanitizeArtworkUrl(url, videoId) {
    var str = String(url || "");
    if (!str && videoId) {
        return "https://i.ytimg.com/vi/" + videoId + "/hq720.jpg";
    }
    if (str.indexOf("hqdefault") !== -1) {
        str = str.replace(/\/hqdefault\./g, "/hq720.");
        if (str.indexOf("hqdefault") !== -1) {
            str = str.replace(/hqdefault/g, "hq720");
        }
    }
    return str;
}

function chooseArtworkUrl(thumbnails, videoId) {
    if (!thumbnails || !thumbnails.length) {
        return sanitizeArtworkUrl("", videoId);
    }

    // 1. Prioritize square thumbnail (album art, artist art)
    var squareThumb = null;
    for (var i = 0; i < thumbnails.length; i++) {
        var t = thumbnails[i];
        if (t && t.url && t.width && t.height && Math.abs(t.width - t.height) <= 2) {
            if (!squareThumb || (t.width || 0) > (squareThumb.width || 0)) {
                squareThumb = t;
            }
        }
    }
    if (squareThumb && squareThumb.url) {
        return sanitizeArtworkUrl(squareThumb.url, videoId);
    }

    // 2. Look for hq720 or non-hqdefault
    var bestThumb = null;
    for (var j = thumbnails.length - 1; j >= 0; j--) {
        var thumb = thumbnails[j];
        if (!thumb || !thumb.url) continue;
        var u = String(thumb.url);
        if (u.indexOf("hq720") !== -1) {
            return sanitizeArtworkUrl(u, videoId);
        }
        if (u.indexOf("hqdefault") === -1 && !bestThumb) {
            bestThumb = thumb;
        }
    }

    if (bestThumb && bestThumb.url) {
        return sanitizeArtworkUrl(bestThumb.url, videoId);
    }

    var last = thumbnails[thumbnails.length - 1];
    var lastUrl = last && last.url ? last.url : (typeof last === "string" ? last : "");
    return sanitizeArtworkUrl(lastUrl, videoId);
}

function buildPlayerClientContext(client) {
    var src = client && client.context ? client.context : {};
    var out = {};
    for (var k in src) {
        if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
    }
    if (!out.hl) out.hl = YT_PREFERRED_HL;
    if (!out.gl) out.gl = YT_PREFERRED_GL;
    if (!out.acceptLanguage) out.acceptLanguage = YT_PREFERRED_HL;
    if (typeof out.utcOffsetMinutes === "undefined") out.utcOffsetMinutes = 420;
    return out;
}

function postPlayer(videoId, contextInfo, client) {
    client = client || VISIONOS_CLIENT;
    var bodyObject = {
        videoId: videoId,
        contentCheckOk: true,
        racyCheckOk: true,
        context: {
            client: buildPlayerClientContext(client)
        }
    };
    if (client.name === "ANDROID_LEGACY" || /^(?:WEB|TV)/.test(client.name)) {
        bodyObject.playbackContext = { contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS" } };
        if (contextInfo.signatureTimestamp) {
            bodyObject.playbackContext.contentPlaybackContext.signatureTimestamp = contextInfo.signatureTimestamp;
        }
    }
    var requestHeaders = {
        "Content-Type": "application/json",
        "X-YouTube-Client-Name": client.clientNum,
        "X-YouTube-Client-Version": client.clientVersion,
        "Origin": YT_BASE,
        "Accept-Language": YT_PREFERRED_HL + ",en;q=0.9",
        "User-Agent": client.userAgent
    };
    if (contextInfo.visitorData) {
        requestHeaders["X-Goog-Visitor-Id"] = contextInfo.visitorData;
    }
    var apiUrl = YT_BASE + "/youtubei/v1/player?prettyPrint=false";
    if (contextInfo.apiKey) {
        apiUrl += "&key=" + contextInfo.apiKey;
    }
    var response = fetch(apiUrl, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(bodyObject)
    });
    var text = "";
    try {
        text = response.text();
    } catch (e) {}
    var json = safeJsonParse(text) || {};
    return {
        status: response.status,
        ok: response.ok,
        json: json,
        client: client
    };
}
