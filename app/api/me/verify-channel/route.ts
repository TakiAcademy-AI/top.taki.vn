import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireStudent, jsonError } from "@/lib/api";
import { scrapeTikTokProfile, scrapeFacebookPage } from "@/lib/scrape";
import { todayVN } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SCRAPERS: Record<string, (u: string) => Promise<any>> = {
  tiktok: scrapeTikTokProfile,
  facebook: scrapeFacebookPage,
};

/**
 * Học viên tự bấm "Xác minh ngay" một kênh của mình sau khi đã dán mã vào bio —
 * quét kênh on-demand thay vì đợi cron 5:30. Chỉ tác động kênh của chính mình, đang pending.
 * Chống spam: mỗi kênh chỉ quét lại sau 90 giây (tránh làm nền tảng chặn IP).
 */
export async function POST(req: NextRequest) {
  const auth = requireStudent();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const sid = auth.session.sid!;
  const body = await req.json().catch(() => ({}));
  const channelId = String(body?.channel_id ?? "");
  if (!channelId) return jsonError("Thiếu channel_id");

  const { data: ch } = await db
    .from("channels")
    .select("*, students!inner(public_id)")
    .eq("id", channelId)
    .eq("student_id", sid) // chỉ kênh của chính mình
    .maybeSingle();
  if (!ch) return jsonError("Không tìm thấy kênh của bạn", 404);
  if (ch.status === "verified") return NextResponse.json({ ok: true, already: true, status: "verified" });
  if (ch.status === "removed") return jsonError("Kênh đã bị gỡ");
  if (ch.status === "flagged") return jsonError("Kênh đang bị gắn cờ — liên hệ trợ giảng để xử lý");

  // Chống spam: nếu vừa quét trong 90 giây thì chặn
  const { data: recent } = await db
    .from("channel_snapshots")
    .select("created_at")
    .eq("channel_id", ch.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent?.created_at && Date.now() - new Date(recent.created_at).getTime() < 90_000) {
    return jsonError("Bạn vừa quét kênh này xong — đợi khoảng 1 phút rồi thử lại nhé.");
  }

  const scraper = SCRAPERS[ch.platform];
  if (!scraper) return jsonError("Nền tảng này chưa hỗ trợ tự xác minh — chờ hệ thống quét lúc 5:30 sáng.");

  let prof: any = null;
  try {
    prof = await scraper(ch.username);
  } catch {
    prof = null;
  }
  if (!prof) {
    return jsonError("Chưa đọc được kênh (trang có thể bắt đăng nhập hoặc sai link). Thử lại sau ít phút hoặc kiểm tra link kênh.");
  }

  const publicId: string = ch.students?.public_id ?? "";
  const date = todayVN();

  // Lưu snapshot hôm nay
  await db.from("channel_snapshots").upsert(
    {
      channel_id: ch.id, snapshot_date: date,
      followers: prof.followers, total_views: prof.totalViews,
      videos_count: prof.videosCount, engagement: prof.engagement,
      raw: prof.raw, scrape_status: "ok",
    },
    { onConflict: "channel_id,snapshot_date" }
  );

  // Bio chứa mã ID -> xác minh + chốt baseline
  const bioOk = publicId && String(prof.bio ?? "").toUpperCase().includes(publicId.toUpperCase());
  if (bioOk) {
    await db
      .from("channels")
      .update({
        status: "verified",
        verified_at: new Date().toISOString(),
        verified_by: "self",
        baseline_followers: prof.followers,
        baseline_views: prof.totalViews,
      })
      .eq("id", ch.id);
    await db.from("audit_logs").insert({
      actor_id: sid, action: "verify_channel_self", target_type: "channel", target_id: ch.id,
      detail: { public_id: publicId, followers: prof.followers },
    });
    return NextResponse.json({ ok: true, status: "verified", followers: prof.followers });
  }

  // Không thấy mã trong bio
  return NextResponse.json({
    ok: false,
    status: "pending",
    reason: "no_code",
    message: `Chưa thấy mã ${publicId} trong bio/mô tả kênh. Hãy chèn đúng mã này rồi bấm lại.`,
  });
}
