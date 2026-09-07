import { supabaseAdmin } from "./supabase";
import { addDays, isSunday } from "./format";

/**
 * Job tính điểm hàng ngày (06:00). Idempotent: chạy lại cùng ngày sẽ xóa các dòng
 * tự động của ngày đó rồi tính lại từ channel_snapshots — điểm không bao giờ nhân đôi.
 * Điều chỉnh tay (created_by khác null) không bị đụng tới.
 */

type Weights = {
  follower: number;
  per_1000_views: number;
  new_video: number;
  engagement: number;
  weekly_bonus: number;
};

type Snapshot = {
  channel_id: string;
  snapshot_date: string;
  followers: number | null;
  total_views: number | null;
  videos_count: number | null;
  engagement: number | null;
  scrape_status: string;
};

export type ScoringReport = {
  date: string;
  campaigns: number;
  entries: number;
  flagged: string[];       // kênh bị gắn cờ gian lận
  scrapeFailed: string[];  // kênh không có snapshot hôm nay
};

const clamp0 = (n: number) => (n > 0 ? n : 0); // delta âm tính bằng 0, không trừ điểm ở V1

/** Tự chuyển open -> running khi đã đến ngày bắt đầu (đóng băng công thức từ đây).
 *  Gọi ở job tính điểm VÀ các trang danh sách — để chiến dịch tạo trong ngày không phải đợi 06:00 hôm sau. */
export async function autoStartCampaigns(date: string): Promise<void> {
  const db = supabaseAdmin();
  await db.from("campaigns").update({ status: "running" }).eq("status", "open").lte("start_date", date);
}

export async function runDailyScoring(date: string): Promise<ScoringReport> {
  const db = supabaseAdmin();
  const report: ScoringReport = { date, campaigns: 0, entries: 0, flagged: [], scrapeFailed: [] };

  await autoStartCampaigns(date);

  const { data: campaigns, error: cErr } = await db
    .from("campaigns")
    .select("*")
    .eq("status", "running")
    .lte("start_date", date)
    .gte("end_date", date);
  if (cErr) throw cErr;

  for (const camp of campaigns ?? []) {
    report.campaigns++;
    const w = (camp.weights ?? {}) as Weights;

    const { data: parts } = await db
      .from("campaign_participants")
      .select("student_id, current_rank, prev_rank, rank_updated_on, students!inner(id, status, public_id)")
      .eq("campaign_id", camp.id);
    const activeParts = (parts ?? []).filter((p: any) => p.students?.status === "active");
    if (!activeParts.length) continue;
    const studentIds = activeParts.map((p: any) => p.student_id);

    const { data: channels } = await db
      .from("channels")
      .select("*")
      .in("student_id", studentIds)
      .eq("status", "verified");

    const chIds = (channels ?? []).map((c) => c.id);
    let snapMap = new Map<string, Map<string, Snapshot>>(); // channel_id -> date -> snapshot
    if (chIds.length) {
      const { data: snaps } = await db
        .from("channel_snapshots")
        .select("channel_id, snapshot_date, followers, total_views, videos_count, engagement, scrape_status")
        .in("channel_id", chIds)
        .gte("snapshot_date", addDays(date, -8))
        .lte("snapshot_date", date);
      for (const s of (snaps ?? []) as Snapshot[]) {
        if (!snapMap.has(s.channel_id)) snapMap.set(s.channel_id, new Map());
        snapMap.get(s.channel_id)!.set(s.snapshot_date, s);
      }
    }

    // Idempotent: xóa entries tự động của ngày này rồi tính lại
    await db.from("score_entries").delete().eq("campaign_id", camp.id).eq("entry_date", date).is("created_by", null);

    const fraudMult = Number(process.env.FRAUD_MULTIPLIER || 5);
    const fraudRatio = Number(process.env.FRAUD_ENGAGEMENT_RATIO || 0.01);
    const rows: any[] = [];

    for (const ch of channels ?? []) {
      const byDate = snapMap.get(ch.id);
      const today = byDate?.get(date);
      if (!today || today.scrape_status !== "ok") {
        report.scrapeFailed.push(`${ch.platform}:@${ch.username}`);
        continue; // kênh lỗi quét: giữ điểm hôm qua, không chặn kênh khác
      }
      const prev: Partial<Snapshot> =
        byDate?.get(addDays(date, -1)) ??
        ({ followers: ch.baseline_followers, total_views: ch.baseline_views, videos_count: null, engagement: null } as Partial<Snapshot>);

      const dF = clamp0((today.followers ?? 0) - (prev.followers ?? today.followers ?? 0));
      const dV = clamp0(Number(today.total_views ?? 0) - Number(prev.total_views ?? today.total_views ?? 0));
      const dVid = prev.videos_count == null ? 0 : clamp0((today.videos_count ?? 0) - prev.videos_count);
      const dE = prev.engagement == null ? 0 : clamp0(Number(today.engagement ?? 0) - Number(prev.engagement));

      // Chống gian lận — gắn cờ, treo điểm ngày này nếu dính 1 trong 2 luật:
      //  (A) Tăng đột biến tuyệt đối: follower tăng 1 ngày > SPIKE_RATIO × baseline (kể cả kênh MỚI,
      //      chưa đủ lịch sử 7 ngày) — chặn kênh vừa vào đã bơm follower/like ăn điểm khổng lồ.
      //  (B) Luật cũ theo lịch sử: tăng vượt fraudMult × trung bình 7 ngày VÀ tương tác/follower thấp.
      const hist: number[] = [];
      for (let i = 7; i >= 1; i--) {
        const a = byDate?.get(addDays(date, -i - 1));
        const b = byDate?.get(addDays(date, -i));
        if (a?.followers != null && b?.followers != null) hist.push(clamp0(b.followers - a.followers));
      }
      const avg7 = hist.length ? hist.reduce((s, x) => s + x, 0) / hist.length : 0;
      const engRatio = (today.followers ?? 0) > 0 ? dE / (today.followers ?? 1) : 0;
      const baseline = ch.baseline_followers ?? 0;
      const spikeRatio = Number(process.env.FRAUD_SPIKE_RATIO || 2); // >200% baseline / ngày
      const spike = baseline > 0 && dF > spikeRatio * baseline;
      const byHistory = hist.length >= 3 && avg7 > 0 && dF > fraudMult * avg7 && engRatio < fraudRatio;
      if (spike || byHistory) {
        await db.from("channels").update({ status: "flagged" }).eq("id", ch.id);
        await db.from("audit_logs").insert({
          actor_id: "system",
          action: "flag_channel",
          target_type: "channel",
          target_id: ch.id,
          detail: { date, delta_follower: dF, baseline, avg7, engagement_ratio: engRatio, rule: spike ? "spike_vs_baseline" : "spike_vs_avg7" },
        });
        report.flagged.push(`${ch.platform}:@${ch.username}`);
        continue;
      }

      // Hệ số chuẩn hóa theo quy mô xuất phát (chỉ áp cho điểm follower)
      const k = camp.normalize_by_baseline
        ? Math.log10(1000) / Math.log10(Math.max(ch.baseline_followers ?? 0, 1000))
        : 1;

      const push = (metric: string, raw: number, weight: number, points: number) => {
        if (points <= 0) return;
        rows.push({
          campaign_id: camp.id,
          student_id: ch.student_id,
          channel_id: ch.id,
          entry_date: date,
          metric,
          raw_value: raw,
          weight,
          points: Math.round(points * 100) / 100,
        });
      };
      push("follower", dF, w.follower ?? 0, dF * (w.follower ?? 0) * k);
      push("views", dV, w.per_1000_views ?? 0, (dV / 1000) * (w.per_1000_views ?? 0));
      push("new_video", dVid, w.new_video ?? 0, dVid * (w.new_video ?? 0));
      push("engagement", dE, w.engagement ?? 0, dE * (w.engagement ?? 0));
    }

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("score_entries").insert(rows.slice(i, i + 500));
      if (error) throw error;
    }
    report.entries += rows.length;

    // Điểm chuyên cần: chốt vào Chủ nhật — đủ chỉ tiêu video trong 7 ngày gần nhất
    if (isSunday(date) && (camp.weekly_quota ?? 0) > 0 && (w.weekly_bonus ?? 0) > 0) {
      const { data: weekVids } = await db
        .from("score_entries")
        .select("student_id, raw_value")
        .eq("campaign_id", camp.id)
        .eq("metric", "new_video")
        .gte("entry_date", addDays(date, -6))
        .lte("entry_date", date);
      const perStudent = new Map<string, number>();
      for (const e of weekVids ?? []) {
        perStudent.set(e.student_id, (perStudent.get(e.student_id) ?? 0) + Number(e.raw_value ?? 0));
      }
      const bonusRows = studentIds
        .filter((sid) => (perStudent.get(sid) ?? 0) >= camp.weekly_quota)
        .map((sid) => ({
          campaign_id: camp.id,
          student_id: sid,
          entry_date: date,
          metric: "weekly_bonus",
          raw_value: perStudent.get(sid),
          weight: w.weekly_bonus,
          points: w.weekly_bonus,
        }));
      if (bonusRows.length) {
        const { error } = await db.from("score_entries").insert(bonusRows);
        if (error) throw error;
        report.entries += bonusRows.length;
      }
    }

    await recomputeRanks(camp.id, date);
  }
  return report;
}

/** Tính lại tổng điểm + hạng cho một chiến dịch từ score_entries (gồm cả điều chỉnh tay). */
export async function recomputeRanks(campaignId: string, date: string): Promise<void> {
  const db = supabaseAdmin();
  const { data: entries } = await db
    .from("score_entries")
    .select("student_id, points")
    .eq("campaign_id", campaignId);
  const totals = new Map<string, number>();
  for (const e of entries ?? []) {
    totals.set(e.student_id, (totals.get(e.student_id) ?? 0) + Number(e.points));
  }

  const { data: parts } = await db
    .from("campaign_participants")
    .select("student_id, current_rank, prev_rank, rank_updated_on")
    .eq("campaign_id", campaignId);

  const ranked = (parts ?? [])
    .map((p) => ({ ...p, total: totals.get(p.student_id) ?? 0 }))
    .sort((a, b) => b.total - a.total);

  const updates = ranked.map((p, i) => ({
    campaign_id: campaignId,
    student_id: p.student_id,
    total_score: Math.round(p.total * 100) / 100,
    // prev_rank chỉ đổi khi sang ngày mới — chạy lại job cùng ngày không phá biến động hạng
    prev_rank: p.rank_updated_on === date ? p.prev_rank : p.current_rank,
    current_rank: i + 1,
    rank_updated_on: date,
  }));
  for (let i = 0; i < updates.length; i += 200) {
    const { error } = await db
      .from("campaign_participants")
      .upsert(updates.slice(i, i + 200), { onConflict: "campaign_id,student_id" });
    if (error) throw error;
  }
}
