import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/api";
import { scrapeTikTokProfile, scrapeFacebookPage, scrapeYouTubeChannel } from "@/lib/scrape";
import { todayVN } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SCRAPERS: Record<string, (u: string, o?: { withEngagement?: boolean }) => Promise<any>> = {
  tiktok: scrapeTikTokProfile,
  facebook: scrapeFacebookPage,
  youtube: scrapeYouTubeChannel,
};

/**
 * Xác minh HÀNG LOẠT mọi kênh đang chờ — một nút thay cho việc mở từng hồ sơ học viên.
 * Cùng mô hình với xác minh tay từng kênh: quét best-effort để lưu snapshot (không bắt buộc
 * thành công — FB đang chặn curl thì vẫn duyệt), baseline = 0 (tính toàn bộ follower hiện có).
 * Quét song song để 10-20 kênh vẫn xong trong một request.
 */
export async function POST() {
  const auth = requireAdmin();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const today = todayVN();

  const { data: pending } = await db
    .from("channels")
    .select("id, platform, username")
    .eq("status", "pending");
  if (!pending?.length) return NextResponse.json({ verified: 0, results: [] });

  const results = await Promise.all(
    pending.map(async (ch) => {
      let scraped = false;
      const scraper = SCRAPERS[ch.platform];
      if (scraper) {
        try {
          const prof = await scraper(ch.username, { withEngagement: true });
          if (prof && prof.followers != null) {
            scraped = true;
            await db.from("channel_snapshots").upsert(
              {
                channel_id: ch.id, snapshot_date: today,
                followers: prof.followers, total_views: prof.totalViews,
                videos_count: prof.videosCount, engagement: prof.engagement,
                raw: prof.raw, scrape_status: "ok",
              },
              { onConflict: "channel_id,snapshot_date" }
            );
          }
        } catch { /* quét lỗi -> vẫn xác minh, baseline 0 */ }
      }
      const { error } = await db
        .from("channels")
        .update({
          status: "verified", verified_by: "admin", verified_at: new Date().toISOString(),
          baseline_followers: 0, baseline_views: 0,
        })
        .eq("id", ch.id)
        .eq("status", "pending"); // tránh đè kênh vừa đổi trạng thái giữa chừng
      return { platform: ch.platform, username: ch.username, scraped, ok: !error };
    })
  );

  const okCount = results.filter((r) => r.ok).length;
  await db.from("audit_logs").insert({
    actor_id: "admin", action: "verify_all_pending", target_type: "system",
    detail: { verified: okCount, results } as any,
  });
  return NextResponse.json({ verified: okCount, results });
}
