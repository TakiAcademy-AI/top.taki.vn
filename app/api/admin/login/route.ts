import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { setSession } from "@/lib/session";
import { getAdminAccount, verifyAdminPassword } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

/** Đăng nhập admin: cần TÀI KHOẢN (ai@taki.vn) + MẬT KHẨU. Credentials lưu trong app_settings
 *  (admin_account / admin_password_hash) — đổi được qua /api/admin/password, không cần sửa env/deploy.
 *  Mật khẩu chưa đặt trong DB thì rơi về env ADMIN_PASSWORD (bootstrap lần đầu). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const account = String(body?.account ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  const expectedAccount = await getAdminAccount();
  const okPw = await verifyAdminPassword(password);
  // Thông báo chung để không lộ tài khoản đúng/sai.
  if (account !== expectedAccount || !okPw) return jsonError("Sai tài khoản hoặc mật khẩu", 401);

  setSession({ role: "admin" });
  return NextResponse.json({ ok: true });
}
