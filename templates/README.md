# Kanaru Plugin Templates

Thư mục mẫu hướng dẫn phát triển plugin cho ứng dụng Kanaru (Lyrics source & Lyrics translate).

---

## 1. Cấu trúc thư mục của một Plugin

Một plugin hoàn chỉnh khi đóng gói thành `.zip` phải có cấu trúc như sau:

```text
plugin.zip
├── plugin.json         # (Bắt buộc) Manifest khai báo metadata, script, config
├── icon.png            # (Tùy chọn) Kích thước ≤ 256×256 px, dung lượng ≤ 64 KB
└── src/                # (Bắt buộc) Chứa mã nguồn JavaScript
    ├── search.js       # (Bắt buộc với type "lyrics") Tìm kiếm bài hát
    ├── lyrics.js       # (Bắt buộc với type "lyrics") Lấy lời bài hát
    └── translate.js    # (Bắt buộc với type "translate") Dịch lời bài hát theo từng dòng
```

> **Lưu ý**: Các file script phụ (ví dụ `common.js`, `crypto.js`) phải đặt trong `src/` và được nạp thông qua `load('common.js')`.

---

## 2. Các loại Plugin

Kanaru hỗ trợ 2 loại plugin (`metadata.type`):

1. **`lyrics`** (Nguồn tìm kiếm lời bài hát):
   - `search.js`: Nhận thông tin bài hát (title, artist, album, duration...) hoặc từ khóa tìm kiếm thủ công, trả về danh sách các bài hát khớp (`items`).
   - `lyrics.js`: Nhận `id` định danh từ kết quả tìm kiếm, trả về nội dung lời bài hát (LRC đồng bộ thời gian hoặc Plain text) hoặc đánh dấu bài hát không lời (`instrumental: true`).

2. **`translate`** (Dịch lời bài hát):
   - `translate.js`: Nhận mảng các dòng lời bài hát (`lines`), ngôn ngữ đích (`to`), và ngữ cảnh bài hát (`song`), trả về danh sách các câu đã dịch tương ứng từng dòng (`[{ text, detected? }]`).

---

## 3. Host Globals & Môi trường thực thi (QuickJS Sandbox)

Môi trường script chạy trong QuickJS sandbox được cô lập, cung cấp sẵn các biến toàn cục:

| Global API | Mô tả & Cách sử dụng |
| :--- | :--- |
| `fetch(url, options)` | Thực hiện HTTP request. Chỉ được gọi đến các domain đã khai báo trong `metadata.hosts`.<br>Options: `method` ('GET'/'POST'...), `headers` (object), `queries` (object param query string), `body` (string), `timeout` (ms).<br>Response: `res.status`, `res.ok`, `res.text()`, `res.json()`, `res.header(name)`. |
| `Response.success(data)` | Trả về kết quả thành công cho app. |
| `Response.error(msg, opts)` | Báo lỗi về app.<br>`opts.kind`: `'server'`, `'network'`, `'rateLimited'`, `'quota'`, `'auth'`, `'invalidResponse'`.<br>`opts.retryAfterSec`: Số giây chờ (với rateLimited). |
| `localConfig.getItem(key)` | Đọc giá trị cấu hình của plugin theo đúng kiểu dữ liệu (Schema v2): `string`, `number`, `boolean`, `array`, `object`, hoặc `null` nếu chưa set. |
| `localStorage` | Bộ nhớ lưu trữ key-value cục bộ giữa các lần chạy (quota 64 KiB UTF-8).<br>`getItem(k)`, `setItem(k, v)`, `removeItem(k)`, `clear()`. |
| `Html.parse(htmlText)` | Phân tích cú pháp HTML và truy vấn CSS selectors (dựa trên engine `scraper` trong Rust).<br>Trả về `Element` với các phương thức: `select(css)`, `selectFirst(css)`, `text()`, `attr(name)`, `html()`. |
| `load('filename.js')` | Nạp file script nội bộ trong `src/` vào cùng phạm vi (scope) toàn cục.<br>`load('crypto.js')`: Nạp sẵn thư viện CryptoJS 4.2.0 (AES, MD5, SHA256, HMAC...). |
| `sleep(ms)` | Tạm dừng luồng thực thi trong `ms` mili-giây (thời gian sleep tính vào deadline của script). |
| `console.log(...)` | Ghi log vào file `<installId>.jsonl`. Không log secret, token nhạy cảm hoặc lyric text. |

---

## 4. Config Schema v2 Reference (`plugin.json`)

Mục `config` trong `plugin.json` hỗ trợ tối đa 20 trường. Mỗi trường có `title` (1–80 ký tự), `mode` và các thuộc tính chung:
- `subtitle`: (Tùy chọn, ≤ 300 ký tự) Mô tả chi tiết hiển thị dưới title.
- `required`: (Tùy chọn, boolean, mặc định `false`) Nếu `true`, người dùng bắt buộc phải nhập giá trị hợp lệ mới cho phép chạy script.
- `default`: Giá trị mặc định (phải đúng kiểu dữ liệu của mode/format).

### Bảng các Mode và Format hỗ trợ

| Mode | Format | Thuộc tính bổ sung | Kiểu của `default` | Giá trị `localConfig.getItem(key)` |
| :--- | :--- | :--- | :--- | :--- |
| `input` | `text` *(mặc định)* | `placeholder`, `minLength`, `maxLength` | string (≤ 2000 ký tự) | `string` hoặc `null` |
| `input` | `multiline` | `rows` (1–10, mặc định 3), `minLength`, `maxLength` | string (≤ 2000 ký tự) | `string` hoặc `null` |
| `input` | `number` | `min`, `max`, `step` (số thực) | finite number | `number` hoặc `null` |
| `input` | `integer` | `min`, `max`, `step` (số nguyên) | integer | `number` hoặc `null` |
| `input` | `secret` | `placeholder` (lưu an toàn trong OS Keyring) | *không có* (chuỗi rỗng được chấp nhận = null) | `string` hoặc `null` |
| `input` | `url` | `placeholder` | string URL (`https://...` hợp lệ) | `string` hoặc `null` |
| `select` | `single` *(mặc định)* | `options: [{ value, title, subtitle? }]` | string (một trong các value của options) | `string` hoặc `null` |
| `select` | `multiple` | `options`, `minItems`, `maxItems` | string[] (danh sách các value hợp lệ) | `string[]` hoặc `null` |
| `toggle` | *không có* | *không có* | boolean (`true` / `false`) | `boolean` hoặc `null` |
| `list` | `text` / `number` / `integer` / `url` | `placeholder`, `minItems`, `maxItems` (≤ 50) | Array tương ứng kiểu item | `Array` hoặc `null` |
| `map` | *không có* / `text` | `maxItems` (≤ 50, key 1–100 ký tự, value ≤ 2000) | Object key-value chuỗi | `Object` hoặc `null` |

---

## 5. Thư mục mẫu chi tiết

1. [`templates/lyrics/`](./lyrics): Mẫu plugin tìm kiếm nguồn lời bài hát.
2. [`templates/translate/`](./translate): Mẫu plugin dịch lời bài hát.
