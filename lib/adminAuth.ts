import crypto from "crypto";
import { supabaseAdmin } from "./supabase";
import { adminPwHash } from "./session";

/** Tài khoản admin (lưu DB, mặc định ai@taki.vn). So khớp không phân biệt hoa thường. */
export async function getAdminAccount(): Promise<string> {
  const db = supabaseAdmin();
  const { data } = await db.from("app_settings").select("value").eq("key", "admin_account").maybeSingle();
  return String(data?.value || "ai@taki.vn").trim().toLowerCase();
}

/** Kiểm mật khẩu admin: ưu tiên hash trong app_settings; chưa đặt thì rơi về env ADMIN_PASSWORD (bootstrap). */
export async function verifyAdminPassword(password: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data } = await db.from("app_settings").select("value").eq("key", "admin_password_hash").maybeSingle();
  if (data?.value) {
    try {
      const a = Buffer.from(adminPwHash(password), "hex");
      const b = Buffer.from(String(data.value), "hex");
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch { return false; }
  }
  const env = process.env.ADMIN_PASSWORD;
  if (!env) return false;
  const a = crypto.createHash("sha256").update(password).digest();
  const b = crypto.createHash("sha256").update(env).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Đặt mật khẩu admin mới (ghi hash vào app_settings). */
export async function setAdminPassword(newPw: string): Promise<void> {
  const db = supabaseAdmin();
  await db.from("app_settings").upsert({ key: "admin_password_hash", value: adminPwHash(newPw) }, { onConflict: "key" });
}
