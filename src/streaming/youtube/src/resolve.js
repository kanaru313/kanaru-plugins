load("common.js");

function execute(input) {
    input = input || {};
    var url = trimText(input.url || "");
    if (!url) {
        return Response.error("Thiếu đường dẫn (url)", { kind: ERROR_KIND.UNAVAILABLE });
    }

    // Check video
    var videoId = extractVideoId(url);
    if (videoId) {
        var oembedUrl = "https://www.youtube.com/oembed?url=" + encodeURIComponent(YT_BASE + "/watch?v=" + videoId) + "&format=json";
        var oembedRsp = fetch(oembedUrl, { headers: buildPreferredHeaders() });
        var oembedJson = safeJsonParse(oembedRsp.text()) || {};
        return Response.success({
            kind: "track",
            id: videoId,
            title: oembedJson.title || "Video YouTube",
            subtitle: oembedJson.author_name || "YouTube",
            artist: oembedJson.author_name || "YouTube",
            artists: [{ id: "", title: oembedJson.author_name || "YouTube" }],
            durationMs: 0,
            artworkUrl: sanitizeArtworkUrl(oembedJson.thumbnail_url, videoId),
            webUrl: YT_BASE + "/watch?v=" + videoId
        });
    }

    // Check playlist
    var playlistId = extractPlaylistId(url);
    if (playlistId) {
        var playlistUrl = YT_BASE + "/playlist?list=" + encodeURIComponent(playlistId) + "&hl=" + YT_PREFERRED_HL + "&gl=" + YT_PREFERRED_GL;
        var plRsp = fetch(playlistUrl, { headers: buildPreferredHeaders() });
        var plData = extractInitialDataFromHtml(plRsp.text());
        var mf = plData && plData.microformat && plData.microformat.microformatDataRenderer ? plData.microformat.microformatDataRenderer : null;
        var title = (mf && mf.title) || "Danh sách phát YouTube";
        var thumbnails = mf && mf.thumbnail && mf.thumbnail.thumbnails ? mf.thumbnail.thumbnails : null;
        return Response.success({
            kind: "playlist",
            id: playlistId,
            title: title,
            subtitle: "Danh sách phát YouTube",
            artist: "YouTube",
            artworkUrl: chooseArtworkUrl(thumbnails, playlistId),
            webUrl: YT_BASE + "/playlist?list=" + playlistId
        });
    }

    // Check channel / user
    var channelId = extractChannelId(url);
    if (channelId) {
        return Response.success({
            kind: "artist",
            id: channelId,
            title: channelId,
            subtitle: "Nghệ sĩ trên YouTube",
            artworkUrl: "",
            webUrl: YT_BASE + (/^UC/.test(channelId) ? ("/channel/" + channelId) : ("/@" + channelId.replace(/^@/, "")))
        });
    }

    return Response.error("Không nhận diện được loại liên kết YouTube", { kind: ERROR_KIND.INVALID_RESPONSE });
}
