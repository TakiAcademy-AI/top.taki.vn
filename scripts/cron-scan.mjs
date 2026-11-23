// Lượt quét định kỳ — chạy bởi Coolify scheduled task (5h30 & 18h30 giờ VN) ngay trong container app.
// Gọi tuần tự 4 endpoint cron trên localhost (thứ tự quan trọng: quét xong mới tính điểm).
// Các endpoint tự dừng khi không có cuộc thi đang chạy nên chạy thừa cũng vô hại.
const secret = process.env.CRON_SECRET ?? "";
const base = "http://localhost:3300/api/cron/";

for (const path of ["daily-scrape", "daily-scoring", "reels-curl", "graph-scrape"]) {
  try {
    const r = await fetch(`${base}${path}?secret=${secret}`);
    console.log(path, r.status, (await r.text()).slice(0, 500));
  } catch (e) {
    console.error(path, "ERR", String(e).slice(0, 300));
  }
}
