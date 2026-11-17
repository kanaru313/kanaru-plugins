load("common.js");

function execute() {
    var cached = cacheGet("home_feed");
    if (cached) {
        return Response.success(cached);
    }

    var sections = [];

    // 1. Live Music Archive (etree)
    var etreeUrl = "https://archive.org/advancedsearch.php?q=collection:(etree)+AND+format:(MP3)&fl[]=identifier,title,creator&sort[]=downloads+desc&rows=8&output=json";
    var etreeWrap = archiveGet(etreeUrl);
    if (!etreeWrap.failure) {
        try {
            var j = etreeWrap.res.json();
            var docs = (j && j.response && Array.isArray(j.response.docs)) ? j.response.docs : [];
            var etreeItems = [];
            for (var i = 0; i < docs.length; i++) {
                var c = parseArchiveDoc(docs[i]);
                if (c) etreeItems.push(c);
            }
            if (etreeItems.length > 0) {
                sections.push({
                    title: "Live Concerts (Live Music Archive)",
                    layout: "grid",
                    items: etreeItems
                });
            }
        } catch (e) {}
    }

    // 2. The Great 78 Project (Historical 78rpm recordings)
    var g78Url = "https://archive.org/advancedsearch.php?q=collection:(georgeblood)+AND+format:(MP3)&fl[]=identifier,title,creator&sort[]=downloads+desc&rows=8&output=json";
    var g78Wrap = archiveGet(g78Url);
    if (!g78Wrap.failure) {
        try {
            var j2 = g78Wrap.res.json();
            var docs2 = (j2 && j2.response && Array.isArray(j2.response.docs)) ? j2.response.docs : [];
            var g78Items = [];
            for (var k = 0; k < docs2.length; k++) {
                var c2 = parseArchiveDoc(docs2[k]);
                if (c2) g78Items.push(c2);
            }
            if (g78Items.length > 0) {
                sections.push({
                    title: "Đĩa than 78 vòng lịch sử (The Great 78 Project)",
                    layout: "grid",
                    items: g78Items
                });
            }
        } catch (e) {}
    }

    // 3. Classical Music
    var classicUrl = "https://archive.org/advancedsearch.php?q=mediatype:(audio)+AND+format:(MP3)+AND+(Mozart+OR+Beethoven+OR+Bach+OR+Chopin)&fl[]=identifier,title,creator&sort[]=downloads+desc&rows=8&output=json";
    var classicWrap = archiveGet(classicUrl);
    if (!classicWrap.failure) {
        try {
            var j3 = classicWrap.res.json();
            var docs3 = (j3 && j3.response && Array.isArray(j3.response.docs)) ? j3.response.docs : [];
            var classicItems = [];
            for (var m = 0; m < docs3.length; m++) {
                var c3 = parseArchiveDoc(docs3[m]);
                if (c3) classicItems.push(c3);
            }
            if (classicItems.length > 0) {
                sections.push({
                    title: "Nhạc cổ điển bất hủ",
                    layout: "list",
                    items: classicItems
                });
            }
        } catch (e) {}
    }

    var result = {
        sections: sections
    };

    cacheSet("home_feed", result, 300000);
    return Response.success(result);
}
