import type { SupabaseClient } from "@supabase/supabase-js";
import { recomputeRanks } from "./scoring";
import { invalidate } from "./cache";
import { todayVN } from "./format";
import type { NormalizedChannel } from "./channels";

/**
 * Sửa / gỡ kênh dùng chung cho học viên (/api/channels/[id]) và admin (/api/admin/channels/[id]).
 * Quyền hạn từng vai trò do route quyết định; file này chỉ lo phần dữ liệu cho đúng và an toàn.
 */

export class ChannelOpError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type ChannelRow = {
  id: string;
  student_id: string;
  platform: string;
  username: string;
  url: string;
  status: string;
};

type Actor = { id: string; role: "student" | "admin" };

/**
 * Học viên còn trong hạn đăng ký kênh không? Cùng luật với thêm kênh mới: có ít nhất một chiến dịch
 * đang mở/đang chạy mà chưa quá hạn chốt. enrolled=false: chưa ở chiến dịch nào (không có điểm nào để mất).
 */
export async function registrationWindow(db: SupabaseClient, studentId: string): Promise<{ enrolled: boolean; open: boolean }> {
  const today = todayVN();
  const { data: parts } = await db
    .from("campaign_participants")
    .select("campaigns(status, registration_deadline)")
    .eq("student_id", studentId);
  const open = (parts ?? []).some((p: any) => {
    const c = p.campaigns;
    return c && ["open", "running"].includes(c.status) && (!c.registration_deadline || c.registration_deadline >= today);
  });
  return { enrolled: (parts ?? []).length > 0, open };
}

/** Học viên bị khóa thì không được đổi/gỡ kênh (tránh gỡ rồi đăng ký lại để xóa dấu vết). */
export async function studentIsLocked(db: SupabaseClient, studentId: string): Promise<boolean> {
  const { data } = await db.from("students").select("status").eq("id", studentId).maybeSingle();
  return data?.status === "locked";
}

/**
 * Xóa hẳn một kênh khỏi hệ thống (giải phóng username cho người khác đăng ký) kèm điểm của nó.
 *
 * Điểm: xóa score_entries của kênh này ở các chiến dịch CHƯA kết thúc rồi tính lại tổng + hạng — kênh
 * đã gỡ không còn đóng góp điểm, nên không thể "kiếm điểm rồi nhượng kênh lại cho người khác".
 * Chiến dịch ĐÃ kết thúc thì giữ nguyên: kết quả đã công bố không bị sửa ngược (dòng điểm còn lại,
 * chỉ mất liên kết kênh nhờ FK on delete set null).
 */
export async function retireChannel(
  db: SupabaseClient,
  ch: ChannelRow,
  audit: { actor: Actor; action: string; detail?: Record<string, unknown> }
): Promise<{ wipedCampaigns: number }> {
  const { data: parts } = await db
    .from("campaign_participants")
    .select("campaign_id, campaigns(status)")
    .eq("student_id", ch.student_id);
  const liveIds = (parts ?? [])
    .filter((p: any) => p.campaigns?.status !== "finished")
    .map((p: any) => p.campaign_id as string);

  if (liveIds.length) {
    const { error } = await db.from("score_entries").delete().eq("channel_id", ch.id).in("campaign_id", liveIds);
    if (error) throw new ChannelOpError("Không xóa được điểm của kênh — chưa gỡ gì cả, thử lại nhé", 500);
  }
  const { error } = await db.from("channels").delete().eq("id", ch.id);
  if (error) throw new ChannelOpError("Không gỡ được kênh", 500);

  // Kênh chưa xác minh thì chưa từng có điểm — khỏi tính lại hạng. Kênh đã xóa xong rồi nên lỗi ở đây
  // không được làm hỏng cả thao tác: hạng lệch tạm thời sẽ tự đúng ở lượt tính điểm kế tiếp.
  if (ch.status !== "pending") {
    const today = todayVN();
    for (const id of liveIds) {
      try { await recomputeRanks(id, today); } catch (e) { console.error("recomputeRanks sau khi gỡ kênh lỗi", id, e); }
    }
  }
  invalidate("home");
  invalidate("lb:");

  await db.from("audit_logs").insert({
    actor_id: audit.actor.id,
    action: audit.action,
    target_type: "channel",
    target_id: ch.id,
    detail: {
      student_id: ch.student_id, platform: ch.platform, username: ch.username,
      previous_status: ch.status, wiped_campaigns: liveIds.length, ...audit.detail,
    },
  });
  return { wipedCampaigns: liveIds.length };
}

export type EditResult = {
  /** true = kênh khác hẳn (đổi nền tảng/username); false = chỉ chuẩn hóa lại link */
  identityChanged: boolean;
  /** true = kênh cũ đã bị thay bằng một bản ghi mới (id mới) — chỉ xảy ra với kênh đã xác minh/gắn cờ */
  replaced: boolean;
  channel: { id: string; platform: string; username: string; url: string; status: string };
};

const DUP_MSG = "Kênh này đã được đăng ký trong hệ thống";

/**
 * Đổi link kênh sang `norm` (đã chuẩn hóa).
 *  - Cùng nền tảng + username: chỉ cập nhật lại link cho chuẩn, giữ nguyên mọi thứ (xác minh, điểm).
 *  - Kênh chờ xác minh đổi sang kênh khác: sửa tại chỗ; bỏ token Graph + snapshot cũ (thuộc về kênh cũ,
 *    để lại thì lần xác minh sau có thể ăn nhầm số của link cũ).
 *  - Kênh đã xác minh / bị gắn cờ đổi sang kênh khác: đây thực chất là đăng ký kênh MỚI — tạo bản ghi
 *    mới (chờ xác minh) rồi gỡ kênh cũ cùng điểm của nó. Tạo mới TRƯỚC: trùng kênh thì dừng, không mất gì.
 * Caller chịu trách nhiệm kiểm tra quyền (trạng thái, hạn đăng ký, khóa học viên).
 */
export async function applyChannelEdit(
  db: SupabaseClient,
  ch: ChannelRow,
  norm: NormalizedChannel,
  actor: Actor
): Promise<EditResult> {
  const identityChanged = ch.platform !== norm.platform || ch.username !== norm.username;
  const from = `${ch.platform}:@${ch.username}`;
  const to = `${norm.platform}:@${norm.username}`;

  if (!identityChanged) {
    if (ch.url !== norm.url) {
      const { error } = await db.from("channels").update({ url: norm.url }).eq("id", ch.id);
      if (error) throw new ChannelOpError("Không sửa được kênh", 500);
    }
    return { identityChanged: false, replaced: false, channel: { ...ch, url: norm.url } };
  }

  if (ch.status === "pending") {
    const { error } = await db
      .from("channels")
      .update({
        platform: norm.platform, url: norm.url, username: norm.username,
        fb_page_id: null, fb_token: null, fb_token_expires: null,
      })
      .eq("id", ch.id);
    if (error) {
      if ((error as any).code === "23505") throw new ChannelOpError(DUP_MSG);
      throw new ChannelOpError("Không sửa được kênh", 500);
    }
    await db.from("channel_snapshots").delete().eq("channel_id", ch.id);
    invalidate("home");
    invalidate("lb:");
    await db.from("audit_logs").insert({
      actor_id: actor.id, action: `${actor.role}_edit_channel`, target_type: "channel", target_id: ch.id,
      detail: { student_id: ch.student_id, from, to },
    });
    return {
      identityChanged: true, replaced: false,
      channel: { id: ch.id, platform: norm.platform, username: norm.username, url: norm.url, status: "pending" },
    };
  }

  // verified / flagged -> thay bằng kênh mới
  const { data: created, error } = await db
    .from("channels")
    .insert({ student_id: ch.student_id, platform: norm.platform, url: norm.url, username: norm.username })
    .select("id, platform, username, url, status")
    .single();
  if (error || !created) {
    if ((error as any)?.code === "23505") throw new ChannelOpError(DUP_MSG);
    throw new ChannelOpError("Không đổi được kênh", 500);
  }
  try {
    await retireChannel(db, ch, {
      actor, action: `${actor.role}_replace_channel`, detail: { from, to, new_channel_id: created.id },
    });
  } catch (e) {
    // Gỡ kênh cũ hỏng -> hủy kênh mới để không còn 2 kênh dở dang. Chỉ khi kênh cũ vẫn còn: nếu nó đã
    // bị xóa rồi thì kênh mới là kênh duy nhất của học viên, tuyệt đối không xóa.
    const { data: still } = await db.from("channels").select("id").eq("id", ch.id).maybeSingle();
    if (still) await db.from("channels").delete().eq("id", created.id);
    throw e;
  }
  return { identityChanged: true, replaced: true, channel: created };
}
