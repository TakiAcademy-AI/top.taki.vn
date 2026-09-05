import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { PLATFORM_LABEL } from "@/lib/channels";

export const dynamic = "force-dynamic";

/** Danh sách nền tảng ĐANG BẬT — để form đăng ký / thêm kênh chỉ hiện nền tảng nhận đăng ký. Public. */
export async function GET() {
  const db = supabaseAdmin();
  const { data } = await db.from("platform_configs").select("platform").eq("is_active", true);
  const order = ["tiktok", "facebook", "youtube", "instagram"];
  const active = (data ?? [])
    .map((c) => c.platform)
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((p) => ({ value: p, label: (PLATFORM_LABEL as Record<string, string>)[p] ?? p }));
  return NextResponse.json({ platforms: active });
}
