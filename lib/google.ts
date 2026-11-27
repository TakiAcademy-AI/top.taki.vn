import crypto from "crypto";
import { normalizeEmail } from "./email";

/**
 * Xác thực ID token của "Đăng nhập bằng Google" (Google Identity Services).
 * Client lấy được `credential` (JWT) từ nút Google, gửi lên server; server TỰ kiểm chữ ký bằng khoá công khai
 * của Google (JWKS) + issuer + audience (= GOOGLE_CLIENT_ID của mình) + hạn dùng + email đã xác minh.
 * Không cần client secret, không thêm thư viện.
 */

export class GoogleAuthError extends Error {
  /** status: 401 = token/tài khoản Google không hợp lệ; 503 = hệ thống chưa bật hoặc không gọi được Google */
  constructor(message: string, public expired = false, public status = 401) {
    super(message);
  }
}

export type GoogleIdentity = { email: string; name: string | null; sub: string };
type Jwk = { kid?: string; kty: string; n: string; e: string };

const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const BAD = "Đăng nhập Google không hợp lệ, thử lại nhé";

/** Client ID đọc lúc chạy (không nhúng lúc build) — null = chưa bật tính năng. */
export function googleClientId(): string | null {
  return process.env.GOOGLE_CLIENT_ID?.trim() || null;
}

let certCache: { keys: Jwk[]; at: number } | null = null;

async function loadCerts(force: boolean): Promise<Jwk[]> {
  if (!force && certCache && Date.now() - certCache.at < 3_600_000) return certCache.keys;
  let res: Response;
  try {
    res = await fetch(CERTS_URL, { cache: "no-store" });
  } catch {
    throw new GoogleAuthError("Không kết nối được Google để xác thực, thử lại sau", false, 503);
  }
  if (!res.ok) throw new GoogleAuthError("Không kết nối được Google để xác thực, thử lại sau", false, 503);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  certCache = { keys, at: Date.now() };
  return keys;
}

const parseB64Json = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

export async function verifyGoogleIdToken(
  credential: string,
  opts: { clientId?: string | null; getCerts?: (force: boolean) => Promise<Jwk[]>; now?: number } = {}
): Promise<GoogleIdentity> {
  const clientId = opts.clientId === undefined ? googleClientId() : opts.clientId;
  if (!clientId) throw new GoogleAuthError("Chưa bật đăng nhập Google trên hệ thống", false, 503);
  const getCerts = opts.getCerts ?? loadCerts;
  const now = opts.now ?? Date.now();

  const parts = String(credential ?? "").split(".");
  if (parts.length !== 3) throw new GoogleAuthError(BAD);

  let header: any, payload: any;
  try {
    header = parseB64Json(parts[0]);
    payload = parseB64Json(parts[1]);
  } catch {
    throw new GoogleAuthError(BAD);
  }
  if (header?.alg !== "RS256" || !header?.kid) throw new GoogleAuthError(BAD);

  // Khoá xoay vòng: không thấy kid trong cache thì tải lại 1 lần
  let jwk = (await getCerts(false)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await getCerts(true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new GoogleAuthError(BAD);

  let signatureOk = false;
  try {
    const key = crypto.createPublicKey({ key: jwk as any, format: "jwk" });
    signatureOk = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"));
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) throw new GoogleAuthError(BAD);

  if (!ISSUERS.includes(payload.iss)) throw new GoogleAuthError(BAD);
  if (payload.aud !== clientId) throw new GoogleAuthError(BAD);
  if (typeof payload.exp !== "number" || payload.exp * 1000 < now) {
    throw new GoogleAuthError("Phiên Google đã hết hạn — bấm đăng nhập Google lại nhé", true);
  }
  // email_verified của Google là boolean; chấp nhận cả chuỗi "true" cho chắc
  if (payload.email_verified !== true && payload.email_verified !== "true") {
    throw new GoogleAuthError("Email Google này chưa được Google xác minh");
  }
  const email = normalizeEmail(String(payload.email ?? ""));
  if (!email) throw new GoogleAuthError(BAD);

  return { email, name: typeof payload.name === "string" ? payload.name : null, sub: String(payload.sub ?? "") };
}
