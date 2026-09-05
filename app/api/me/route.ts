import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireStudent, jsonError } from "@/lib/api";
import { addDays, todayVN } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Hồ sơ, kênh, chỉ số 7 ngày, và hạng/điểm ở từng chiến dịch của học viên đang đăng nhập. */
export async function GET() {
  const auth = requireStudent();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const sid = auth.session.sid!;

  const { data: student } = await db
    .from("students")
    .select("id, public_id, full_name, phone, status, classes(name)")
    .eq("id", sid)
    .maybeSingle();
  if (!student) return jsonError("Không tìm thấy hồ sơ", 404);

  const { data: channels } = await db
    .from("channels")
    .select("id, platform, url, username, status, baseline_followers, verified_at, created_at")
    .eq("student_id", sid)
    .neq("status", "removed")
    .order("created_at");

  // Chỉ số 7 ngày so với 7 ngày trước đó, gộp mọi kênh verified
  const chIds = (channels ?? []).filter((c) => c.status === "verified").map((c) => c.id);
  const today = todayVN();
  const stats = {
    followers7: 0, views7: 0, videos7: 0, followers7prev: 0, views7prev: 0,
    latestByChannel: {} as Record<string, { followers: number | null; total_views: number | null; videos_count: number | null; snapshot_date: string } | null>,
  };
  if (chIds.length) {
    const { data: snaps } = await db
      .from("channel_snapshots")
      .select("channel_id, snapshot_date, followers, total_views, videos_count")
      .in("channel_id", chIds)
      .gte("snapshot_date", addDays(today, -14))
      .order("snapshot_date");
    const byCh = new Map<string, any[]>();
    for (const s of snaps ?? []) {
      if (!byCh.has(s.channel_id)) byCh.set(s.channel_id, []);
      byCh.get(s.channel_id)!.push(s);
    }
    for (const [chId, list] of byCh) {
      const at = (d: string) => list.filter((s) => s.snapshot_date <= d).at(-1);
      const now = list.at(-1);
      const w1 = at(addDays(today, -7));
      const w2 = at(addDays(today, -14));
      stats.latestByChannel[chId] = now
        ? {
            followers: now.followers ?? null,
            total_views: now.total_views != null ? Number(now.total_views) : null,
            videos_count: now.videos_count ?? null,
            snapshot_date: now.snapshot_date,
          }
        : null;
      if (now && w1) {
        stats.followers7 += Math.max(0, (now.followers ?? 0) - (w1.followers ?? 0));
        stats.views7 += Math.max(0, Number(now.total_views ?? 0) - Number(w1.total_views ?? 0));
        stats.videos7 += Math.max(0, (now.videos_count ?? 0) - (w1.videos_count ?? 0));
      }
      if (w1 && w2) {
        stats.followers7prev += Math.max(0, (w1.followers ?? 0) - (w2.followers ?? 0));
        stats.views7prev += Math.max(0, Number(w1.total_views ?? 0) - Number(w2.total_views ?? 0));
      }
    }
  }

  const { data: parts } = await db
    .from("campaign_participants")
    .select("campaign_id, total_score, current_rank, prev_rank, rank_updated_on, campaigns(name, end_date, weekly_quota, status)")
    .eq("student_id", sid);

  return NextResponse.json({
    student: {
      public_id: student.public_id,
      full_name: student.full_name,
      class_name: (student as any).classes?.name ?? null,
    },
    channels: channels ?? [],
    stats,
    participations: (parts ?? []).map((p: any) => ({
      campaign_id: p.campaign_id,
      campaign_name: p.campaigns?.name,
      campaign_status: p.campaigns?.status,
      end_date: p.campaigns?.end_date,
      weekly_quota: p.campaigns?.weekly_quota,
      total_score: Number(p.total_score),
      rank: p.current_rank,
      prev_rank: p.prev_rank,
      updated_on: p.rank_updated_on,
    })),
  });
}
