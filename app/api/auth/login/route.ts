import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { jsonError } from "@/lib/api";
import { setSession } from "@/lib/session";
import { normalizePhone } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Đăng nhập học viên đơn giản: tài khoản = số điện thoại, mật khẩu = số điện thoại.
 * (Theo yêu cầu vận hành — học viên dễ nhớ. Luồng OTP ở /api/auth/otp vẫn dùng được nếu cần.)
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return jsonError("Dữ liệu không hợp lệ");

  const phone = normalizePhone(String(body.phone ?? ""));
  if (!phone) return jsonError("Số điện thoại không đúng định dạng Việt Nam");

  // Mật khẩu chính là số điện thoại (chấp nhận có/không số 0 đầu, +84…)
  const pwPhone = normalizePhone(String(body.password ?? ""));
  if (!pwPhone || pwPhone !== phone) {
    return jsonError("Sai mật khẩu. Mật khẩu chính là số điện thoại của bạn.", 401);
  }

  const db = supabaseAdmin();
  const { data: student } = await db.from("students").select("id, status").eq("phone", phone).maybeSingle();
  if (!student) return jsonError("Số điện thoại chưa đăng ký. Vui lòng đăng ký để vào đường đua.", 404, { not_registered: true });
  if (student.status === "locked") return jsonError("Tài khoản đang bị khóa, liên hệ admin", 403);

  setSession({ role: "student", sid: student.id });
  return NextResponse.json({ ok: true });
}
