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
        { title: "Danh sách phát", input: "playlists" },
        { title: "Nghệ sĩ", input: "artists" }
    ];

    var cacheKey = "s:" + (next ? ("n:" + next) : ("q:" + query + ":f:" + filter));
    var cached = cacheGet(cacheKey);
    if (cached) {
        return Response.success(cached);
    }

    // Direct link resolve
    var songKey = extractNctKey(query);
    if (songKey && /nhaccuatui\.com\/bai-hat\//i.test(query) && !next) {
        var detailRes = nctGet("/song/detail/" + songKey);
        if (!detailRes.failure && detailRes.data && detailRes.data.key) {
            var item = parseTrackCard(detailRes.data);
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

    // Filter: Playlists
    if (filter === "playlists") {
        var plRes = nctGet("/search/playlist", { keyword: query, pageindex: page, pagesize: 20 });
        if (plRes.failure) return plRes.failure;
        var rawPl = (plRes.data && Array.isArray(plRes.data.playlists)) ? plRes.data.playlists : [];
        var plItems = [];
        for (var i = 0; i < rawPl.length; i++) {
            var plCard = parsePlaylistCard(rawPl[i]);
            if (plCard) plItems.push(plCard);
        }
        var nextPl = rawPl.length >= 20 ? String(page + 1) : null;
        var plPage = {
            filters: filters,
            sections: [
                { title: "Danh sách phát", layout: "shelf", items: plItems }
            ],
            items: plItems,
            next: nextPl
        };
        cacheSet(cacheKey, plPage, 60000);
        return Response.success(plPage);
    }

    // Filter: Artists
    if (filter === "artists") {
        var arRes = nctGet("/search/all", { keyword: query });
        if (arRes.failure) return arRes.failure;
        var rawAr = (arRes.data && Array.isArray(arRes.data.artists)) ? arRes.data.artists : [];
        var arItems = [];
        for (var j = 0; j < rawAr.length; j++) {
            var arCard = parseArtistCard(rawAr[j]);
            if (arCard) arItems.push(arCard);
        }
        var arPage = {
            filters: filters,
            sections: [
                { title: "Nghệ sĩ", layout: "list", items: arItems }
            ],
            items: arItems,
            next: null
        };
        cacheSet(cacheKey, arPage, 60000);
        return Response.success(arPage);
    }

    // Filter: Songs
    if (filter === "songs") {
        var sRes = nctGet("/search/song", { keyword: query, pageindex: page, pagesize: 20, correct: "false" });
        if (sRes.failure) return sRes.failure;
        var rawSongs = (sRes.data && Array.isArray(sRes.data.songs)) ? sRes.data.songs : [];
        var sItems = [];
        for (var k = 0; k < rawSongs.length; k++) {
            var sCard = parseTrackCard(rawSongs[k]);
            if (sCard) sItems.push(sCard);
        }
        var nextSongs = rawSongs.length >= 20 ? String(page + 1) : null;
        var songPage = {
            filters: filters,
            sections: [
                { title: "Bài hát", layout: "list", items: sItems }
            ],
            items: sItems,
            next: nextSongs
        };
        cacheSet(cacheKey, songPage, 60000);
        return Response.success(songPage);
    }

    // Default: Multi-section unified search
    var allRes = nctGet("/search/all", { keyword: query });
    if (allRes.failure) return allRes.failure;

    var data = allRes.data || {};
    var sections = [];
    var allItems = [];

    // 1. Songs section
    var songs = Array.isArray(data.songs) ? data.songs : [];
    var songCards = [];
    for (var a = 0; a < songs.length; a++) {
        var sc = parseTrackCard(songs[a]);
        if (sc) {
            songCards.push(sc);
            allItems.push(sc);
        }
    }
    if (songCards.length) {
        sections.push({
            title: "Bài hát",
            layout: "list",
            items: songCards
        });
    }

    // 2. Playlists section
    var playlists = Array.isArray(data.playlists) ? data.playlists : [];
    var plCards = [];
    for (var b = 0; b < playlists.length; b++) {
        var plc = parsePlaylistCard(playlists[b]);
        if (plc) {
            plCards.push(plc);
            allItems.push(plc);
        }
    }
    if (plCards.length) {
        sections.push({
            title: "Danh sách phát",
            layout: "shelf",
            items: plCards
        });
    }

    // 3. Artists section
    var artists = Array.isArray(data.artists) ? data.artists : [];
    var arCards = [];
    for (var c = 0; c < artists.length; c++) {
        var arc = parseArtistCard(artists[c]);
        if (arc) {
            arCards.push(arc);
            allItems.push(arc);
        }
    }
    if (arCards.length) {
        sections.push({
            title: "Nghệ sĩ",
            layout: "shelf",
            items: arCards
        });
    }

    var resultPage = {
        filters: filters,
        sections: sections,
        items: allItems,
        next: songCards.length >= 20 ? "2" : null
    };

    cacheSet(cacheKey, resultPage, 60000);
    return Response.success(resultPage);
}
