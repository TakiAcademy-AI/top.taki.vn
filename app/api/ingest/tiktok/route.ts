import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { checkIngestToken } from "@/lib/api";
import { ingestExternalProfiles, ExternalProfileItem } from "@/lib/scrape";
import { todayVN } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** CORS: extension gọi từ origin chrome-extension://… nên phải trả preflight. */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

const withCors = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: CORS });

/** GET — extension lấy danh sách kênh TikTok cần quét hôm nay.
 *  ?all=1 để quét lại cả kênh đã có snapshot hôm nay (mặc định bỏ qua để chạy lại cho nhanh). */
export async function GET(req: NextRequest) {
  if (!checkIngestToken(req)) return withCors({ error: "Sai hoặc thiếu INGEST_TOKEN" }, 401);
  const db = supabaseAdmin();
  const date = todayVN();
  const all = new URL(req.url).searchParams.get("all") === "1";

  const { data: channels, error } = await db
    .from("channels")
    .select("id, username, status")
    .eq("platform", "tiktok")
    .in("status", ["pending", "verified"])
    .order("username");
  if (error) return withCors({ error: "Không đọc được danh sách kênh" }, 500);

  let list = channels ?? [];
  if (!all) {
    const { data: done } = await db
      .from("channel_snapshots")
      .select("channel_id")
      .eq("snapshot_date", date)
      .eq("scrape_status", "ok");
    const scanned = new Set((done ?? []).map((s) => s.channel_id));
    list = list.filter((c) => !scanned.has(c.id));
  }

  return withCors({
    date,
    total: (channels ?? []).length,
    remaining: list.length,
    channels: list.map((c) => ({ username: c.username, status: c.status })),
  });
}

/** POST — extension gửi lô số liệu đã quét. Body: { items: [{ username, followers, ... }] } */
export async function POST(req: NextRequest) {
  if (!checkIngestToken(req)) return withCors({ error: "Sai hoặc thiếu INGEST_TOKEN" }, 401);
  const body = await req.json().catch(() => null);
  const items = body?.items;
  if (!Array.isArray(items)) return withCors({ error: "Thiếu mảng items" }, 400);
  if (items.length > 500) return withCors({ error: "Tối đa 500 kênh mỗi lượt gửi" }, 400);

  try {
    const result = await ingestExternalProfiles("tiktok", items as ExternalProfileItem[], "extension");
    return withCors(result);
  } catch (e: any) {
    console.error("[ingest/tiktok]", e);
    return withCors({ error: e?.message ?? "Lỗi nạp số liệu" }, 500);
  }
}
