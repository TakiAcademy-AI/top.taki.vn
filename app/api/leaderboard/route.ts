import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

const METRICS = ["follower", "views", "new_video", "engagement", "weekly_bonus", "manual_adjust"] as const;

/**
 * Bảng xếp hạng public — không bao giờ trả SĐT. Cache CDN 5 phút.
 * ?detail=1: kèm điểm thành phần, điểm hôm nay, tổng follower/view/tương tác hiện tại,
 * % tăng follower so hôm qua và danh sách kênh (có link) của từng học viên.
 */
export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get("campaign_id");
  const detail = req.nextUrl.searchParams.get("detail") === "1";
  if (!campaignId) return jsonError("Thiếu campaign_id");
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("campaign_participants")
    .select("student_id, total_score, current_rank, prev_rank, rank_updated_on, students!inner(public_id, full_name, class_id, classes(name))")
    .eq("campaign_id", campaignId)
    .limit(500);
  if (error) return jsonError("Không đọc được bảng xếp hạng", 500);

  let breakdownByStudent = new Map<string, Record<string, number>>();
  let todayByStudent = new Map<string, number>();
  let lastEntryDate: string | null = null;
  let channelsByStudent = new Map<string, any[]>();
  let followersByStudent = new Map<string, number>();
  let viewsByStudent = new Map<string, number>();
  let engagementByStudent = new Map<string, number>();
  let prevFollowersByStudent = new Map<string, number>();

  if (detail) {
    const ids0 = (data ?? []).map((r: any) => r.student_id);
    // entries + channels độc lập -> chạy SONG SONG
    const [entriesRes, chansRes] = await Promise.all([
      db.from("score_entries").select("student_id, metric, points, entry_date").eq("campaign_id", campaignId),
      ids0.length
        ? db.from("channels").select("id, student_id, platform, username, url").in("student_id", ids0).eq("status", "verified")
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const entries = entriesRes.data;
    for (const e of entries ?? []) {
      if (!lastEntryDate || e.entry_date > lastEntryDate) lastEntryDate = e.entry_date;
    }
    for (const e of entries ?? []) {
      if (!breakdownByStudent.has(e.student_id)) breakdownByStudent.set(e.student_id, {});
      const b = breakdownByStudent.get(e.student_id)!;
      b[e.metric] = (b[e.metric] ?? 0) + Number(e.points);
      if (e.entry_date === lastEntryDate) {
        todayByStudent.set(e.student_id, (todayByStudent.get(e.student_id) ?? 0) + Number(e.points));
      }
    }
    const ids = ids0;
    {
      const chans = chansRes.data;
      const chById = new Map<string, any>();
      for (const c of chans ?? []) chById.set(c.id, c);

      // 2 snapshot mới nhất của từng kênh: [0] số hiện tại, [1] số hôm qua (tính % tăng)
      const chIds = [...chById.keys()];
      const latestByCh = new Map<string, any>();
      const prevByCh = new Map<string, any>();
      if (chIds.length) {
        const { data: snaps } = await db
          .from("channel_snapshots")
          .select("channel_id, followers, total_views, videos_count, engagement, snapshot_date")
          .in("channel_id", chIds)
          .order("snapshot_date", { ascending: false })
          .limit(chIds.length * 4);
        for (const s of snaps ?? []) {
          if (!latestByCh.has(s.channel_id)) latestByCh.set(s.channel_id, s);
          else if (!prevByCh.has(s.channel_id)) prevByCh.set(s.channel_id, s);
        }
      }

      for (const c of chans ?? []) {
        const latest = latestByCh.get(c.id);
        const prev = prevByCh.get(c.id);
        const sid = c.student_id;
        if (!channelsByStudent.has(sid)) channelsByStudent.set(sid, []);
        channelsByStudent.get(sid)!.push({
          platform: c.platform,
          username: c.username,
          url: c.url,
          followers: latest?.followers ?? null,
          views: latest?.total_views != null ? Number(latest.total_views) : null,
          videos: latest?.videos_count ?? null,
          engagement: latest?.engagement != null ? Number(latest.engagement) : null,
        });
        followersByStudent.set(sid, (followersByStudent.get(sid) ?? 0) + (latest?.followers ?? 0));
        viewsByStudent.set(sid, (viewsByStudent.get(sid) ?? 0) + Number(latest?.total_views ?? 0));
        engagementByStudent.set(sid, (engagementByStudent.get(sid) ?? 0) + Number(latest?.engagement ?? 0));
        prevFollowersByStudent.set(sid, (prevFollowersByStudent.get(sid) ?? 0) + (prev?.followers ?? latest?.followers ?? 0));
      }
    }
  }

  const rows = (data ?? [])
    .map((r: any) => {
      const base = {
        student_id: r.student_id,
        rank: r.current_rank,
        prev_rank: r.prev_rank,
        name: r.students.full_name,
        public_id: r.students.public_id,
        class_name: r.students.classes?.name ?? null,
        total_score: Number(r.total_score),
        updated_on: r.rank_updated_on,
      };
      if (!detail) return base;
      const b = breakdownByStudent.get(r.student_id) ?? {};
      const nowF = followersByStudent.get(r.student_id) ?? 0;
      const prevF = prevFollowersByStudent.get(r.student_id) ?? 0;
      return {
        ...base,
        breakdown: Object.fromEntries(METRICS.map((m) => [m, Math.round((b[m] ?? 0) * 100) / 100])),
        today_points: Math.round((todayByStudent.get(r.student_id) ?? 0) * 100) / 100,
        verified_channels: (channelsByStudent.get(r.student_id) ?? []).length,
        channel_followers: nowF,
        channel_views: viewsByStudent.get(r.student_id) ?? 0,
        channel_engagement: engagementByStudent.get(r.student_id) ?? 0,
        follower_growth_pct: prevF > 0 ? Math.round(((nowF - prevF) / prevF) * 1000) / 10 : null,
        channels: channelsByStudent.get(r.student_id) ?? [],
      };
    })
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));

  return NextResponse.json(
    { rows, last_entry_date: lastEntryDate },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
  );
}
