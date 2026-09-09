import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireStudent, jsonError } from "@/lib/api";
import { normalizeChannel } from "@/lib/channels";
import { resolveFacebookShareUrl } from "@/lib/scrape";
import { todayVN } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Thêm kênh mới — chỉ được trước hạn chốt đăng ký của ít nhất một chiến dịch đang tham gia. */
export async function POST(req: NextRequest) {
  const auth = requireStudent();
  if ("error" in auth) return auth.error;
  const db = supabaseAdmin();
  const sid = auth.session.sid!;

  const body = await req.json().catch(() => null);
  if (!body) return jsonError("Dữ liệu không hợp lệ");

  let ch;
  try {
    const platform = String(body.platform ?? "");
    let url = String(body.url ?? "");
    if (platform === "facebook" && /facebook\.com\/share\//i.test(url)) {
      url = await resolveFacebookShareUrl(url);
    }
    ch = normalizeChannel(platform, url);
  } catch (e: any) {
    return jsonError(e.message);
  }

  const today = todayVN();
  const { data: parts } = await db
    .from("campaign_participants")
    .select("campaigns(status, registration_deadline)")
    .eq("student_id", sid);
  const stillOpen = (parts ?? []).some((p: any) => {
    const c = p.campaigns;
    return c && ["open", "running"].includes(c.status) && (!c.registration_deadline || c.registration_deadline >= today);
  });
  if (!stillOpen) return jsonError("Đã quá hạn chốt đăng ký kênh của các chiến dịch bạn tham gia");

  const { data, error } = await db
    .from("channels")
    .insert({ student_id: sid, platform: ch.platform, url: ch.url, username: ch.username })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") return jsonError("Kênh này đã được đăng ký trong hệ thống");
    return jsonError("Không thêm được kênh", 500);
  }
  return NextResponse.json({ channel: data });
}
