import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Hồ sơ học viên đầy đủ (admin view): SĐT, kênh + baseline + số mới nhất, lịch sử điểm. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAdmin();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();

  const { data: student } = await db
    .from("students")
    .select("id, public_id, full_name, phone, status, created_at, classes(name)")
    .eq("id", params.id)
    .maybeSingle();
  if (!student) return jsonError("Không tìm thấy học viên", 404);

  const { data: channels } = await db
    .from("channels")
    .select("id, platform, url, username, status, baseline_followers, baseline_views, verified_at, fb_page_id, fb_token, fb_token_expires")
    .eq("student_id", params.id)
    .order("created_at");

  const chIds = (channels ?? []).map((c) => c.id);
  const latestByCh = new Map<string, any>();
  if (chIds.length) {
    const { data: snaps } = await db
      .from("channel_snapshots")
      .select("channel_id, snapshot_date, followers, total_views, videos_count")
      .in("channel_id", chIds)
      .order("snapshot_date", { ascending: false })
      .limit(chIds.length * 2);
    for (const s of snaps ?? []) if (!latestByCh.has(s.channel_id)) latestByCh.set(s.channel_id, s);
  }

  const { data: entries } = await db
    .from("score_entries")
    .select("entry_date, metric, raw_value, weight, points, note, created_by, campaigns(name)")
    .eq("student_id", params.id)
    .order("entry_date", { ascending: false })
    .limit(200);

  const { data: parts } = await db
    .from("campaign_participants")
    .select("campaign_id, total_score, current_rank, campaigns(name, status)")
    .eq("student_id", params.id);

  return NextResponse.json({
    student,
    channels: (channels ?? []).map(({ fb_token, ...c }: any) => ({ ...c, has_token: !!fb_token, latest: latestByCh.get(c.id) ?? null })),
    participations: (parts ?? []).map((p: any) => ({
      campaign_id: p.campaign_id,
      campaign_name: p.campaigns?.name,
      campaign_status: p.campaigns?.status,
      total_score: Number(p.total_score),
      rank: p.current_rank,
    })),
    score_entries: (entries ?? []).map((e: any) => ({
      ...e,
      campaign_name: e.campaigns?.name,
      points: Number(e.points),
    })),
  });
}

/** Khóa / mở khóa học viên (nghi gian lận). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAdmin();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const body = await req.json().catch(() => null);
  const lock = body?.status === "locked";
  const { error } = await db
    .from("students")
    .update({ status: lock ? "locked" : "active" })
    .eq("id", params.id);
  if (error) return jsonError("Không cập nhật được", 500);
  await db.from("audit_logs").insert({
    actor_id: "admin", action: lock ? "lock_student" : "unlock_student",
    target_type: "student", target_id: params.id, detail: { reason: body?.reason ?? null },
  });
  return NextResponse.json({ ok: true });
}

/**
 * Xóa hẳn hồ sơ học viên — hành động KHÔNG hoàn tác được.
 * Cascade xóa theo: kênh (giải phóng username cho người khác đăng ký), snapshot, điểm, ghi danh chiến dịch.
 * Bắt buộc kèm ?reason=. Audit log lưu lại đủ thông tin nhận diện sau khi xóa.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAdmin();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const reason = req.nextUrl.searchParams.get("reason");
  if (!reason?.trim()) return jsonError("Cần nhập lý do xóa hồ sơ");

  const { data: st } = await db.from("students").select("id, public_id, full_name, phone").eq("id", params.id).maybeSingle();
  if (!st) return jsonError("Không tìm thấy học viên", 404);
  const { data: chans } = await db.from("channels").select("platform, username").eq("student_id", st.id);

  const { error } = await db.from("students").delete().eq("id", st.id);
  if (error) return jsonError("Không xóa được hồ sơ", 500);

  await db.from("audit_logs").insert({
    actor_id: "admin", action: "delete_student", target_type: "student", target_id: st.id,
    detail: {
      public_id: st.public_id, full_name: st.full_name, reason,
      channels: (chans ?? []).map((c) => `${c.platform}:@${c.username}`),
    },
  });
  return NextResponse.json({ ok: true });
}
