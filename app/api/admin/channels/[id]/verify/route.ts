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
 * Xác minh tay một kênh. Baseline (mốc xuất phát) lấy theo thứ tự ưu tiên:
 *  1) Số liệu quét TRỰC TIẾP ngay lúc bấm — chuẩn nhất, admin khỏi đoán số
 *  2) Snapshot mới nhất đã có trong DB
 *  3) Số admin nhập tay (nếu quét lỗi và không có snapshot)
 * Luôn ghi log ai duyệt, lúc nào, baseline lấy từ nguồn nào.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAdmin();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const body = await req.json().catch(() => ({}));

  const { data: ch } = await db.from("channels").select("*").eq("id", params.id).maybeSingle();
  if (!ch) return jsonError("Không tìm thấy kênh", 404);
  if (ch.status === "removed") return jsonError("Kênh đã bị gỡ");

  let baselineFollowers: number | null = null;
  let baselineViews: number | null = null;
  let source = "";

  // 1) Quét trực tiếp ngay để lấy số thật
  const scraper = SCRAPERS[ch.platform];
  if (scraper) {
    try {
      const prof = await scraper(ch.username);
      if (prof && prof.followers != null) {
        baselineFollowers = prof.followers;
        baselineViews = prof.totalViews;
        source = "quét trực tiếp";
        // lưu luôn snapshot hôm nay để không phải quét lại
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
      /* quét lỗi -> rơi xuống fallback */
    }
  }

  // 2) Snapshot mới nhất đã có
  if (baselineFollowers === null) {
    const { data: snap } = await db
      .from("channel_snapshots")
      .select("followers, total_views")
      .eq("channel_id", ch.id)
      .eq("scrape_status", "ok")
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snap?.followers != null) {
      baselineFollowers = snap.followers;
      baselineViews = snap.total_views != null ? Number(snap.total_views) : null;
      source = "snapshot gần nhất";
    }
  }

  // 3) Số admin nhập tay (chốt chặn cuối)
  if (baselineFollowers === null) {
    if (body?.baseline_followers != null) {
      baselineFollowers = Number(body.baseline_followers);
      baselineViews = body?.baseline_views != null ? Number(body.baseline_views) : (ch.baseline_views ?? 0);
      source = "admin nhập tay";
    } else {
      return jsonError(
        "Chưa quét được số liệu kênh này (trang có thể bắt đăng nhập hoặc sai link). " +
        "Kiểm tra lại link kênh, hoặc nhập baseline follower thủ công để xác minh."
      );
    }
  }

  const { error } = await db
    .from("channels")
    .update({
      status: "verified",
      verified_at: new Date().toISOString(),
      verified_by: "admin",
      baseline_followers: baselineFollowers,
      baseline_views: baselineViews ?? 0,
    })
    .eq("id", ch.id);
  if (error) return jsonError("Không cập nhật được", 500);

  await db.from("audit_logs").insert({
    actor_id: "admin", action: "verify_channel_manual", target_type: "channel", target_id: ch.id,
    detail: { previous_status: ch.status, baseline_followers: baselineFollowers, baseline_views: baselineViews, source },
  });
  return NextResponse.json({ ok: true, baseline_followers: baselineFollowers, source });
}
