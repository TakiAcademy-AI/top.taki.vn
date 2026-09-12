import { NextResponse } from "next/server";
import { getSession, Session } from "./session";

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function requireStudent(): { session: Session } | { error: NextResponse } {
  const session = getSession();
  if (!session || session.role !== "student" || !session.sid) {
    return { error: jsonError("Chưa đăng nhập", 401) };
  }
  return { session };
}

export function requireAdmin(): { session: Session } | { error: NextResponse } {
  const session = getSession();
  if (!session || session.role !== "admin") {
    return { error: jsonError("Cần quyền admin", 401) };
  }
  return { session };
}

/** Xác thực request cron bằng CRON_SECRET (header Bearer của Vercel Cron hoặc ?secret=). */
export function checkCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === secret;
}

/** Xác thực Chrome Extension nạp số liệu quét: header `Authorization: Bearer <INGEST_TOKEN>`.
 *  Không đặt INGEST_TOKEN = tắt hẳn endpoint (tránh mở cửa ghi dữ liệu khi quên cấu hình). */
export function checkIngestToken(req: Request): boolean {
  const secret = process.env.INGEST_TOKEN;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}
