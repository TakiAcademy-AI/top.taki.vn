import { NextRequest, NextResponse } from "next/server";
import { checkCronSecret, jsonError } from "@/lib/api";
import { runReelsCurl } from "@/lib/scrape";
import { runDailyScoring } from "@/lib/scoring";
import { todayVN } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Cron RIÊNG: curl bản ẩn danh cho MỌI kênh FB (song song) -> hợp nhất reel viral extension hay sót -> chấm điểm lại.
 *  Gọi mỗi 30' từ GitHub Actions nhưng tự gate theo giờ (app_settings.reels_curl_hours, mặc định 4h).
 *  ?force=1 để chạy ngay bỏ qua gate. Auth = CRON_SECRET. */
export async function GET(req: NextRequest) {
  if (!checkCronSecret(req)) return jsonError("Sai secret", 401);
  const force = new URL(req.url).searchParams.get("force") === "1";
  const date = todayVN();
  const res = await runReelsCurl(date, { force });
  let scored = 0;
  if (!res.skipped && res.ok > 0) {
    try { scored = (await runDailyScoring(date)).entries; } catch { /* không chặn */ }
  }
  return NextResponse.json({ ...res, scored });
}
