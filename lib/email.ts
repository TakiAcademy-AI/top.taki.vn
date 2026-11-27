import type { SupabaseClient } from "@supabase/supabase-js";

/** Chuẩn hóa email: bỏ khoảng trắng, hạ chữ thường; trả null nếu sai định dạng. */
export function normalizeEmail(input: string): string | null {
  const e = input.trim().toLowerCase();
  if (e.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
}

let ready = false;

/**
 * Cột students.email đã có chưa (đã chạy migration 0002 chưa)? Các đường ĐỌC dùng cái này để khi deploy
 * code trước migration thì chỉ thiếu email, chứ không làm hỏng trang của học viên cũ. Có rồi thì nhớ luôn.
 */
export async function emailColumnReady(db: SupabaseClient): Promise<boolean> {
  if (ready) return true;
  const { error } = await db.from("students").select("email").limit(1);
  ready = !error;
  return ready;
}
