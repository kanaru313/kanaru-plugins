load("common.js");

function execute(input) {
    input = input || {};
    var url = trimText(input.url || "");
    if (!url) {
        return Response.error("Thiếu đường dẫn (url)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var key = extractNctKey(url);

    // Track
    if (url.indexOf("/bai-hat/") !== -1 || url.indexOf("/song/") !== -1 || (key && url.indexOf("/playlist/") === -1 && url.indexOf("/artist/") === -1)) {
        if (!key) {
            return Response.error("Không tìm thấy mã bài hát trong liên kết NhacCuaTui", { kind: ERROR_KIND.UNAVAILABLE });
        }
        var infoRes = nctGet("/song/detail/" + key);
        if (infoRes.failure) return infoRes.failure;
        var trackCard = parseTrackCard(infoRes.data);
        if (!trackCard) {
            return Response.error("Không đọc được bài hát từ NhacCuaTui", { kind: ERROR_KIND.INVALID_RESPONSE });
        }
        return Response.success(trackCard);
    }

    // Playlist / Album
    if (url.indexOf("/playlist/") !== -1) {
        if (!key) {
            return Response.error("Không tìm thấy mã danh sách phát trong liên kết NhacCuaTui", { kind: ERROR_KIND.UNAVAILABLE });
        }
        var plRes = nctGet("/playlist/detail/" + key);
        if (plRes.failure) return plRes.failure;
        var plCard = parsePlaylistCard(plRes.data);
        if (!plCard) {
            return Response.error("Không đọc được danh sách phát từ NhacCuaTui", { kind: ERROR_KIND.INVALID_RESPONSE });
        }
        return Response.success(plCard);
    }

    // Artist
    if (url.indexOf("/artist/") !== -1 || url.indexOf("/nghe-si-") !== -1) {
        var arMatch = url.match(/\/artist\/([A-Za-z0-9_-]+)/i) || url.match(/\/nghe-si-([^\/]+)\.([A-Za-z0-9_-]+)\.html/i);
        var arId = arMatch ? (arMatch[2] || arMatch[1]) : key;
        if (arId) {
            return Response.success({
                kind: "artist",
                id: arId,
                title: arId,
                subtitle: "Nghệ sĩ trên NhacCuaTui",
                artworkUrl: "",
                webUrl: "https://www.nhaccuatui.com/artist/" + arId
            });
        }
    }

    return Response.error("Không nhận diện được loại liên kết NhacCuaTui", { kind: ERROR_KIND.INVALID_RESPONSE });
}
