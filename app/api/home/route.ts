import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { addDays, todayVN } from "@/lib/format";
import { PLATFORM_LABEL, Platform } from "@/lib/channels";
import { autoStartCampaigns } from "@/lib/scoring";
import { cached } from "@/lib/cache";

export const dynamic = "force-dynamic";

const MILESTONES = [1_000_000, 500_000, 100_000, 50_000, 10_000, 5_000, 1_000];

/**
 * Dữ liệu trang chủ public (cổng đua toàn hệ thống). Không bao giờ trả SĐT.
 * Gồm: số toàn hệ thống, các đường đua đang mở, bảng vàng lớp (điểm TB/học viên),
 * feed chiến tích tự sinh từ dữ liệu quét, hall of fame mùa đã kết thúc.
 */
export async function GET() {
  const payload = await cached("home", 60_000, () => buildHome());
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
  });
}

async function buildHome() {
  const db = supabaseAdmin();
  const today = todayVN();
  await autoStartCampaigns(today);
  const yesterday = addDays(today, -1);
  const weekAgo = addDays(today, -7);

  // ===== Query độc lập chạy SONG SONG (giảm round-trip tới DB) =====
  const [campsRes, channelsRes, finishedRes] = await Promise.all([
    db.from("campaigns")
      .select("id, name, prize, prizes, scope, status, start_date, end_date, registration_deadline, campaign_classes(classes(id, name, code))")
      .in("status", ["open", "running"])
      .order("start_date", { ascending: false }),
    db.from("channels").select("id, student_id, platform, status").neq("status", "removed"),
    db.from("campaigns").select("id, name, end_date").eq("status", "finished").order("end_date", { ascending: false }).limit(2),
  ]);
  const camps = campsRes.data;
  const channels = channelsRes.data;
  const finished = finishedRes.data;
  const campIds = (camps ?? []).map((c) => c.id);

  let parts: any[] = [];
  if (campIds.length) {
    const { data } = await db
      .from("campaign_participants")
      .select("campaign_id, student_id, total_score, current_rank, prev_rank, students!inner(public_id, full_name, status, class_id, classes(name, code))")
      .in("campaign_id", campIds);
    parts = (data ?? []).filter((p: any) => p.students?.status === "active");
  }

  // ===== Map học viên =====
  const channelsByStudent = new Map<string, number>();
  for (const c of channels ?? []) {
    channelsByStudent.set(c.student_id, (channelsByStudent.get(c.student_id) ?? 0) + 1);
  }
  const studentName = new Map<string, { name: string; public_id: string }>();
  for (const p of parts) studentName.set(p.student_id, { name: p.students.full_name, public_id: p.students.public_id });

  // ===== Số toàn hệ thống: follower/view tăng 7 ngày từ snapshots kênh verified =====
  const verifiedIds = (channels ?? []).filter((c) => c.status === "verified").map((c) => c.id);
  let followers7 = 0;
  let views7 = 0;
  const snapByCh = new Map<string, Map<string, any>>();
  if (verifiedIds.length) {
    const { data: snaps } = await db
      .from("channel_snapshots")
      .select("channel_id, snapshot_date, followers, total_views")
      .in("channel_id", verifiedIds)
      .in("snapshot_date", [today, yesterday, weekAgo]);
    for (const s of snaps ?? []) {
      if (!snapByCh.has(s.channel_id)) snapByCh.set(s.channel_id, new Map());
      snapByCh.get(s.channel_id)!.set(s.snapshot_date, s);
    }
    for (const [, byDate] of snapByCh) {
      const now = byDate.get(today) ?? byDate.get(yesterday);
      const old = byDate.get(weekAgo);
      if (now && old) {
        followers7 += Math.max(0, (now.followers ?? 0) - (old.followers ?? 0));
        views7 += Math.max(0, Number(now.total_views ?? 0) - Number(old.total_views ?? 0));
      }
    }
  }

  const distinctStudents = new Set(parts.map((p) => p.student_id));

  // ===== Card từng đường đua =====
  const campaigns = (camps ?? []).map((c: any) => {
    const cp = parts.filter((p) => p.campaign_id === c.id);
    const top3 = cp
      .filter((p) => p.current_rank != null && p.current_rank <= 3)
      .sort((a, b) => a.current_rank - b.current_rank)
      .map((p) => ({ name: p.students.full_name, public_id: p.students.public_id, total_score: Number(p.total_score), rank: p.current_rank }));
    const chCount = cp.reduce((s, p) => s + (channelsByStudent.get(p.student_id) ?? 0), 0);
    const classes = (c.campaign_classes ?? []).map((cc: any) => cc.classes).filter(Boolean);
    return {
      id: c.id, name: c.name, prize: c.prize, prizes: c.prizes ?? [], scope: c.scope, status: c.status,
      start_date: c.start_date, end_date: c.end_date, registration_deadline: c.registration_deadline,
      class_names: classes.map((x: any) => x.name),
      class_codes: classes.map((x: any) => x.code).filter(Boolean),
      participants: cp.length, channels: chCount, top3,
    };
  });

  // ===== Bảng vàng lớp: điểm TB mỗi học viên (lớp ít người vẫn thắng được lớp đông) =====
  const byClass = new Map<string, { name: string; code: string | null; students: Set<string>; sum: number; channels: number }>();
  for (const p of parts) {
    const cid = p.students.class_id;
    if (!cid) continue;
    if (!byClass.has(cid)) {
      byClass.set(cid, { name: p.students.classes?.name ?? "—", code: p.students.classes?.code ?? null, students: new Set(), sum: 0, channels: 0 });
    }
    const g = byClass.get(cid)!;
    if (!g.students.has(p.student_id)) {
      g.students.add(p.student_id);
      g.channels += channelsByStudent.get(p.student_id) ?? 0;
    }
    g.sum += Number(p.total_score);
  }
  const class_board = Array.from(byClass.entries())
    .map(([id, g]) => ({
      class_id: id, name: g.name, code: g.code,
      students: g.students.size, channels: g.channels,
      avg_score: g.students.size ? Math.round((g.sum / g.students.size) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.avg_score - a.avg_score)
    .slice(0, 8);

  // ===== Feed chiến tích (từ dữ liệu thật, không bịa) =====
  const feed: { icon: string; text: string; when: string }[] = [];
  // 1) Vượt mốc follower (so snapshot hôm nay với hôm qua)
  const chById = new Map((channels ?? []).map((c) => [c.id, c]));
  for (const [chId, byDate] of snapByCh) {
    const nowS = byDate.get(today);
    const prevS = byDate.get(yesterday);
    if (!nowS || !prevS || nowS.followers == null || prevS.followers == null) continue;
    const t = MILESTONES.find((m) => prevS.followers < m && nowS.followers >= m);
    if (!t) continue;
    const ch = chById.get(chId);
    const st = ch ? studentName.get(ch.student_id) : null;
    if (!st || !ch) continue;
    feed.push({
      icon: "🚀",
      text: `${st.name} (${st.public_id}) vượt mốc ${t.toLocaleString("vi-VN")} follower ${PLATFORM_LABEL[ch.platform as Platform] ?? ch.platform}`,
      when: "Hôm nay",
    });
  }
  // 2) Tăng hạng mạnh (≥2 bậc)
  const campName = new Map((camps ?? []).map((c) => [c.id, c.name]));
  const climbs = parts
    .filter((p) => p.prev_rank != null && p.current_rank != null && p.prev_rank - p.current_rank >= 2)
    .sort((a, b) => (b.prev_rank - b.current_rank) - (a.prev_rank - a.current_rank))
    .slice(0, 4);
  for (const p of climbs) {
    feed.push({
      icon: "📈",
      text: `${p.students.full_name} tăng ${p.prev_rank - p.current_rank} hạng, lên hạng ${p.current_rank} · ${campName.get(p.campaign_id) ?? ""}`,
      when: "Hôm nay",
    });
  }
  // 3) Đạt chỉ tiêu tuần (thưởng chuyên cần 7 ngày gần nhất)
  if (campIds.length) {
    const { data: bonuses } = await db
      .from("score_entries")
      .select("student_id, campaign_id, raw_value, entry_date")
      .in("campaign_id", campIds)
      .eq("metric", "weekly_bonus")
      .gte("entry_date", weekAgo)
      .order("entry_date", { ascending: false })
      .limit(5);
    for (const b of bonuses ?? []) {
      const st = studentName.get(b.student_id);
      if (!st) continue;
      feed.push({
        icon: "🏅",
        text: `${st.name} đạt chỉ tiêu tuần (${Number(b.raw_value ?? 0)} video) · nhận thưởng chuyên cần`,
        when: b.entry_date === today ? "Hôm nay" : b.entry_date.split("-").reverse().slice(0, 2).join("/"),
      });
    }
  }

  // ===== Hall of Fame: top 3 các mùa đã kết thúc (finished đã lấy song song ở trên) =====
  const hall_of_fame: any[] = [];
  if (finished?.length) {
    const tops = await Promise.all(
      finished.map((f) =>
        db.from("campaign_participants")
          .select("student_id, total_score, current_rank, students!inner(public_id, full_name)")
          .eq("campaign_id", f.id)
          .lte("current_rank", 3)
          .order("current_rank")
      )
    );
    finished.forEach((f, i) => {
      const top = tops[i].data;
      if (top?.length) {
        hall_of_fame.push({
          campaign_name: f.name,
          end_date: f.end_date,
          top3: top.map((p: any) => ({
            rank: p.current_rank, name: p.students.full_name,
            public_id: p.students.public_id, total_score: Number(p.total_score),
          })),
        });
      }
    });
  }

  return {
    today,
    stats: {
      students: distinctStudents.size,
      channels: (channels ?? []).length,
      followers7,
      views7,
    },
    campaigns,
    class_board,
    feed: feed.slice(0, 8),
    hall_of_fame,
  };
}
