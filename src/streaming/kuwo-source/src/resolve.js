load("common.js");

function execute(input) {
    input = input || {};
    var url = trimText(input.url || "");
    if (!url) {
        return Response.error("Thiếu đường dẫn (url)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    var id = extractKuwoId(url);
    if (!id) {
        return Response.error("Không tìm thấy mã định danh trong liên kết Kuwo", { kind: ERROR_KIND.UNAVAILABLE });
    }

    // Playlist
    if (url.indexOf("/playlist_detail/") !== -1) {
        return Response.success({
            kind: "playlist",
            id: id,
            title: "Danh sách phát #" + id,
            subtitle: "Kuwo Music",
            artist: "Kuwo Music",
            artworkUrl: "",
            webUrl: "https://www.kuwo.cn/playlist_detail/" + id
        });
    }

    // Album
    if (url.indexOf("/album_detail/") !== -1) {
        return Response.success({
            kind: "album",
            id: id,
            title: "Album #" + id,
            subtitle: "Kuwo Music",
            artist: "Kuwo Music",
            artworkUrl: "",
            webUrl: "https://www.kuwo.cn/album_detail/" + id
        });
    }

    // Artist
    if (url.indexOf("/singer_detail/") !== -1) {
        return Response.success({
            kind: "artist",
            id: id,
            title: "Nghệ sĩ #" + id,
            subtitle: "Kuwo Music",
            artist: "Kuwo Music",
            artworkUrl: "",
            webUrl: "https://www.kuwo.cn/singer_detail/" + id
        });
    }

    // Default: Track
    return Response.success({
        kind: "track",
        id: id,
        title: "Bài hát Kuwo #" + id,
        subtitle: "Kuwo Music",
        artist: "Kuwo Music",
        artists: [{ id: "", title: "Kuwo Music" }],
        durationMs: 0,
        artworkUrl: "",
        webUrl: "https://www.kuwo.cn/play_detail/" + id
    });
}
