load("common.js");

function execute(input) {
    input = input || {};
    var url = trimText(input.url || "");
    if (!url) {
        return Response.error("Thiếu đường dẫn (url)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var encodeId = extractEncodeId(url);

    // Track
    if (url.indexOf("/bai-hat/") !== -1 || (encodeId && url.indexOf("/album/") === -1 && url.indexOf("/playlist/") === -1)) {
        if (!encodeId) {
            return Response.error("Không tìm thấy mã bài hát trong liên kết ZingMP3", { kind: ERROR_KIND.UNAVAILABLE });
        }
        var infoRes = zingGet("/song/get/info", { id: encodeId });
        if (infoRes.failure) return infoRes.failure;
        var trackCard = parseTrackCard(infoRes.data);
        if (!trackCard) {
            return Response.error("Không đọc được bài hát từ ZingMP3", { kind: ERROR_KIND.INVALID_RESPONSE });
        }
        return Response.success(trackCard);
    }

    // Playlist / Album
    if (url.indexOf("/album/") !== -1 || url.indexOf("/playlist/") !== -1) {
        if (!encodeId) {
            return Response.error("Không tìm thấy mã danh sách phát trong liên kết ZingMP3", { kind: ERROR_KIND.UNAVAILABLE });
        }
        var plRes = zingGet("/page/get/playlist", { id: encodeId });
        if (plRes.failure) return plRes.failure;
        var plCard = parsePlaylistCard(plRes.data);
        if (!plCard) {
            return Response.error("Không đọc được danh sách phát từ ZingMP3", { kind: ERROR_KIND.INVALID_RESPONSE });
        }
        return Response.success(plCard);
    }

    // Artist
    var artistMatch = url.match(/\/nghe-si\/([A-Za-z0-9_-]+)/i);
    if (artistMatch && artistMatch[1]) {
        var alias = artistMatch[1];
        var sRes = zingGet("/search/multi", { q: alias.replace(/-/g, " ") });
        if (!sRes.failure && sRes.data && Array.isArray(sRes.data.artists) && sRes.data.artists.length > 0) {
            var artCard = parseArtistCard(sRes.data.artists[0]);
            if (artCard) return Response.success(artCard);
        }
        return Response.success({
            kind: "artist",
            id: alias,
            title: alias,
            subtitle: "Nghệ sĩ trên ZingMP3",
            artworkUrl: "",
            webUrl: "https://zingmp3.vn/nghe-si/" + alias
        });
    }

    return Response.error("Không nhận diện được loại liên kết ZingMP3", { kind: ERROR_KIND.INVALID_RESPONSE });
}
