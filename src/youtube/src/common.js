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

// Compact localStorage cache to stay within 64 KiB quota
var CACHE_PREFIX = "yt:";

function cacheGet(key) {
    if (typeof localStorage === "undefined" || !localStorage) return null;
    try {
        var raw = localStorage.getItem(CACHE_PREFIX + key);
        if (!raw) return null;
        var entry = safeJsonParse(raw);
        if (!entry || !entry.e || entry.e < Date.now()) {
            localStorage.removeItem(CACHE_PREFIX + key);
            return null;
        }
        return entry.v;
    } catch (e) {
        return null;
    }
}

function cacheSet(key, value, ttlMs) {
    if (typeof localStorage === "undefined" || !localStorage) return;
    try {
        var entry = {
            v: value,
            e: Date.now() + (ttlMs || 300000)
        };
        var raw = JSON.stringify(entry);
        try {
            localStorage.setItem(CACHE_PREFIX + key, raw);
        } catch (quotaError) {
            // If quota exceeded, clear all cached keys with prefix yt: and retry
            try {
                if (typeof localStorage.clear === "function") {
                    localStorage.clear();
                    localStorage.setItem(CACHE_PREFIX + key, raw);
                }
            } catch (ignored) {}
        }
    } catch (e) {}
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
