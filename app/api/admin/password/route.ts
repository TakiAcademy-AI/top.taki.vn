import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, jsonError } from "@/lib/api";
import { verifyAdminPassword, setAdminPassword } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

/** Đổi mật khẩu admin. Cần đang đăng nhập admin + nhập đúng mật khẩu hiện tại. body: { current, new }. */
export async function POST(req: NextRequest) {
  const auth = requireAdmin();
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => null);
  const current = String(body?.current ?? "");
  const next = String(body?.new ?? "");
  if (next.length < 6) return jsonError("Mật khẩu mới phải từ 6 ký tự trở lên");
  if (!(await verifyAdminPassword(current))) return jsonError("Mật khẩu hiện tại không đúng", 401);
  await setAdminPassword(next);
  return NextResponse.json({ ok: true });
}
