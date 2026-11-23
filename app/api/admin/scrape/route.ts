import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin, jsonError } from "@/lib/api";
import { startDailyScrape, runGraphScrape } from "@/lib/scrape";
import { runDailyScoring } from "@/lib/scoring";
import { todayVN } from "@/lib/format";
import { PLATFORMS } from "@/lib/channels";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Trạng thái quét dữ liệu: nền tảng bật/tắt, nhật ký lượt quét, cảnh báo kênh. */
export async function GET() {
  const auth = requireAdmin();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const today = todayVN();

  const { data: configs } = await db.from("platform_configs").select("*").order("platform");
  const { data: runs } = await db
    .from("scrape_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(20);

  // Cảnh báo: kênh đang theo dõi nhưng chưa có snapshot hôm nay + kênh bị gắn cờ
  const { data: channels } = await db
    .from("channels")
    .select("id, platform, username, status, students(public_id, full_name)")
    .in("status", ["pending", "verified", "flagged"]);
  const { data: todaySnaps } = await db
    .from("channel_snapshots")
    .select("channel_id")
    .eq("snapshot_date", today);
  const scanned = new Set((todaySnaps ?? []).map((s) => s.channel_id));

  const fmtCh = (c: any) => ({
    id: c.id,
    platform: c.platform,
    username: c.username,
    status: c.status,
    student: c.students ? `${c.students.full_name} (${c.students.public_id})` : null,
  });
  const notScanned = (channels ?? []).filter((c) => !scanned.has(c.id)).map(fmtCh);
  const flagged = (channels ?? []).filter((c) => c.status === "flagged").map(fmtCh);

  return NextResponse.json({
    engine: "direct",
    today,
    configs: configs ?? [],
    runs: runs ?? [],
    channels_total: (channels ?? []).length,
    channels_scanned_today: scanned.size,
    not_scanned: notScanned.slice(0, 50),
    flagged,
  });
}

/** Thao tác tay: action=scrape (quét ngay) | score (tính điểm lại hôm nay). */
export async function POST(req: NextRequest) {
  const auth = requireAdmin();
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));

  try {
    if (body.action === "scrape") {
      const result = await startDailyScrape();
      const db = supabaseAdmin();
      // Đặt cờ để extension (đang mở trong Chrome) tự chạy quét reels — Sếp khỏi bấm icon.
      await db.from("app_settings").upsert(
        { key: "ext_scrape_request", value: String(Date.now()) },
        { onConflict: "key" }
      );
      // Quét tay = trọn gói: kênh FB có token đi luôn qua Graph API (nguồn chính thống), xong tính điểm ngay
      const date = todayVN();
      let graph: Awaited<ReturnType<typeof runGraphScrape>> | null = null;
      let scored: number | null = null;
      try { graph = await runGraphScrape(date); } catch (e) { console.error("[admin/scrape] graph", e); }
      try { scored = (await runDailyScoring(date)).entries; } catch (e) { console.error("[admin/scrape] scoring", e); }
      await db.from("audit_logs").insert({
        actor_id: "admin", action: "manual_scrape", target_type: "system",
        detail: { ...result, graph, scored } as any,
      });
      return NextResponse.json({ ...result, graph, scored });
    }
    if (body.action === "score") {
      const date = body.date || todayVN();
      const report = await runDailyScoring(date);
      const db = supabaseAdmin();
      await db.from("audit_logs").insert({
        actor_id: "admin", action: "manual_scoring", target_type: "system", detail: report as any,
      });
      return NextResponse.json(report);
    }
    return jsonError("action phải là scrape hoặc score");
  } catch (e: any) {
    console.error("[admin/scrape]", e);
    return jsonError(e.message ?? "Lỗi thao tác", 500);
  }
}

/** Bật/tắt quét theo nền tảng. */
export async function PATCH(req: NextRequest) {
  const auth = requireAdmin();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const body = await req.json().catch(() => null);
  if (!body?.platform || !PLATFORMS.includes(body.platform)) return jsonError("platform không hợp lệ");
  if (body.is_active === undefined) return jsonError("Thiếu is_active");

  const { error } = await db
    .from("platform_configs")
    .upsert({ platform: body.platform, apify_actor: "direct", is_active: Boolean(body.is_active) }, { onConflict: "platform" });
  if (error) return jsonError("Không lưu được cấu hình", 500);
  await db.from("audit_logs").insert({
    actor_id: "admin", action: "update_platform_config", target_type: "platform", target_id: body.platform,
    detail: { is_active: Boolean(body.is_active) },
  });
  return NextResponse.json({ ok: true });
}
