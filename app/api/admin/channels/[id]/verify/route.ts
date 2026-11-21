import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin, jsonError } from "@/lib/api";
import { scrapeTikTokProfile, scrapeFacebookPage, scrapeYouTubeChannel } from "@/lib/scrape";
import { todayVN } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Xác minh tay 1 kênh -> YouTube đếm luôn tương tác (chỉ ~3 đơn vị hạn mức cho 1 kênh)
const SCRAPERS: Record<string, (u: string, o?: { withEngagement?: boolean }) => Promise<any>> = {
  tiktok: scrapeTikTokProfile,
  facebook: scrapeFacebookPage,
  youtube: scrapeYouTubeChannel,
};

/**
 * Xác minh tay một kênh, HOẶC gỡ cờ gian lận cho kênh đang bị gắn cờ (xem nhánh isUnflag bên dưới).
 * Mô hình điểm: tính TOÀN BỘ follower hiện có -> mốc khởi điểm (baseline) = 0
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
      const prof = await scraper(ch.username, { withEngagement: true });
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

  // GỠ CỜ khác hẳn XÁC MINH LẦN ĐẦU. Kênh bị gắn cờ là kênh đã đua rồi, đã ăn điểm theo mốc cũ.
  // Kéo verified_at về hôm nay thì job tính điểm không nhận snapshot trước đó nữa, dF thành TOÀN BỘ
  // follower, vượt xa avg7 -> luật chống gian lận gắn cờ lại ngay lượt chấm sau. Gỡ bao nhiêu lần
  // cũng vô ích. Nên khi gỡ cờ chỉ đổi status, giữ nguyên verified_at và baseline.
  const isUnflag = ch.status === "flagged" && ch.verified_at != null;

  const patch: Record<string, unknown> = { status: "verified", verified_by: "admin" };
  if (!isUnflag) {
    // Xác minh lần đầu: chốt mốc khởi điểm. Mặc định 0 = tính toàn bộ follower hiện có thành điểm.
    patch.verified_at = new Date().toISOString();
    patch.baseline_followers = body?.baseline_followers != null ? Number(body.baseline_followers) : 0;
    patch.baseline_views = body?.baseline_views != null ? Number(body.baseline_views) : 0;
  } else {
    // Gỡ cờ mà admin cố ý ép mốc mới thì tôn trọng, nhưng vẫn không đụng vào verified_at.
    if (body?.baseline_followers != null) patch.baseline_followers = Number(body.baseline_followers);
    if (body?.baseline_views != null) patch.baseline_views = Number(body.baseline_views);
  }

  const { error } = await db.from("channels").update(patch).eq("id", ch.id);
  if (error) return jsonError("Không cập nhật được", 500);

  const baselineFollowers = (patch.baseline_followers ?? ch.baseline_followers) as number | null;
  await db.from("audit_logs").insert({
    actor_id: "admin",
    action: isUnflag ? "unflag_channel" : "verify_channel_manual",
    target_type: "channel",
    target_id: ch.id,
    detail: { previous_status: ch.status, baseline_followers: baselineFollowers, kept_verified_at: isUnflag, scraped },
  });
  return NextResponse.json({ ok: true, unflagged: isUnflag, baseline_followers: baselineFollowers, scraped });
}
