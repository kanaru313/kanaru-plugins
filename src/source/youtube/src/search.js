load("common.js");

function buildPageResult(items, playlists, channels, continuationToken, filter) {
    var filters = [
        { title: "Bài hát & Video", input: "videos" },
        { title: "Danh sách phát", input: "playlists" },
        { title: "Kênh", input: "channels" }
    ];

    items = items || [];
    playlists = playlists || [];
    channels = channels || [];

    if (filter === "playlists") {
        var pItems = playlists.length ? playlists : items.filter(function(x) { return x.kind === "playlist"; });
        return {
            filters: filters,
            sections: [
                { title: "Danh sách phát", layout: "shelf", items: pItems }
            ],
            items: pItems,
            next: continuationToken
        };
    }

    if (filter === "channels") {
        var cItems = channels.length ? channels : items.filter(function(x) { return x.kind === "artist"; });
        return {
            filters: filters,
            sections: [
                { title: "Kênh", layout: "list", items: cItems }
            ],
            items: cItems,
            next: continuationToken
        };
    }

    if (filter === "videos") {
        var vItems = items.filter(function(x) { return x.kind === "track"; });
        return {
            filters: filters,
            sections: [
                { title: "Bài hát & Video", layout: "list", items: vItems }
            ],
            items: vItems,
            next: continuationToken
        };
    }

    // Default: Multi-section Page
    var sections = [];
    var trackItems = [];
    var otherItems = [];

    for (var i = 0; i < items.length; i++) {
        if (items[i].kind === "track") trackItems.push(items[i]);
        else otherItems.push(items[i]);
    }

    if (trackItems.length > 0) {
        sections.push({
            title: "Kết quả hàng đầu",
            layout: "top",
            items: [trackItems[0]]
        });
        sections.push({
            title: "Bài hát & Video",
            layout: "list",
            items: trackItems.slice(1, 15),
            more: { filter: "videos" }
        });
    }

    var allPlaylists = playlists.concat(otherItems.filter(function(x) { return x.kind === "playlist"; }));
    if (allPlaylists.length > 0) {
        sections.push({
            title: "Danh sách phát",
            layout: "shelf",
            items: allPlaylists.slice(0, 10),
            more: { filter: "playlists" }
        });
    }

    var allChannels = channels.concat(otherItems.filter(function(x) { return x.kind === "artist"; }));
    if (allChannels.length > 0) {
        sections.push({
            title: "Kênh",
            layout: "shelf",
            items: allChannels.slice(0, 10),
            more: { filter: "channels" }
        });
    }

    if (sections.length === 0 && items.length > 0) {
        sections.push({
            title: "Kết quả",
            layout: "list",
            items: items
        });
    }

    return {
        filters: filters,
        sections: sections,
        items: items,
        next: null
    };
}

function parseAllFromInitialData(initialData) {
    var raw = parseCardsFromInitialData(initialData);
    var playlists = [];
    var channels = [];

    var pRenderers = collectRenderers(initialData, "playlistRenderer");
    for (var i = 0; i < pRenderers.length; i++) {
        var pCard = parseCardFromPlaylistRenderer(pRenderers[i]);
        if (pCard) playlists.push(pCard);
    }

    var cRenderers = collectRenderers(initialData, "channelRenderer");
    for (var j = 0; j < cRenderers.length; j++) {
        var cCard = parseCardFromChannelRenderer(cRenderers[j]);
        if (cCard) channels.push(cCard);
    }

    return {
        items: raw.items,
        playlists: playlists,
        channels: channels,
        next: raw.next
    };
}

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    var filter = trimText(input.filter || "");
    var next = input.next ? trimText(input.next) : null;

    if (!query && !next) {
        return Response.success({ filters: [], sections: [], items: [], next: null });
    }

    // Cache check
    var cacheKey = "s:" + (next ? "n:" + next.slice(0, 32) : "q:" + query + ":f:" + filter);
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Case 1: Video link pasted
    var videoId = /https?:\/\/|youtu\.be/i.test(query) ? extractVideoId(query) : "";
    if (videoId && !next) {
        var oembedUrl = "https://www.youtube.com/oembed?url=" + encodeURIComponent(YT_BASE + "/watch?v=" + videoId) + "&format=json";
        var oembedRsp = fetch(oembedUrl, { headers: buildPreferredHeaders() });
        var oembedJson = safeJsonParse(oembedRsp.text()) || {};
        var item = {
            kind: "track",
            id: videoId,
            title: oembedJson.title || "Video YouTube",
            subtitle: oembedJson.author_name || "YouTube",
            artist: oembedJson.author_name || "YouTube",
            artists: [{ id: "", title: oembedJson.author_name || "YouTube" }],
            durationMs: 0,
            artworkUrl: sanitizeArtworkUrl(oembedJson.thumbnail_url, videoId),
            webUrl: YT_BASE + "/watch?v=" + videoId
        };
        var res = buildPageResult([item], [], [], null, filter);
        cacheSet(cacheKey, res, 120000);
        return Response.success(res);
    }

    // Case 2: Playlist link pasted
    var playlistId = /https?:\/\/|[?&]list=/i.test(query) ? extractPlaylistId(query) : "";
    if (playlistId && !next) {
        var playlistPageUrl = YT_BASE + "/playlist?list=" + encodeURIComponent(playlistId) + "&hl=" + YT_PREFERRED_HL + "&gl=" + YT_PREFERRED_GL;
        var playlistRsp = fetch(playlistPageUrl, { headers: buildPreferredHeaders() });
        var playlistHtml = playlistRsp.text();
        var playlistData = extractInitialDataFromHtml(playlistHtml);
        if (!playlistData) {
            return Response.error("Không đọc được dữ liệu danh sách phát", { kind: ERROR_KIND.INVALID_RESPONSE });
        }
        var parsedPlaylist = parseAllFromInitialData(playlistData);
        var pageRes = buildPageResult(parsedPlaylist.items, parsedPlaylist.playlists, parsedPlaylist.channels, parsedPlaylist.next, filter);
        cacheSet(cacheKey, pageRes, 120000);
        return Response.success(pageRes);
    }

    // Case 3: Continuation (page 2+)
    if (next) {
        var continuationUrl = YT_BASE + "/youtubei/v1/search?prettyPrint=false";
        var continuationBody = {
            continuation: next,
            context: {
                client: {
                    clientName: "WEB",
                    clientVersion: "2.20260320.01.00",
                    hl: YT_PREFERRED_HL,
                    gl: YT_PREFERRED_GL
                }
            }
        };
        var continuationRsp = fetch(continuationUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Origin": YT_BASE,
                "Referer": YT_BASE + "/"
            },
            body: JSON.stringify(continuationBody)
        });
        var contJson = safeJsonParse(continuationRsp.text()) || {};
        var parsedCont = parseAllFromInitialData(contJson);
        var contPageRes = buildPageResult(parsedCont.items, parsedCont.playlists, parsedCont.channels, parsedCont.next, filter);
        cacheSet(cacheKey, contPageRes, 60000);
        return Response.success(contPageRes);
    }

    // Case 4: Standard search query
    var searchUrl = YT_BASE + "/results?search_query=" + encodeURIComponent(query) + "&hl=" + YT_PREFERRED_HL + "&gl=" + YT_PREFERRED_GL;
    var searchRsp = fetch(searchUrl, { headers: buildPreferredHeaders() });
    var searchHtml = searchRsp.text();
    var initialData = extractInitialDataFromHtml(searchHtml);
    if (!initialData) {
        return Response.error("Không đọc được kết quả tìm kiếm từ YouTube", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var parsedSearch = parseAllFromInitialData(initialData);
    var searchResult = buildPageResult(parsedSearch.items, parsedSearch.playlists, parsedSearch.channels, parsedSearch.next, filter);
    cacheSet(cacheKey, searchResult, 60000);
    return Response.success(searchResult);
}
