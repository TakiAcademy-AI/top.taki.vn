import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { checkCronSecret, jsonError } from "@/lib/api";
import { todayVN } from "@/lib/format";
import { runDailyScoring } from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Extension đọc __UNIVERSAL_DATA__ trên trang TikTok (trình duyệt thật qua được WAF) rồi gửi số liệu
 *  về đây -> ghi snapshot hôm nay + chấm điểm lại. Chỉ gửi kênh đọc THÀNH CÔNG (extension bỏ kênh dính WAF).
 *  body: { results: [{ channel_id, followers, total_views, videos_count, engagement }] }. Auth = CRON_SECRET.
 *  Mô hình chỉ số TikTok (giữ như engine cũ): total_views=engagement=heartCount (tổng tim). */
export async function POST(req: NextRequest) {
  if (!checkCronSecret(req)) return jsonError("Sai secret", 401);
  const body = await req.json().catch(() => null);
  const results: any[] = Array.isArray(body?.results) ? body.results : [];
  if (!results.length) return NextResponse.json({ ok: 0 });

  const db = supabaseAdmin();
  const today = todayVN();
  let ok = 0;
  for (const r of results) {
    if (!r?.channel_id) continue;
    const followers = Number(r.followers);
    // Chống nhiễu: nếu lần này đọc follower 0/thiếu mà kênh đã từng đọc >0 -> giữ số tốt gần nhất (không tụt oan).
    let followersOut: number | null = Number.isFinite(followers) ? followers : null;
    if (followersOut == null || followersOut === 0) {
      const { data: lastGood } = await db
        .from("channel_snapshots")
        .select("followers")
        .eq("channel_id", r.channel_id)
        .gt("followers", 0)
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastGood?.followers) followersOut = lastGood.followers;
    }
    const { error } = await db.from("channel_snapshots").upsert(
      {
        channel_id: r.channel_id,
        snapshot_date: today,
        followers: followersOut,
        total_views: Number(r.total_views) || 0,
        videos_count: Number(r.videos_count) || 0,
        engagement: Number(r.engagement) || 0,
        scrape_status: "ok",
        raw: { engine: "tiktok-extension" },
      },
      { onConflict: "channel_id,snapshot_date" }
    );
    if (!error) ok++;
  }

  let scored = 0;
  try {
    const report = await runDailyScoring(today);
    scored = report.entries;
  } catch {
    /* lỗi chấm điểm không chặn việc ghi số liệu */
  }
  return NextResponse.json({ ok, received: results.length, scored });
}
