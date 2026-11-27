import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin, jsonError } from "@/lib/api";
import { recomputeRanks } from "@/lib/scoring";
import { todayVN } from "@/lib/format";
import { normalizeChannel } from "@/lib/channels";
import { resolveFacebookShareUrl } from "@/lib/scrape";
import { invalidate } from "@/lib/cache";
import { ChannelOpError, applyChannelEdit } from "@/lib/channelOps";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Gỡ kênh (mặc định gỡ mềm: status = removed — ngừng quét/tính điểm). Thêm ?hard=1 để xóa hẳn khỏi DB.
 * DÙ GỠ MỀM HAY HARD: XÓA HẾT ĐIỂM của kênh này (score_entries) rồi tính lại tổng/hạng — kênh bị gỡ
 * không còn đóng góp điểm. Chỉ kênh hợp lệ (verified) mới được tính điểm ở các lần chấm sau.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAdmin();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const hard = req.nextUrl.searchParams.get("hard") === "1";
  const reason = req.nextUrl.searchParams.get("reason") || null;

  const { data: ch } = await db.from("channels").select("*").eq("id", params.id).maybeSingle();
  if (!ch) return jsonError("Không tìm thấy kênh", 404);
  if (!hard && ch.status === "removed") return jsonError("Kênh đã được gỡ trước đó");

  // Xóa điểm của kênh này TRƯỚC (để hard-delete không làm channel_id thành null mà vẫn còn điểm)
  const { data: camps } = await db
    .from("campaign_participants")
    .select("campaign_id")
    .eq("student_id", ch.student_id);
  await db.from("score_entries").delete().eq("channel_id", ch.id);

  if (hard) {
    const { error } = await db.from("channels").delete().eq("id", ch.id);
    if (error) return jsonError("Không xóa được kênh", 500);
  } else {
    const { error } = await db.from("channels").update({ status: "removed" }).eq("id", ch.id);
    if (error) return jsonError("Không gỡ được kênh", 500);
  }

  // Tính lại tổng điểm + hạng cho các chiến dịch học viên tham gia (điểm kênh gỡ đã biến mất)
  const today = todayVN();
  for (const c of camps ?? []) await recomputeRanks(c.campaign_id, today);
  invalidate("home");
  invalidate("lb:");

  await db.from("audit_logs").insert({
    actor_id: "admin",
    action: hard ? "delete_channel" : "remove_channel",
    target_type: "channel",
    target_id: ch.id,
    detail: { platform: ch.platform, username: ch.username, previous_status: ch.status, reason },
  });
  return NextResponse.json({ ok: true, hard });
}

/**
 * Hai việc, phân biệt theo body:
 *  - Có { platform?, url } -> SỬA link kênh thay học viên (mọi trạng thái trừ đã gỡ). Đổi sang kênh khác thì
 *    kênh đã xác minh/gắn cờ được thay bằng kênh mới chờ xác minh, điểm kênh cũ ở chiến dịch đang chạy bị xóa.
 *  - Không body -> KHÔI PHỤC kênh đã gỡ: quay về chờ xác minh, lần quét kế tiếp sẽ xác minh lại.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAdmin();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const body = await req.json().catch(() => null);

  const { data: ch } = await db.from("channels").select("*").eq("id", params.id).maybeSingle();
  if (!ch) return jsonError("Không tìm thấy kênh", 404);

  if (body && (body.url != null || body.platform != null)) {
    if (ch.status === "removed") return jsonError("Kênh đã gỡ — khôi phục trước rồi mới sửa được");
    let norm;
    try {
      const platform = String(body.platform ?? ch.platform);
      let url = String(body.url ?? ch.url);
      if (platform === "facebook" && /facebook\.com\/share\//i.test(url)) url = await resolveFacebookShareUrl(url);
      norm = normalizeChannel(platform, url);
    } catch (e: any) {
      return jsonError(e.message);
    }
    try {
      const r = await applyChannelEdit(db, ch, norm, { id: "admin", role: "admin" });
      return NextResponse.json({ ok: true, replaced: r.replaced, identity_changed: r.identityChanged, channel: r.channel });
    } catch (e) {
      if (e instanceof ChannelOpError) return jsonError(e.message, e.status);
      throw e;
    }
  }

  if (ch.status !== "removed") return jsonError("Kênh này chưa bị gỡ");

  const { error } = await db.from("channels").update({ status: "pending" }).eq("id", ch.id);
  if (error) return jsonError("Không khôi phục được kênh", 500);

  await db.from("audit_logs").insert({
    actor_id: "admin",
    action: "restore_channel",
    target_type: "channel",
    target_id: ch.id,
    detail: { platform: ch.platform, username: ch.username },
  });
  return NextResponse.json({ ok: true });
}
