import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin, jsonError } from "@/lib/api";
import { scrapeTikTokProfile, scrapeFacebookPage } from "@/lib/scrape";
import { todayVN } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SCRAPERS: Record<string, (u: string) => Promise<any>> = {
  tiktok: scrapeTikTokProfile,
  facebook: scrapeFacebookPage,
};

/**
 * Xác minh tay một kênh. Mô hình điểm: tính TOÀN BỘ follower hiện có -> mốc khởi điểm (baseline) = 0
 * (kênh cũ đã có sẵn follower khi vào đua cũng được tính hết thành điểm).
 * Vẫn quét 1 lần để lưu snapshot + xác nhận đọc được kênh, nhưng KHÔNG bắt buộc quét thành công:
 * admin luôn duyệt được (kể cả FB cá nhân giấu follower) vì baseline không phụ thuộc số quét.
 * Admin có thể ép baseline khác 0 trong trường hợp đặc biệt qua body.baseline_followers.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAdmin();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const body = await req.json().catch(() => ({}));

  const { data: ch } = await db.from("channels").select("*").eq("id", params.id).maybeSingle();
  if (!ch) return jsonError("Không tìm thấy kênh", 404);
  if (ch.status === "removed") return jsonError("Kênh đã bị gỡ");

  // Quét best-effort để lưu snapshot hôm nay (không bắt buộc thành công)
  let scraped = false;
  const scraper = SCRAPERS[ch.platform];
  if (scraper) {
    try {
      const prof = await scraper(ch.username);
      if (prof && prof.followers != null) {
        scraped = true;
        await db.from("channel_snapshots").upsert(
          {
            channel_id: ch.id, snapshot_date: todayVN(),
            followers: prof.followers, total_views: prof.totalViews,
            videos_count: prof.videosCount, engagement: prof.engagement,
            raw: prof.raw, scrape_status: "ok",
          },
          { onConflict: "channel_id,snapshot_date" }
        );
      }
    } catch {
      /* quét lỗi -> vẫn xác minh với baseline 0 */
    }
  }

  // Mặc định baseline = 0 (tính full follower). Admin có thể ép số khác nếu cần.
  const baselineFollowers = body?.baseline_followers != null ? Number(body.baseline_followers) : 0;
  const baselineViews = body?.baseline_views != null ? Number(body.baseline_views) : 0;

  const { error } = await db
    .from("channels")
    .update({
      status: "verified",
      verified_at: new Date().toISOString(),
      verified_by: "admin",
      baseline_followers: baselineFollowers,
      baseline_views: baselineViews,
    })
    .eq("id", ch.id);
  if (error) return jsonError("Không cập nhật được", 500);

  await db.from("audit_logs").insert({
    actor_id: "admin", action: "verify_channel_manual", target_type: "channel", target_id: ch.id,
    detail: { previous_status: ch.status, baseline_followers: baselineFollowers, scraped },
  });
  return NextResponse.json({ ok: true, baseline_followers: baselineFollowers, scraped });
}
