import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { jsonError } from "@/lib/api";
import { setSession } from "@/lib/session";
import { GoogleAuthError, googleClientId, verifyGoogleIdToken } from "@/lib/google";

export const dynamic = "force-dynamic";

/** Cấu hình công khai cho nút Google ở client (đọc lúc chạy, khỏi phải build lại khi đổi). null = chưa bật. */
export async function GET() {
  return NextResponse.json({ client_id: await googleClientId() });
}

/**
 * Đăng nhập học viên bằng Google. body: { credential } — ID token từ nút Google.
 * Tài khoản được nhận ra bằng EMAIL đã khai lúc đăng ký (hoặc đã liên kết trong Dashboard); email do Google xác nhận.
 * Chưa có học viên nào dùng email này -> 404 { not_registered } để trang đăng nhập hướng dẫn đăng ký/liên kết.
 */
export async function POST(req: NextRequest) {
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
  const { data: student, error } = await db
    .from("students")
    .select("id, status, email_verified")
    .eq("email", id.email)
    .maybeSingle();
  if (error) return jsonError("Hệ thống đang nâng cấp, thử đăng nhập bằng số điện thoại nhé", 503);
  if (!student) {
    return jsonError("Email này chưa gắn với học viên nào", 404, { not_registered: true, email: id.email });
  }
  if (student.status === "locked") return jsonError("Tài khoản đang bị khóa, liên hệ admin", 403);

  // Google đã xác nhận email này -> đánh dấu xác minh (trường hợp học viên tự gõ email lúc đăng ký)
  if (!student.email_verified) await db.from("students").update({ email_verified: true }).eq("id", student.id);

  setSession({ role: "student", sid: student.id });
  return NextResponse.json({ ok: true });
}
