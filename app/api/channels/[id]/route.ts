import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireStudent, jsonError } from "@/lib/api";
import { normalizeChannel } from "@/lib/channels";
import { resolveFacebookShareUrl } from "@/lib/scrape";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Học viên SỬA kênh của mình — đổi nền tảng / link.
 * Chỉ khi kênh CHƯA xác minh (verified rồi mà đổi link sẽ loạn baseline/điểm).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireStudent();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const sid = auth.session.sid!;
  const body = await req.json().catch(() => null);
  if (!body) return jsonError("Dữ liệu không hợp lệ");

  const { data: ch } = await db.from("channels").select("*").eq("id", params.id).eq("student_id", sid).maybeSingle();
  if (!ch) return jsonError("Không tìm thấy kênh của bạn", 404);
  if (ch.status === "verified") return jsonError("Kênh đã xác minh — không sửa được link. Nếu cần đổi, hãy gỡ kênh và thêm lại.");
  if (ch.status === "removed") return jsonError("Kênh đã bị gỡ");

  let norm;
  try {
    const platform = String(body.platform ?? ch.platform);
    let url = String(body.url ?? ch.url);
    if (platform === "facebook" && /facebook\.com\/share\//i.test(url)) url = await resolveFacebookShareUrl(url);
    norm = normalizeChannel(platform, url);
  } catch (e: any) {
    return jsonError(e.message);
  }

  const { error } = await db
    .from("channels")
    .update({ platform: norm.platform, url: norm.url, username: norm.username, status: "pending" })
    .eq("id", ch.id);
  if (error) {
    if ((error as any).code === "23505") return jsonError("Kênh này đã được đăng ký trong hệ thống");
    return jsonError("Không sửa được kênh", 500);
  }
  return NextResponse.json({ ok: true, channel: { platform: norm.platform, username: norm.username, url: norm.url } });
}

/** Học viên XÓA kênh của mình (chỉ kênh chưa xác minh — tránh mất lịch sử điểm). */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireStudent();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const sid = auth.session.sid!;

  const { data: ch } = await db.from("channels").select("id, status").eq("id", params.id).eq("student_id", sid).maybeSingle();
  if (!ch) return jsonError("Không tìm thấy kênh của bạn", 404);
  if (ch.status === "verified") return jsonError("Kênh đã xác minh và đang tính điểm — liên hệ trợ giảng nếu cần gỡ.");

  const { error } = await db.from("channels").delete().eq("id", ch.id);
  if (error) return jsonError("Không xóa được kênh", 500);
  return NextResponse.json({ ok: true });
}
