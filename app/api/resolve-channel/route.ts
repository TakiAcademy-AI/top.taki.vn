import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeChannel } from "@/lib/channels";
import { resolveFacebookShareUrl } from "@/lib/scrape";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * Giải mã link kênh (nhất là link chia sẻ Facebook /share/) -> username thật + TÊN hiển thị,
 * và cho biết kênh đã có người khác đăng ký chưa. Giúp học viên phát hiện copy nhầm link NGAY
 * khi dán, trước khi bấm đăng ký. Public.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.url || !body?.platform) return jsonErr("Thiếu link");
  const platform = String(body.platform);
  let url = String(body.url).trim();
  if (!url) return jsonErr("Link trống");

  let resolvedName: string | null = null;
  try {
    if (platform === "facebook" && /facebook\.com\/share\//i.test(url)) {
      url = await resolveFacebookShareUrl(url);
      // Tên nằm trong URL đích dạng /people/Tên/ID/
      const m = url.match(/\/people\/([^/]+)\/\d+/);
      if (m) resolvedName = decodeURIComponent(m[1]).replace(/[-+]/g, " ");
    }
    const norm = normalizeChannel(platform, url);

    // Kênh đã có người đăng ký chưa?
    const db = supabaseAdmin();
    const { data: existing } = await db
      .from("channels")
      .select("status, students(full_name, public_id)")
      .eq("platform", norm.platform)
      .eq("username", norm.username)
      .neq("status", "removed")
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      username: norm.username,
      name: resolvedName,
      taken: Boolean(existing),
      taken_by: existing ? (existing as any).students?.full_name ?? null : null,
    });
  } catch (e: any) {
    return jsonErr(e.message ?? "Không đọc được link");
  }
}

function jsonErr(msg: string) {
  return NextResponse.json({ ok: false, error: msg }, { status: 200 });
}
