import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireStudent, jsonError } from "@/lib/api";
import { scrapeFacebookGraph } from "@/lib/graph";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Học viên tự gắn Graph API token cho KÊNH FACEBOOK của mình -> hệ thống đọc số chính xác qua Graph.
 *  body: { channel_id, page_id, token }. Đọc thử trước khi lưu để xác thực token đúng (không lưu rác). */
export async function POST(req: NextRequest) {
  const auth = requireStudent();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const sid = auth.session.sid!;
  const body = await req.json().catch(() => ({}));
  const channelId = String(body?.channel_id ?? "");
  const token = String(body?.token ?? "").trim();
  const pageId = String(body?.page_id ?? "").trim();
  if (!channelId || !token) return jsonError("Thiếu channel_id hoặc token");

  const { data: ch } = await db
    .from("channels")
    .select("id, username, platform")
    .eq("id", channelId)
    .eq("student_id", sid) // chỉ kênh của chính mình
    .maybeSingle();
  if (!ch) return jsonError("Không tìm thấy kênh của bạn", 404);
  if (ch.platform !== "facebook") return jsonError("Chỉ áp dụng cho kênh Facebook");

  const targetId = pageId || ch.username;
  let preview: { followers: number | null; reels: number; total_reel_views: number; engagement: number | null } | null = null;
  try {
    const res = await scrapeFacebookGraph(targetId, token);
    if (!res) return jsonError("Token hợp lệ nhưng không đọc được dữ liệu kênh");
    preview = {
      followers: res.profile.followers,
      reels: res.reels.length,
      total_reel_views: res.reels.reduce((s, r) => s + r.views, 0),
      engagement: res.profile.engagement,
    };
  } catch (e: any) {
    return jsonError(`Token không đọc được: ${String(e?.message ?? e).slice(0, 160)}`, 400);
  }

  const { error } = await db
    .from("channels")
    .update({ fb_page_id: pageId || null, fb_token: token, fb_token_expires: null })
    .eq("id", ch.id)
    .eq("student_id", sid);
  if (error) return jsonError("Không lưu được token", 500);

  return NextResponse.json({ ok: true, preview });
}

/** Gỡ token của kênh mình (quay về quét bằng curl/extension như cũ). body: { channel_id } */
export async function DELETE(req: NextRequest) {
  const auth = requireStudent();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const sid = auth.session.sid!;
  const body = await req.json().catch(() => ({}));
  const channelId = String(body?.channel_id ?? "");
  if (!channelId) return jsonError("Thiếu channel_id");
  const { error } = await db
    .from("channels")
    .update({ fb_page_id: null, fb_token: null, fb_token_expires: null })
    .eq("id", channelId)
    .eq("student_id", sid);
  if (error) return jsonError("Không gỡ được token", 500);
  return NextResponse.json({ ok: true });
}
