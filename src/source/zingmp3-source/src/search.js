load("common.js");

function execute(input) {
    input = input || {};
    var query = trimText(input.query || "");
    var filter = trimText(input.filter || "");
    var next = input.next ? trimText(input.next) : null;

    if (!query && !next) {
        return Response.success({ filters: [], sections: [], items: [], next: null });
    }

    var filters = [
        { title: "Bài hát", input: "songs" },
        { title: "Playlist & Album", input: "playlists" },
        { title: "Nghệ sĩ", input: "artists" }
    ];

    var cacheKey = "s:" + (next ? ("n:" + next) : ("q:" + query + ":f:" + filter));
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Direct link resolve
    var encodeId = extractEncodeId(query);
    if (encodeId && /https?:\/\//i.test(query) && !next) {
        var infoRes = zingGet("/song/get/info", { id: encodeId });
        if (!infoRes.failure && infoRes.data && infoRes.data.encodeId) {
            var item = parseTrackCard(infoRes.data);
            if (item) {
                var directPage = {
                    filters: filters,
                    sections: [
                        { title: "Bài hát", layout: "list", items: [item] }
                    ],
                    items: [item],
                    next: null
                };
                cacheSet(cacheKey, directPage, 120000);
                return Response.success(directPage);
            }
        }
    }

    var page = next ? (parseInt(next, 10) || 1) : 1;

    // Filter-specific searches
    if (filter === "playlists") {
        var plRes = zingGet("/search/multi", { q: query });
        var playlists = [];
        var rawPlaylists = (plRes.data && Array.isArray(res.data.playlists)) ? res.data.playlists : [];
        for (var j = 0; j < rawPlaylists.length; j++) {
            var pc = parsePlaylistCard(rawPlaylists[j]);
            if (pc) playlists.push(pc);
        }
        var plPage = {
            filters: filters,
            sections: [{ title: "Playlist & Album", layout: "shelf", items: playlists }],
            items: playlists,
            next: null
        };
        cacheSet(cacheKey, plPage, 60000);
        return Response.success(plPage);
    }

    if (filter === "artists") {
        var arRes = zingGet("/search/multi", { q: query });
        var artists = [];
        var rawArtists = (arRes.data && Array.isArray(arRes.data.artists)) ? arRes.data.artists : [];
        for (var k = 0; k < rawArtists.length; k++) {
            var ac = parseArtistCard(rawArtists[k]);
            if (ac) artists.push(ac);
        }
        var arPage = {
            filters: filters,
            sections: [{ title: "Nghệ sĩ", layout: "shelf", items: artists }],
            items: artists,
            next: null
        };
        cacheSet(cacheKey, arPage, 60000);
        return Response.success(arPage);
    }

    // Default: song search via /search (supports pagination with page number)
    var searchRes = zingGet("/search", { q: query, type: "song", page: page, count: 20 });
    if (searchRes.failure) {
        return searchRes.failure;
    }

    var rawItems = (searchRes.data && Array.isArray(searchRes.data.items)) ? searchRes.data.items : [];
    var items = [];
    var seen = {};

    for (var i = 0; i < rawItems.length; i++) {
        var c = parseTrackCard(rawItems[i]);
        if (c && !seen[c.id]) {
            seen[c.id] = true;
            items.push(c);
        }
    }

    var nextToken = (rawItems.length >= 20) ? String(page + 1) : null;

    var sections = [];
    if (items.length > 0) {
        sections.push({
            title: "Kết quả hàng đầu",
            layout: "top",
            items: [items[0]]
        });
        sections.push({
            title: "Bài hát",
            layout: "list",
            items: items.slice(1),
            more: { filter: "songs" }
        });
    }

    var result = {
        filters: filters,
        sections: sections,
        items: items,
        next: nextToken
    };

    cacheSet(cacheKey, result, 60000);
    return Response.success(result);
}
