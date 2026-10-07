import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin, jsonError } from "@/lib/api";
import { scrapeFacebookGraph } from "@/lib/graph";
import { graphScrapeChannel } from "@/lib/scrape";
import { runDailyScoring } from "@/lib/scoring";
import { todayVN } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Nhập/cập nhật Graph API token cho 1 kênh (pilot: admin dán tay token học viên cấp).
 *  body: { page_id, token, expires? (ISO) }. Lưu xong ĐỌC THỬ qua Graph -> trả số để xác thực token đúng. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAdmin();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const body = await req.json().catch(() => null);
  const token = String(body?.token || "").trim();
  const pageId = String(body?.page_id || "").trim();
  if (!token) return jsonError("Thiếu token");

  const { data: ch } = await db.from("channels").select("id, username, platform").eq("id", params.id).maybeSingle();
  if (!ch) return jsonError("Không tìm thấy kênh", 404);
  if (ch.platform !== "facebook") return jsonError("Chỉ áp dụng kênh Facebook");

  const targetId = pageId || ch.username;
  // Đọc thử TRƯỚC khi lưu -> token sai thì báo lỗi, không lưu rác.
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

  const expires = body?.expires ? new Date(body.expires).toISOString() : null;
  const { error } = await db
    .from("channels")
    .update({ fb_page_id: pageId || null, fb_token: token, fb_token_expires: expires })
    .eq("id", ch.id);
  if (error) return jsonError("Không lưu được token", 500);

  // Quét + chấm điểm NGAY để số cập nhật tức thì (khỏi chờ cron 30').
  const date = todayVN();
  try { await graphScrapeChannel(ch.id, date); await runDailyScoring(date); } catch { /* không chặn việc lưu token */ }

  return NextResponse.json({ ok: true, channel: ch.username, preview });
}

/** Gỡ token của kênh (quay về quét bằng curl/extension như cũ). */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAdmin();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const { error } = await db
    .from("channels")
    .update({ fb_page_id: null, fb_token: null, fb_token_expires: null })
    .eq("id", params.id);
  if (error) return jsonError("Không gỡ được token", 500);
  return NextResponse.json({ ok: true });
}
