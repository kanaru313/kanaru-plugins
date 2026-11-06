load("common.js");

function parseCardFromVideoRenderer(renderer) {
    if (!renderer || !renderer.videoId) return null;
    var id = renderer.videoId;
    var title = getTextValue(renderer.title);
    var artist = getTextValue(renderer.ownerText || renderer.shortBylineText);
    var durationMs = parseDurationMs(getTextValue(renderer.lengthText));
    var thumbnails = renderer.thumbnail && renderer.thumbnail.thumbnails ? renderer.thumbnail.thumbnails : null;
    var artworkUrl = chooseArtworkUrl(thumbnails, id);
    return {
        id: id,
        title: title || "Không có tiêu đề",
        artist: artist || "YouTube",
        durationMs: durationMs,
        artworkUrl: artworkUrl,
        webUrl: YT_BASE + "/watch?v=" + id
    };
}

function parseCardFromLockup(lockup) {
    if (!lockup) return null;
    var id = lockup.contentId || "";
    if (!id && lockup.rendererContext && lockup.rendererContext.commandContext) {
        var onTap = lockup.rendererContext.commandContext.onTap;
        if (onTap && onTap.innertubeCommand && onTap.innertubeCommand.watchEndpoint) {
            id = onTap.innertubeCommand.watchEndpoint.videoId || "";
        }
    }
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;

    var title = "";
    if (lockup.metadata && lockup.metadata.lockupMetadataViewModel) {
        title = getTextValue(lockup.metadata.lockupMetadataViewModel.title);
    }
    if (!title && lockup.rendererContext && lockup.rendererContext.accessibilityContext) {
        title = lockup.rendererContext.accessibilityContext.label || "";
    }

    var artist = "";
    if (lockup.metadata && lockup.metadata.lockupMetadataViewModel && lockup.metadata.lockupMetadataViewModel.metadataRows) {
        var rows = lockup.metadata.lockupMetadataViewModel.metadataRows;
        if (rows.length && rows[0].metadataParts && rows[0].metadataParts.length) {
            artist = getTextValue(rows[0].metadataParts[0].text);
        }
    }

    var durationMs = 0;
    var thumbnails = null;
    var contentImage = lockup.contentImage && lockup.contentImage.thumbnailViewModel ? lockup.contentImage.thumbnailViewModel : null;
    if (contentImage) {
        if (contentImage.image && contentImage.image.sources && contentImage.image.sources.length) {
            thumbnails = contentImage.image.sources;
        }
        var overlays = contentImage.overlays || [];
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

    return {
        id: id,
        title: title || "Không có tiêu đề",
        artist: artist || "YouTube",
        durationMs: durationMs,
        artworkUrl: artworkUrl,
        webUrl: YT_BASE + "/watch?v=" + id
    };
}

function parseCardsFromInitialData(initialData) {
    var items = [];
    var seen = {};
    var continuationToken = null;

    var sectionList = collectRenderers(initialData, "sectionListRenderer");
    var itemSections = collectRenderers(initialData, "itemSectionRenderer");

    // Look for continuation token
    var continuations = collectRenderers(initialData, "continuationItemRenderer");
    for (var c = 0; c < continuations.length; c++) {
        var cont = continuations[c];
        if (cont && cont.continuationEndpoint && cont.continuationEndpoint.continuationCommand) {
            continuationToken = cont.continuationEndpoint.continuationCommand.token || null;
            if (continuationToken) break;
        }
    }

    // Collect videoRenderers
    var videoRenderers = collectRenderers(initialData, "videoRenderer");
    for (var i = 0; i < videoRenderers.length; i++) {
        var card = parseCardFromVideoRenderer(videoRenderers[i]);
        if (card && !seen[card.id]) {
            seen[card.id] = true;
            items.push(card);
        }
    }

    // Collect lockupViewModels (playlist items or new search layout)
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

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    var next = input.next ? trimText(input.next) : null;

    if (!query && !next) {
        return Response.success({ items: [], next: null });
    }

    // Cache check
    var cacheKey = "s:" + (next ? "n:" + next.slice(0, 32) : "q:" + query);
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
            id: videoId,
            title: oembedJson.title || "Video YouTube",
            artist: oembedJson.author_name || "YouTube",
            durationMs: 0,
            artworkUrl: sanitizeArtworkUrl(oembedJson.thumbnail_url, videoId),
            webUrl: YT_BASE + "/watch?v=" + videoId
        };
        var res = { items: [item], next: null };
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
        var playlistResult = parseCardsFromInitialData(playlistData);
        cacheSet(cacheKey, playlistResult, 120000);
        return Response.success(playlistResult);
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
        var contResult = parseCardsFromInitialData(contJson);
        cacheSet(cacheKey, contResult, 60000);
        return Response.success(contResult);
    }

    // Case 4: Standard search query
    var searchUrl = YT_BASE + "/results?search_query=" + encodeURIComponent(query) + "&hl=" + YT_PREFERRED_HL + "&gl=" + YT_PREFERRED_GL;
    var searchRsp = fetch(searchUrl, { headers: buildPreferredHeaders() });
    var searchHtml = searchRsp.text();
    var initialData = extractInitialDataFromHtml(searchHtml);
    if (!initialData) {
        return Response.error("Không đọc được kết quả tìm kiếm từ YouTube", { kind: ERROR_KIND.INVALID_RESPONSE });
    }

    var searchResult = parseCardsFromInitialData(initialData);
    cacheSet(cacheKey, searchResult, 60000);
    return Response.success(searchResult);
}
