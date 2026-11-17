# Changelog

Tất cả các thay đổi đáng chú ý của kho plugin Kanaru (`kanaru-plugins`) sẽ được ghi nhận tại đây.

Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), và tuân thủ [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **NhacCuaTui (`nhaccuatui-source`) v1**:
  - Hỗ trợ tìm kiếm bài hát, nghệ sĩ, playlist và Top 100 bảng xếp hạng NCT.
  - Trích xuất luồng MP3 128 / 320 kbps qua API Gateway chính thức `graph.nhaccuatui.com`.
  - Hỗ trợ phân giải đường link trực tiếp `nhaccuatui.com/bai-hat/...`.
- **Kuwo Music (`kuwo-source`) v1**:
  - Hỗ trợ kho nhạc Hoa (C-Pop), Anime/J-Pop và US-UK đồ sộ.
  - Trích xuất đường link CDN trực tiếp MP3 128 / 320 kbps qua gateway `antiserver.kuwo.cn`.
  - Tự động bóc tách thời gian hết hạn CDN từ epoch hex timestamp.
- **NicoNico Douga (`niconico-source`) v1**:
  - Hỗ trợ tìm kiếm qua NicoNico Snapshot Search API v2 (Vocaloid, Utaite, Touhou Project, Doujin music).
  - Trích xuất Master HLS playlist (`.m3u8`) chất lượng âm thanh gốc AAC 192 kbps qua Dwango Domand Delivery và JWT `access-rights/hls`.
  - Hỗ trợ duyệt danh sách phát yêu thích (Mylist) và Series.
- **Internet Archive (`archive-source`) v1**:
  - Tìm kiếm và phát trực tuyến hàng triệu bản thu âm lịch sử, live concert (Live Music Archive), đĩa than 78 vòng, nhạc cổ điển và sách nói công cộng.
  - Hỗ trợ tùy chọn định dạng VBR MP3 hoặc FLAC Lossless phòng thu.
  - Direct CDN link `archive.org/download/...` hỗ trợ HTTP Byte Range và không bao giờ hết hạn.
- **Jamendo Music (`jamendo`) v1**:
  - Nền tảng nhạc Creative Commons lớn nhất thế giới (> 600.000 bài).
  - REST API v3.0 chính thức với luồng MP3 320 kbps chất lượng cao (`audioformat=mp32`).
  - Hỗ trợ cấu hình `clientId` tùy chỉnh của người dùng trong cài đặt plugin.
- **Bandcamp (`bandcamp-source`) v1**:
  - Bóc tách và phát trực tuyến nhạc Indie, Synthwave, Lofi, Game OST miễn phí từ nghệ sĩ độc lập.
  - Trích xuất luồng MP3 128 kbps từ dữ liệu nhúng `data-tralbum` và CDN `t4.bcbits.com`.
- **Bộ công cụ kiểm thử (Smoke & Unit Test Suites)**:
  - Thêm 6 bộ test runner tự động trong `tools/` (`check_nhaccuatui_source.js`, `check_kuwo_source.js`, `check_archive_source.js`, `check_jamendo_source.js`, `check_bandcamp_source.js`, `check_niconico_source.js`).
  - Toàn bộ 42/42 unit test và live network smoke test đạt kết quả 100% pass.

### Changed
- Cập nhật danh mục tổng thể `plugins.json` lên 42 plugins với đầy đủ sha256 checksum, icon và download URL.
- Cập nhật tài liệu kỹ thuật, hợp đồng 10 script và bảng mã lỗi tương ứng trong `README.md`.
