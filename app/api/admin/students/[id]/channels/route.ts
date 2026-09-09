import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin, jsonError } from "@/lib/api";
import { normalizeChannel } from "@/lib/channels";
import { resolveFacebookShareUrl } from "@/lib/scrape";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Admin thêm kênh tay cho một học viên. Chấp nhận mọi dạng link (kể cả /share/ FB). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAdmin();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const body = await req.json().catch(() => null);
  if (!body) return jsonError("Dữ liệu không hợp lệ");

  const { data: student } = await db.from("students").select("id").eq("id", params.id).maybeSingle();
  if (!student) return jsonError("Không tìm thấy học viên", 404);

  let norm;
  try {
    const platform = String(body.platform ?? "");
    let url = String(body.url ?? "");
    if (platform === "facebook" && /facebook\.com\/share\//i.test(url)) url = await resolveFacebookShareUrl(url);
    norm = normalizeChannel(platform, url);
  } catch (e: any) {
    return jsonError(e.message);
  }

  const { data: ch, error } = await db
    .from("channels")
    .insert({ student_id: student.id, platform: norm.platform, url: norm.url, username: norm.username })
    .select()
    .single();
  if (error) {
    if ((error as any).code === "23505") return jsonError("Kênh này đã được đăng ký trong hệ thống");
    return jsonError("Không thêm được kênh", 500);
  }

  await db.from("audit_logs").insert({
    actor_id: "admin", action: "add_channel_manual", target_type: "channel", target_id: ch.id,
    detail: { student_id: student.id, platform: norm.platform, username: norm.username },
  });
  return NextResponse.json({ ok: true, channel: ch });
}
