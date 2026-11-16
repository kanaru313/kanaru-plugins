load("common.js");

function execute(input) {
    input = input || {};
    var isFresh = false;
    var idParam = "";
    if (typeof input === "string") {
        idParam = input;
    } else {
        idParam = input.id || input.stationuuid || "";
        isFresh = Boolean(input.fresh);
    }

    var id = trimText(idParam);
    var cacheKey = id ? ("st:" + id.slice(0, 36)) : "";

    function fail(message, kind) {
        if (isFresh && cacheKey) {
            cacheRemove(cacheKey);
        }
        return Response.error(message, { kind: kind || ERROR_KIND.INVALID_RESPONSE });
    }

    if (!id) {
        return fail("Thiếu mã đài phát hoặc URL stream hợp lệ", ERROR_KIND.UNAVAILABLE);
    }

    // Direct stream link pasted
    if (/^https?:\/\//i.test(id)) {
        return Response.success({
            url: id,
            headers: {
                "Icy-MetaData": "1",
                "User-Agent": "Kanaru/1.0 (+https://github.com/hieu313/kanaru)"
            },
            mimeType: "audio/mpeg",
            bitrate: 128000,
            expiresAtMs: 0
        });
    }

    // Cache check
    if (!isFresh) {
        var cached = cacheGet(cacheKey);
        if (cached) {
            return Response.success(cached);
        }
    }

    // Lookup station by UUID
    var lookupUrl = RADIO_API_BASE + "/json/stations/byuuid?uuids=" + encodeURIComponent(id);
    var rsp = fetch(lookupUrl, {
        headers: {
            "Accept": "application/json",
            "User-Agent": "Kanaru/1.0 (+https://github.com/hieu313/kanaru)"
        }
    });

    if (rsp.status === 404) {
        return fail("Đài phát thanh không tồn tại: " + id, ERROR_KIND.UNAVAILABLE);
    }
    if (!rsp.ok) {
        return fail("Không thể lấy thông tin đài phát thanh (HTTP " + rsp.status + ")", ERROR_KIND.NETWORK);
    }

    var json = safeJsonParse(rsp.text());
    if (!Array.isArray(json) || !json.length) {
        return fail("Không tìm thấy đài phát thanh tương ứng", ERROR_KIND.UNAVAILABLE);
    }

    var station = json[0];
    var streamUrl = station.url_resolved || station.url;
    if (!streamUrl) {
        return fail("Đài phát thanh này không có luồng phát sóng trực tuyến", ERROR_KIND.UNSUPPORTED);
    }

    var codec = String(station.codec || "").toLowerCase();
    var mimeType = "audio/mpeg";
    if (codec.indexOf("aac") !== -1) {
        mimeType = "audio/aac";
    } else if (codec.indexOf("ogg") !== -1 || codec.indexOf("opus") !== -1) {
        mimeType = "audio/ogg";
    }

    var bitrate = (station.bitrate || 128) * 1000;

    var result = {
        url: streamUrl,
        headers: {
            "Icy-MetaData": "1",
            "User-Agent": "Kanaru/1.0 (+https://github.com/hieu313/kanaru)"
        },
        mimeType: mimeType,
        bitrate: bitrate,
        expiresAtMs: 0 // Continuous radio streams do not expire
    };

    cacheSet(cacheKey, result, 24 * 60 * 60 * 1000);
    return Response.success(result);
}
