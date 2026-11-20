import crypto from "crypto";
import { cookies } from "next/headers";

export type Session = {
  role: "student" | "admin";
  sid?: string; // student uuid
  exp: number;  // epoch ms
};

const COOKIE = "dtxk_session";

function secret(): string {
  return process.env.SESSION_SECRET || "dev-secret-doi-truoc-khi-chay-that";
}

/** Băm mật khẩu admin (HMAC-SHA256 theo SESSION_SECRET) để lưu trong app_settings.admin_password_hash. */
export function adminPwHash(pw: string): string {
  return crypto.createHmac("sha256", secret()).update("admin:" + pw).digest("hex");
}

export function signToken(payload: Session): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyToken(token?: string | null): Session | null {
  if (!token) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expect = crypto.createHmac("sha256", secret()).update(data).digest("base64url");
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as Session;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  return verifyToken(cookies().get(COOKIE)?.value);
}

export function setSession(payload: Omit<Session, "exp">): void {
  const days30 = 30 * 24 * 60 * 60;
  const token = signToken({ ...payload, exp: Date.now() + days30 * 1000 });
  cookies().set(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: days30 });
}

export function clearSession(): void {
  cookies().set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}
