import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin, jsonError } from "@/lib/api";
import { fetchAllEntries } from "@/lib/scoring";

export const dynamic = "force-dynamic";

const METRIC_COLS = [
  ["follower", "Điểm follower"],
  ["views", "Điểm lượt xem"],
  ["new_video", "Điểm video mới"],
  ["engagement", "Điểm tương tác"],
  ["weekly_bonus", "Thưởng chuyên cần"],
  ["manual_adjust", "Điều chỉnh tay"],
] as const;

/** Xuất Excel bảng xếp hạng: hạng, ID, tên, lớp, từng chỉ số thành phần, tổng điểm. */
export async function GET(req: NextRequest) {
  const auth = requireAdmin();
  if ("error" in auth) return auth.error;
  const campaignId = req.nextUrl.searchParams.get("campaign_id");
  if (!campaignId) return jsonError("Thiếu campaign_id");
  const db = supabaseAdmin();

  const { data: camp } = await db.from("campaigns").select("name").eq("id", campaignId).maybeSingle();
  if (!camp) return jsonError("Không tìm thấy chiến dịch", 404);

  const { data: parts } = await db
    .from("campaign_participants")
    .select("student_id, total_score, current_rank, students!inner(public_id, full_name, classes(name))")
    .eq("campaign_id", campaignId);

  const entries = await fetchAllEntries(db, campaignId, "student_id, metric, points");
  const byStudent = new Map<string, Record<string, number>>();
  for (const e of entries ?? []) {
    if (!byStudent.has(e.student_id)) byStudent.set(e.student_id, {});
    const m = byStudent.get(e.student_id)!;
    m[e.metric] = (m[e.metric] ?? 0) + Number(e.points);
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Bảng xếp hạng");
  ws.columns = [
    { header: "Hạng", key: "rank", width: 8 },
    { header: "ID", key: "id", width: 14 },
    { header: "Họ tên", key: "name", width: 26 },
    { header: "Lớp", key: "class", width: 24 },
    ...METRIC_COLS.map(([key, header]) => ({ header, key, width: 18 })),
    { header: "Tổng điểm", key: "total", width: 14 },
  ];
  ws.getRow(1).font = { bold: true };

  const sorted = (parts ?? []).sort(
    (a: any, b: any) => (a.current_rank ?? 9999) - (b.current_rank ?? 9999)
  );
  for (const p of sorted as any[]) {
    const sums = byStudent.get(p.student_id) ?? {};
    ws.addRow({
      rank: p.current_rank,
      id: p.students.public_id,
      name: p.students.full_name,
      class: p.students.classes?.name ?? "",
      ...Object.fromEntries(METRIC_COLS.map(([k]) => [k, Math.round((sums[k] ?? 0) * 100) / 100])),
      total: Number(p.total_score),
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const fileName = `bang-xep-hang-${camp.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-")}.xlsx`;
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
