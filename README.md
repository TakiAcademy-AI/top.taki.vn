# ĐUA TOP XÂY KÊNH — TAKI ACADEMY

Nền tảng thi đua xây kênh social cho học viên TAKI ACADEMY. Học viên đăng ký kênh vào chiến dịch đua top theo lớp; hệ thống tự quét số liệu kênh mỗi ngày (đọc trực tiếp trang công khai, không tốn phí dịch vụ ngoài), tính điểm theo công thức admin cấu hình, hiển thị bảng xếp hạng trực tiếp.

Build theo `dac-ta-phan-mem.md` phiên bản 1.0 (01/09/2026). Giao diện bám 2 file thiết kế `hoc-vien.html` và `admin.html`.

## Stack

- Next.js 14 (App Router) + Tailwind CSS + font Montserrat
- Supabase (Postgres, RLS khóa toàn bộ với anon — mọi truy cập qua API service role)
- Quét trực tiếp, chi phí $0 — TikTok (đọc JSON nhúng trong trang profile, fetch qua curl-impersonate) + Facebook (binary `fb` của tamnd/facebook-cli); YouTube chờ YouTube Data API key; bật/tắt nền tảng trong Admin > Quét dữ liệu
- Vercel Cron: quét 05:30, chốt điểm 06:00 giờ VN (đã khai trong `vercel.json` theo giờ UTC)
- Dự phòng khi TikTok chặn máy chủ: Chrome Extension trong `extension/` quét bằng trình duyệt thật rồi đẩy về `/api/ingest/tiktok` (cần `INGEST_TOKEN`) — xem `extension/README.md`

## Cài đặt lần đầu (3 bước)

**Bước 1 — Tạo database:** vào [supabase.com](https://supabase.com) tạo project mới, mở **SQL Editor**, chạy lần lượt 2 file:
1. `supabase/migrations/0001_schema.sql`
2. `supabase/seed.sql` (3 lớp mẫu + cấu hình Actor + 1 chiến dịch mẫu đang chạy)

**Bước 2 — Dán key:** mở file `.env.local`, làm theo hướng dẫn ghi ngay trong file (Supabase URL + service_role key, tự đặt mật khẩu admin và các secret).

**Bước 3 — Chạy:**

```bash
cd ~/projects/dua-top-xay-kenh && npm run dev
```

- Học viên: http://localhost:3300
- Admin: http://localhost:3300/admin (mật khẩu = `ADMIN_PASSWORD` trong `.env.local`)

## Luồng vận hành hàng ngày

1. **05:30** — `/api/cron/daily-scrape`: quét tuần tự mọi kênh `pending` + `verified` trực tiếp từ máy chủ (giãn cách ngẫu nhiên chống chặn), chuẩn hóa về schema chung, ghi `channel_snapshots`; kênh `pending` có mã ID trong bio → tự chuyển `verified` + lưu baseline.
3. **06:00** — `/api/cron/daily-scoring`: so snapshot hôm nay/hôm qua ra delta, nhân trọng số từng chiến dịch, ghi `score_entries`, cập nhật hạng + biến động hạng.
   - **Idempotent**: chạy lại job cùng ngày sẽ xóa dòng tự động của ngày đó và tính lại — điểm không nhân đôi. Tính lại ngày cũ: `/api/cron/daily-scoring?date=2026-09-01&secret=...`
   - Kênh quét lỗi: giữ điểm hôm qua, không chặn kênh khác, liệt kê trong report trả về (`scrapeFailed`).
4. Chống gian lận: follower tăng > 5× trung bình 7 ngày và tương tác/follower dưới ngưỡng → kênh chuyển `flagged`, treo điểm ngày đó chờ admin duyệt lại (xác minh tay trong hồ sơ học viên).

Chạy tay để test (thay secret của Sếp):

```bash
curl "http://localhost:3300/api/cron/daily-scoring?secret=CRON_SECRET_CUA_SEP"
```

## Deploy Vercel

1. Push repo lên GitHub, import vào Vercel.
2. Khai đủ biến trong `.env.local` vào Vercel Environment Variables, đổi `APP_URL` thành domain thật và `OTP_DEV_MODE=false`.
3. Cron đã khai sẵn trong `vercel.json` (22:30 và 23:00 UTC = 05:30 và 06:00 giờ VN).

## Những gì V1 này CHƯA có (đúng lộ trình đặc tả)

- Gửi OTP qua Zalo OA/SMS thật — hiện mã in ra log server (dev mode hiện trên màn hình). Điểm nối đã đánh dấu `TODO` trong `app/api/auth/otp/route.ts`.
- Retry quét 3 lần cách 15 phút — hiện lỗi quét được ghi nhận và bỏ qua an toàn (điểm giữ nguyên); retry tự động cần queue, để V1.1.
- Thông báo Zalo, huy hiệu, màn trình chiếu sự kiện, vai trò trợ giảng — V2 theo lộ trình.
- Engine quét trực tiếp phụ thuộc cấu trúc trang công khai của TikTok/Facebook — nền tảng đổi giao diện thì cần vá parser trong `lib/scrape.ts` (binary tải tự động lúc build qua `nixpacks.toml`).

## Quét dữ liệu & bảng xếp hạng chi tiết

- **Admin > tab "Quét dữ liệu"**: bật-tắt từng nền tảng, nút **Quét ngay** và **Tính điểm lại hôm nay**, nhật ký 20 lượt quét gần nhất, cảnh báo kênh chưa quét được và kênh bị gắn cờ gian lận.
- **BXH chi tiết**: admin toggle "Xem bảng chi tiết" — điểm thành phần từng chỉ số (follower/view/video/tương tác/chuyên cần/điều chỉnh), điểm hôm nay, biến động hạng, số kênh xác minh. API: `GET /api/leaderboard?campaign_id=&detail=1`.
- **Hồ sơ công khai**: bấm vào học viên trên mọi bảng xếp hạng (kể cả trang public) mở hồ sơ: kênh + follower/view/video mới nhất, điểm thành phần từng chiến dịch. API: `GET /api/students/profile?public_id=` — không bao giờ trả SĐT.
- **Dashboard học viên**: mỗi kênh hiện đủ follower · view · video; nút "Bảng điểm chi tiết" xem điểm thành phần cả lớp.

## Cấu trúc chính

```
app/page.tsx              Trang đăng ký + BXH public
app/dashboard/page.tsx    Dashboard học viên (thẻ ID + QR, kênh, chỉ số 7 ngày, đường đua, lịch sử điểm)
app/admin/page.tsx        Admin 4 tab: Chiến dịch / Tạo chiến dịch / Học viên / BXH + xuất Excel
app/api/...               17 endpoint theo mục 6 đặc tả
lib/scoring.ts            Công thức điểm + chuẩn hóa baseline + chống gian lận + xếp hạng
lib/scrape.ts             Engine quét trực tiếp TikTok + Facebook, lưu snapshot, xác minh bio
lib/channels.ts           Whitelist domain + bóc username từ link
supabase/                 Schema + seed
```
