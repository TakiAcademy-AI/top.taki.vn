import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Các API public ĐỌC — tự set Cache-Control (cache CDN 5 phút) cho trang tải nhanh, KHÔNG đụng vào.
const PUBLIC_CACHED = ["/api/home", "/api/leaderboard", "/api/classes", "/api/campaigns/open", "/api/students/profile", "/api/platforms"];

// Chặn CDN/Cloudflare cache các API nhạy cảm/động (admin, me, auth, mutation) — tránh trả dữ liệu cũ.
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const p = req.nextUrl.pathname;
  if (p.startsWith("/api/") && !PUBLIC_CACHED.some((x) => p.startsWith(x))) {
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.headers.set("CDN-Cache-Control", "no-store");
  }
  return res;
}

export const config = { matcher: "/api/:path*" };
