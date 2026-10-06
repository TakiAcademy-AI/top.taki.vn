import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { checkCronSecret, jsonError } from "@/lib/api";
import { todayVN } from "@/lib/format";
import { runDailyScoring } from "@/lib/scoring";
import { upsertReels, recomputeChannelViews, type ReelView } from "@/lib/scrape";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Extension gửi kết quả đếm reel về đây -> ghi từng reel vào channel_reels (source=ext) rồi HỢP NHẤT
 *  với reel server curl (không đăng nhập) -> total_views đúng nhất. Kênh có reel viral cũ không bị sót.
 *  body: { results: [{ channel_id, videos_count, total_views, reels: [{id, views}] }] }. Auth = CRON_SECRET. */
export async function POST(req: NextRequest) {
  if (!checkCronSecret(req)) return jsonError("Sai secret", 401);
  const body = await req.json().catch(() => null);
  const results: any[] = Array.isArray(body?.results) ? body.results : [];
  if (!results.length) return NextResponse.json({ ok: 0 });

  const db = supabaseAdmin();
  const today = todayVN();
  let ok = 0;
  for (const r of results) {
    if (!r?.channel_id || r?.videos_count == null) continue;
    const reels: ReelView[] = Array.isArray(r.reels)
      ? r.reels.map((x: any) => ({ id: String(x.id), views: Number(x.views) })).filter((x: ReelView) => x.id && Number.isFinite(x.views))
      : [];
    // Đảm bảo có dòng snapshot + đánh dấu quét ok (không ghi total ở đây — để recompute từ union quyết định)
    await db.from("channel_snapshots").upsert(
      { channel_id: r.channel_id, snapshot_date: today, scrape_status: "ok" },
      { onConflict: "channel_id,snapshot_date" }
    );
    // LUÔN hợp nhất qua recompute (union 7 ngày + mốc cao nhất). KHÔNG ghi thẳng total_views từ extension:
    // khi extension bắt hụt (reels rỗng, videos_count=1, total=0) mà ghi thẳng sẽ ĐÈ giá trị tốt về 0.
    try {
      if (reels.length) await upsertReels(r.channel_id, today, reels, "ext");
      await recomputeChannelViews(r.channel_id, today);
      ok++;
    } catch { /* lỗi 1 kênh không chặn kênh khác */ }
  }

  // Chấm điểm lại NGAY sau khi có view/reel mới -> Sếp chỉ cần bấm extension, khỏi vào admin.
  let scored = 0;
  try {
    const report = await runDailyScoring(today);
    scored = report.entries;
  } catch (e) {
    /* lỗi chấm điểm không chặn việc ghi reel */
  }
  return NextResponse.json({ ok, received: results.length, scored });
}
