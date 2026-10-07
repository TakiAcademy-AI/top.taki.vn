import { NextRequest, NextResponse } from "next/server";
import { checkCronSecret, jsonError } from "@/lib/api";
import { runGraphScrape } from "@/lib/scrape";
import { runDailyScoring } from "@/lib/scoring";
import { todayVN } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Cron: quét MỌI kênh FB có fb_token qua Graph API (nguồn chính thống, chính xác nhất) -> chấm điểm lại.
 *  Gọi cùng nhịp với các cron khác. Kênh không có token thì bỏ qua (vẫn dùng curl/extension như cũ). Auth = CRON_SECRET. */
export async function GET(req: NextRequest) {
  if (!checkCronSecret(req)) return jsonError("Sai secret", 401);
  const date = todayVN();
  const res = await runGraphScrape(date);
  let scored = 0;
  if (res.ok > 0) {
    try { scored = (await runDailyScoring(date)).entries; } catch { /* không chặn */ }
  }
  return NextResponse.json({ ...res, scored });
}
