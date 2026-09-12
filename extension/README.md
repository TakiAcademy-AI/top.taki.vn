# TAKI — Extension quét kênh TikTok

Extension Chrome (Manifest V3) đọc số liệu kênh TikTok bằng trình duyệt thật của admin rồi đẩy về
`top.taki.vn`, thay cho việc để máy chủ tự quét.

## Vì sao cần

WAF của TikTok (SlardarWAF) chặn theo **TLS fingerprint** và **IP datacenter**. Máy chủ Vercel/VPS
gọi thẳng trang profile thường nhận lại trang bot-check, nên `lib/scrape.ts` phải dựa vào
`curl-impersonate` và proxy — vẫn hay trượt. Extension chạy trong Chrome thật, IP nhà, có cookie
phiên đăng nhập, nên TikTok trả trang bình thường.

Hai luồng ghi vào **cùng một chỗ** (`channel_snapshots` qua `saveProfile()`), lấy **cùng bộ số**:

| Chỉ số | Nguồn trong JSON của TikTok |
|---|---|
| `followers` | `stats.followerCount` |
| `total_views` | `stats.heartCount` (tổng tim) |
| `engagement` | `stats.heartCount` |
| `videos_count` | `stats.videoCount` |
| bio | `user.signature` |

Nên bật extension **không** làm lệch điểm so với dữ liệu cũ, và có thể chạy song song hoặc thay thế
cron `05:30` tùy ý.

## Cài đặt

**Bước 1 — Bật endpoint.** Sinh token rồi dán vào biến môi trường của app (Vercel → Settings →
Environment Variables, hoặc `.env.local` khi chạy máy nhà):

```bash
openssl rand -hex 32
```

```
INGEST_TOKEN=<chuỗi vừa sinh>
```

Để trống `INGEST_TOKEN` thì `/api/ingest/tiktok` trả 401 với mọi request — đây là mặc định an toàn,
không lo quên cấu hình mà mở cửa ghi dữ liệu.

**Bước 2 — Nạp extension.** Mở `chrome://extensions` → bật **Developer mode** (góc trên phải) →
**Load unpacked** → chọn thư mục `extension/` này.

**Bước 3 — Cấu hình.** Bấm icon extension:

- **Địa chỉ hệ thống**: `https://top.taki.vn`
- **INGEST_TOKEN**: token ở bước 1
- Bấm **Lưu** (Chrome sẽ hỏi cấp quyền truy cập đúng tên miền đó, bấm đồng ý)
- Bấm **Kiểm tra kết nối** — hiện `OK — ngày ...: N kênh TikTok` là xong

## Dùng

| Nút | Việc |
|---|---|
| **Quét kênh còn thiếu** | Chỉ quét kênh chưa có snapshot `ok` hôm nay. Dùng để chạy lại sau khi lỗi. |
| **Quét lại tất cả** | Quét lại toàn bộ kênh, ghi đè snapshot hôm nay. |
| **Dừng** | Dừng sau khi xong kênh đang chạy. Phần đã gửi vẫn được giữ. |
| **Tự quét mỗi ngày lúc HH:MM** | Hẹn giờ chạy tự động. Chrome phải đang mở. |

Số liệu gửi về **theo lô 20 kênh**, nên đóng Chrome giữa chừng chỉ mất tối đa 19 kênh cuối; endpoint
ghi idempotent theo `(channel_id, ngày)` nên chạy lại bao nhiêu lần cũng không nhân đôi dữ liệu.

Giãn cách ngẫu nhiên 1,5–3 giây giữa các kênh, giống luồng máy chủ, để không bị TikTok chặn.

## Cách quét một kênh

Mỗi kênh thử lần lượt 2 đường, đường sau chỉ chạy khi đường trước trượt:

1. **`fetch` thẳng** `https://www.tiktok.com/@<username>` rồi bóc thẻ
   `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">`. Nhanh, 1 request.
2. **Mở tab ngầm** cùng URL, đợi load xong rồi đọc thẻ đó từ DOM đã render, đóng tab. Đọc 2 lần cách
   nhau 3 giây để trang kịp render.

Kênh trượt cả hai đường được ghi `scrape_status=failed`, **giữ nguyên điểm hôm trước**, không chặn
các kênh còn lại.

## Kiểm tra kết quả

- Trong Admin → **Quét dữ liệu**: lượt quét hiện dưới tên actor `extension/tiktok`.
- Nhật ký chi tiết từng kênh nằm ngay trong popup (giữ 200 dòng gần nhất).

## Khắc phục sự cố

| Hiện tượng | Xử lý |
|---|---|
| `Sai hoặc thiếu INGEST_TOKEN` | Token trong popup khác với `INGEST_TOKEN` trên server. Sau khi đổi biến môi trường trên Vercel phải **redeploy** mới có hiệu lực. |
| `Cần cấp quyền truy cập ...` | Bấm **Lưu** lại và đồng ý hộp thoại quyền của Chrome. |
| Nhiều kênh báo `bot-check` | TikTok đang nghi ngờ máy này. Mở `tiktok.com` trong tab thường, giải captcha nếu có, đăng nhập, rồi quét lại. |
| `kênh lạ bị bỏ` trong log | Username gửi lên không khớp kênh nào đang `pending`/`verified` — kênh đã bị gỡ hoặc đổi tên. |
| Lượt quét đứng giữa chừng | Chrome ngủ service worker khi máy sleep. Mở lại popup và bấm **Quét kênh còn thiếu**. |

## Giới hạn

- Chrome phải **đang mở** thì hẹn giờ mới chạy — không thay được cron server nếu cần chắc chắn 05:30.
- Chỉ quét TikTok. Facebook vẫn đi luồng máy chủ.
- Chỉ lấy **chỉ số tổng của kênh**, không lấy chi tiết từng video.
