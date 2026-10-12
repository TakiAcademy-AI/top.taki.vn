import { NextRequest, NextResponse } from "next/server";
import { startDailyScrape } from "@/lib/scrape";
import { checkCronSecret, jsonError } from "@/lib/api";
import { hasActiveCampaign } from "@/lib/scoring";
import { todayVN } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Cron 05:30 (giờ VN) — quét trực tiếp toàn bộ kênh. TỰ DỪNG khi không có cuộc thi nào đang chạy
 *  (?force=1 để quét bất chấp — vd chuẩn bị cho cuộc thi sắp mở). */
async function handle(req: NextRequest) {
  if (!checkCronSecret(req)) return jsonError("Sai CRON_SECRET", 401);
  const force = new URL(req.url).searchParams.get("force") === "1";
  if (!force && !(await hasActiveCampaign(todayVN())))
    return NextResponse.json({ skipped: "không có cuộc thi đang chạy" });
  try {
    const result = await startDailyScrape();
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[daily-scrape]", e);
    return jsonError(e.message ?? "Lỗi khởi chạy quét", 500);
  }
}
export const GET = handle;
export const POST = handle;
