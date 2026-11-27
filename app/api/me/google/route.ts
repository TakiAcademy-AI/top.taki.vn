import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireStudent, jsonError } from "@/lib/api";
import { GoogleAuthError, verifyGoogleIdToken } from "@/lib/google";

export const dynamic = "force-dynamic";

/**
 * Học viên đang đăng nhập (bằng SĐT) LIÊN KẾT tài khoản Google: email Google trở thành email của hồ sơ
 * (đã xác minh) -> từ nay đăng nhập được bằng Google. body: { credential }.
 * Đây là đường để học viên cũ (đăng ký trước khi có email) dùng được đăng nhập Google.
 */
export async function POST(req: NextRequest) {
  const auth = requireStudent();
  if ("error" in auth) return auth.error;
  const sid = auth.session.sid!;
  const body = await req.json().catch(() => null);
  if (!body?.credential) return jsonError("Dữ liệu không hợp lệ");

  let id;
  try {
    id = await verifyGoogleIdToken(String(body.credential));
  } catch (e) {
    if (e instanceof GoogleAuthError) return jsonError(e.message, e.status, { google_expired: e.expired });
    throw e;
  }

  const db = supabaseAdmin();
  const { data: owner, error: qErr } = await db.from("students").select("id").eq("email", id.email).maybeSingle();
  if (qErr) return jsonError("Hệ thống đang nâng cấp, thử lại sau ít phút", 503);
  if (owner && owner.id !== sid) return jsonError("Email Google này đã được học viên khác sử dụng", 409);

  const { error } = await db.from("students").update({ email: id.email, email_verified: true }).eq("id", sid);
  if (error) {
    if ((error as any).code === "23505") return jsonError("Email Google này đã được học viên khác sử dụng", 409);
    return jsonError("Không liên kết được Google", 500);
  }
  await db.from("audit_logs").insert({
    actor_id: sid, action: "link_google", target_type: "student", target_id: sid, detail: { email: id.email },
  });
  return NextResponse.json({ ok: true, email: id.email });
}
