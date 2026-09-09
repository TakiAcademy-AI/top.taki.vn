import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Chặn CDN/Cloudflare cache các API động — tránh trả dữ liệu cũ (verify, admin, me...).
// Riêng /api/leaderboard giữ cache CDN 5 phút (đã set Cache-Control trong route, cố ý cho trang public).
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const p = req.nextUrl.pathname;
  if (p.startsWith("/api/") && !p.startsWith("/api/leaderboard")) {
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.headers.set("CDN-Cache-Control", "no-store");
  }
  return res;
}

export const config = { matcher: "/api/:path*" };
