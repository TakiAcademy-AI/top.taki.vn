import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { checkCronSecret, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Extension trình duyệt gọi để lấy danh sách kênh cần quét. Auth = CRON_SECRET.
 *  Facebook -> đếm reel (reels_url). TikTok -> đọc __UNIVERSAL_DATA__ trên trang profile (trình duyệt
 *  thật tự qua WAF SlardarWAF mà curl không qua được). Trả kèm `platform` để extension xử lý đúng loại. */
export async function GET(req: NextRequest) {
  if (!checkCronSecret(req)) return jsonError("Sai secret", 401);
  const db = supabaseAdmin();
  const { data } = await db
    .from("channels")
    .select("id, username, platform")
    .eq("status", "verified")
    .in("platform", ["facebook", "tiktok"]);
  const channels = (data ?? []).map((c) =>
    c.platform === "tiktok"
      ? {
          channel_id: c.id,
          platform: "tiktok",
          username: c.username,
          profile_url: `https://www.tiktok.com/@${c.username.replace(/^@/, "")}`,
        }
      : {
          channel_id: c.id,
          platform: "facebook",
          username: c.username,
          reels_url: /^\d+$/.test(c.username)
            ? `https://www.facebook.com/profile.php?id=${c.username}&sk=reels_tab`
            : `https://www.facebook.com/${c.username}/reels`,
        }
  );
  return NextResponse.json({ channels });
}
