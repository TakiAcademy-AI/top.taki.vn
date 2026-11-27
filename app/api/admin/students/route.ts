import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/api";
import { emailColumnReady } from "@/lib/email";

export const dynamic = "force-dynamic";

/** Danh sách học viên + tìm kiếm theo tên/ID/SĐT/email, lọc theo lớp. */
export async function GET(req: NextRequest) {
  const auth = requireAdmin();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const classId = req.nextUrl.searchParams.get("class_id");

  let query = db
    .from("students")
    .select("id, public_id, full_name, phone, status, classes(name)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (q) {
    const cols = ["full_name", "public_id", "phone"];
    if (await emailColumnReady(db)) cols.push("email");
    query = query.or(cols.map((c) => `${c}.ilike.%${q}%`).join(","));
  }
  if (classId) query = query.eq("class_id", classId);
  const { data: students } = await query;
  const ids = (students ?? []).map((s) => s.id);

  const chByStudent = new Map<string, any[]>();
  const scoreByStudent = new Map<string, number>();
  if (ids.length) {
    const { data: channels } = await db
      .from("channels")
      .select("student_id, platform, status")
      .in("student_id", ids)
      .neq("status", "removed");
    for (const c of channels ?? []) {
      if (!chByStudent.has(c.student_id)) chByStudent.set(c.student_id, []);
      chByStudent.get(c.student_id)!.push(c);
    }
    const { data: parts } = await db
      .from("campaign_participants")
      .select("student_id, total_score")
      .in("student_id", ids);
    for (const p of parts ?? []) {
      scoreByStudent.set(p.student_id, Math.max(scoreByStudent.get(p.student_id) ?? 0, Number(p.total_score)));
    }
  }

  // Danh sách lớp (cả inactive) để admin lọc học viên theo mùa.
  const { data: allClasses } = await db
    .from("classes").select("id, name, is_active").order("name");

  return NextResponse.json({
    classes: allClasses ?? [],
    students: (students ?? []).map((s: any) => {
      const chans = chByStudent.get(s.id) ?? [];
      return {
        id: s.id,
        public_id: s.public_id,
        full_name: s.full_name,
        phone: s.phone,
        status: s.status,
        class_name: s.classes?.name ?? null,
        platforms: Array.from(new Set(chans.map((c) => c.platform))),
        verified: chans.filter((c) => c.status === "verified").length,
        total_channels: chans.length,
        best_score: scoreByStudent.get(s.id) ?? 0,
      };
    }),
  });
}
