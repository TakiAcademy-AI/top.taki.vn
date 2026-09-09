import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { requireAdmin, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const pexec = promisify(execFile);

/** TẠM — soi HTML thật máy chủ nhận từ Facebook cho 1 username. Chỉ admin. */
export async function GET(req: NextRequest) {
  const auth = requireAdmin();
  if ("error" in auth) return auth.error;
  const username = req.nextUrl.searchParams.get("u") || "";
  if (!username) return jsonError("Thiếu ?u=");

  const impersonate = path.join(process.cwd(), "bin", "curl_chrome131");
  const hasBin = fs.existsSync(impersonate);
  const bin = hasBin ? impersonate : "curl";
  const url = /^\d+$/.test(username)
    ? `https://www.facebook.com/profile.php?id=${username}`
    : `https://www.facebook.com/${encodeURIComponent(username)}`;

  let html = "";
  let err = "";
  try {
    const { stdout } = await pexec(bin, ["-sL", "--compressed", "--max-time", "40", "-H", "Accept-Language: en-US,en;q=0.9", url], {
      timeout: 50_000, maxBuffer: 20 * 1024 * 1024,
    });
    html = stdout;
  } catch (e: any) {
    err = String(e?.stderr || e?.message || e).slice(0, 300);
  }

  const ogDesc = html.match(/og:description" content="([^"]+)"/)?.[1] ?? null;
  const followerHits = [...html.matchAll(/"text":"([\d.,]+\s*[KkMm]?\s*(?:followers?|người theo dõi))"/gi)].map((m) => m[1]).slice(0, 5);

  return NextResponse.json({
    marker: "debug-scrape-v1",
    hasImpersonateBin: hasBin,
    url,
    html_len: html.length,
    err: err || null,
    login_wall: html.slice(0, 400).toLowerCase().includes("log in") || html.slice(0, 400).toLowerCase().includes("đăng nhập"),
    og_description: ogDesc,
    follower_text_hits: followerHits,
  });
}
