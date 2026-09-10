import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { jsonError } from "@/lib/api";
import { setSession } from "@/lib/session";
import { normalizePhone, todayVN } from "@/lib/format";
import { normalizeChannel } from "@/lib/channels";
import { resolveFacebookShareUrl } from "@/lib/scrape";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return jsonError("Dữ liệu không hợp lệ");

  const fullName = String(body.full_name ?? "").trim();
  if (!fullName) return jsonError("Vui lòng nhập họ tên");
  const phone = normalizePhone(String(body.phone ?? ""));
  if (!phone) return jsonError("Số điện thoại không đúng định dạng Việt Nam");
  const classId = String(body.class_id ?? "");
  if (!classId) return jsonError("Vui lòng chọn lớp học");

  const rawChannels: { platform: string; url: string }[] = Array.isArray(body.channels) ? body.channels : [];
  const cleaned = rawChannels.filter((c) => c?.url?.trim());
  if (!cleaned.length) return jsonError("Cần đăng ký tối thiểu 1 kênh");

  let normalized;
  try {
    normalized = await Promise.all(cleaned.map(async (c) => {
      let url = c.url;
      // Link chia sẻ FB rút gọn -> tự theo redirect lấy trang thật, học viên khỏi thao tác
      if (c.platform === "facebook" && /facebook\.com\/share\//i.test(url)) {
        url = await resolveFacebookShareUrl(url);
      }
      return normalizeChannel(c.platform, url);
    }));
  } catch (e: any) {
    return jsonError(e.message);
  }

  const db = supabaseAdmin();

  const { data: existed } = await db.from("students").select("id").eq("phone", phone).maybeSingle();
  if (existed) {
    return jsonError("Số điện thoại đã đăng ký. Vui lòng đăng nhập bằng OTP.", 409, { phone_exists: true });
  }

  // Báo RÕ kênh nào đã có người đăng ký (thay vì "một kênh" chung chung)
  const PF_LABEL: Record<string, string> = { tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook", instagram: "Instagram" };
  const unames = normalized.map((c) => c.username);
  if (unames.length) {
    const { data: existing } = await db.from("channels").select("platform, username, status").in("username", unames);
    const dupes = normalized.filter((n) =>
      (existing ?? []).some((e) => e.platform === n.platform && e.username === n.username && e.status !== "removed")
    );
    if (dupes.length) {
      const list = dupes.map((d) => `${PF_LABEL[d.platform] ?? d.platform} @${d.username}`).join(", ");
      return jsonError(`Kênh đã có người khác đăng ký: ${list}. Vui lòng bỏ kênh này (bấm ✕) rồi đăng ký lại — các kênh còn lại vẫn dùng được.`);
    }
  }

  const { data: publicId, error: idErr } = await db.rpc("next_public_id");
  if (idErr || !publicId) return jsonError("Không sinh được ID, thử lại sau", 500);

  const { data: student, error: sErr } = await db
    .from("students")
    .insert({ public_id: publicId, full_name: fullName, phone, class_id: classId })
    .select()
    .single();
  if (sErr) return jsonError("Không tạo được hồ sơ học viên", 500);

  const chRows = normalized.map((c) => ({
    student_id: student.id,
    platform: c.platform,
    url: c.url,
    username: c.username,
  }));
  const { error: chErr } = await db.from("channels").insert(chRows);
  if (chErr) {
    await db.from("students").delete().eq("id", student.id);
    if (chErr.code === "23505") return jsonError("Một kênh trong danh sách đã được học viên khác đăng ký");
    return jsonError("Không lưu được danh sách kênh", 500);
  }

  // Tự ghi danh vào các chiến dịch đang mở phù hợp (theo lớp hoặc toàn hệ thống), còn hạn chốt
  const today = todayVN();
  const { data: classCamps } = await db.from("campaign_classes").select("campaign_id").eq("class_id", classId);
  const classCampIds = (classCamps ?? []).map((r) => r.campaign_id);
  const { data: camps } = await db
    .from("campaigns")
    .select("id, scope, registration_deadline")
    .in("status", ["open", "running"]);
  const joinable = (camps ?? []).filter(
    (c) =>
      (c.scope === "global" || classCampIds.includes(c.id)) &&
      (!c.registration_deadline || c.registration_deadline >= today)
  );
  if (joinable.length) {
    await db
      .from("campaign_participants")
      .upsert(joinable.map((c) => ({ campaign_id: c.id, student_id: student.id })), {
        onConflict: "campaign_id,student_id",
        ignoreDuplicates: true,
      });
  }

  await db.from("audit_logs").insert({
    actor_id: student.id, action: "register", target_type: "student", target_id: student.id,
    detail: { public_id: publicId, channels: normalized.map((c) => `${c.platform}:@${c.username}`) },
  });

  setSession({ role: "student", sid: student.id });
  return NextResponse.json({ public_id: publicId, joined_campaigns: joinable.length });
}
