import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireStudent, jsonError } from "@/lib/api";
import { normalizeChannel } from "@/lib/channels";
import { resolveFacebookShareUrl } from "@/lib/scrape";
import { ChannelOpError, applyChannelEdit, retireChannel, studentIsLocked } from "@/lib/channelOps";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOCKED_MSG = "Tài khoản đang bị khóa, liên hệ admin";
const REMOVED_MSG = "Kênh này đã bị trợ giảng gỡ — liên hệ trợ giảng nếu cần khôi phục.";
const FLAGGED_MSG = "Kênh đang bị gắn cờ — liên hệ trợ giảng để xử lý.";

/**
 * Học viên SỬA kênh của mình — đổi nền tảng / link.
 *  - Chờ xác minh: sửa tại chỗ.
 *  - Đã xác minh: đổi sang kênh khác = đăng ký kênh mới (chờ xác minh lại) + gỡ kênh cũ và điểm của nó
 *    ở các chiến dịch đang chạy. Làm được bất cứ lúc nào (kể cả quá hạn đăng ký) — chủ trương của ban tổ chức.
 *  - Bị gắn cờ: khóa — nếu cho sửa thì học viên tự xóa được cờ gian lận.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireStudent();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const sid = auth.session.sid!;
  const body = await req.json().catch(() => null);
  if (!body) return jsonError("Dữ liệu không hợp lệ");

  const { data: ch } = await db
    .from("channels")
    .select("id, student_id, platform, username, url, status")
    .eq("id", params.id)
    .eq("student_id", sid)
    .maybeSingle();
  if (!ch) return jsonError("Không tìm thấy kênh của bạn", 404);
  if (await studentIsLocked(db, sid)) return jsonError(LOCKED_MSG, 403);
  if (ch.status === "removed") return jsonError(REMOVED_MSG);
  if (ch.status === "flagged") return jsonError(FLAGGED_MSG);

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
    const r = await applyChannelEdit(db, ch, norm, { id: sid, role: "student" });
    return NextResponse.json({ ok: true, replaced: r.replaced, identity_changed: r.identityChanged, channel: r.channel });
  } catch (e) {
    if (e instanceof ChannelOpError) return jsonError(e.message, e.status);
    throw e;
  }
}

/**
 * Học viên XÓA kênh của mình.
 *  - Chờ xác minh: xóa luôn (chưa có điểm).
 *  - Đã xác minh: xóa kèm điểm của kênh ở các chiến dịch đang chạy (chiến dịch đã kết thúc giữ nguyên).
 *    Làm được bất cứ lúc nào (kể cả quá hạn đăng ký).
 *  - Bị gắn cờ: khóa — gỡ rồi đăng ký lại sẽ xóa sạch dấu vết nghi vấn.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireStudent();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const sid = auth.session.sid!;

  const { data: ch } = await db
    .from("channels")
    .select("id, student_id, platform, username, url, status")
    .eq("id", params.id)
    .eq("student_id", sid)
    .maybeSingle();
  if (!ch) return jsonError("Không tìm thấy kênh của bạn", 404);
  if (await studentIsLocked(db, sid)) return jsonError(LOCKED_MSG, 403);
  if (ch.status === "removed") return jsonError(REMOVED_MSG);
  if (ch.status === "flagged") return jsonError(FLAGGED_MSG);

  try {
    const r = await retireChannel(db, ch, { actor: { id: sid, role: "student" }, action: "student_remove_channel" });
    return NextResponse.json({ ok: true, wiped_campaigns: r.wipedCampaigns });
  } catch (e) {
    if (e instanceof ChannelOpError) return jsonError(e.message, e.status);
    throw e;
  }
}
