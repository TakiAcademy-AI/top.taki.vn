/** Chuẩn hóa link kênh: whitelist 4 nền tảng, bóc username từ URL. */

export const PLATFORMS = ["tiktok", "youtube", "facebook", "instagram"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABEL: Record<Platform, string> = {
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
  instagram: "Instagram",
};

const HOST_WHITELIST: Record<Platform, string[]> = {
  tiktok: ["tiktok.com", "www.tiktok.com", "vt.tiktok.com"],
  youtube: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"],
  facebook: ["facebook.com", "www.facebook.com", "m.facebook.com", "fb.com", "www.fb.com"],
  instagram: ["instagram.com", "www.instagram.com"],
};

export type NormalizedChannel = { platform: Platform; url: string; username: string };

/**
 * Trả về kênh đã chuẩn hóa hoặc ném Error với thông báo tiếng Việt.
 * Chấp nhận cả dạng thiếu protocol (tiktok.com/@abc) và dạng chỉ gõ @username.
 */
export function normalizeChannel(platform: string, rawUrl: string): NormalizedChannel {
  const p = platform.toLowerCase() as Platform;
  if (!PLATFORMS.includes(p)) throw new Error(`Nền tảng không hỗ trợ: ${platform}`);

  let input = rawUrl.trim();
  if (!input) throw new Error("Link kênh trống");

  // Cho phép gõ tay @username
  if (/^@[\w.\-]+$/.test(input)) {
    const uname = input.slice(1).toLowerCase();
    return { platform: p, username: uname, url: canonicalUrl(p, uname) };
  }

  if (!/^https?:\/\//i.test(input)) input = `https://${input}`;
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new Error(`Link kênh không hợp lệ: ${rawUrl}`);
  }
  if (!HOST_WHITELIST[p].includes(u.hostname.toLowerCase())) {
    throw new Error(`Link không phải kênh ${PLATFORM_LABEL[p]}: ${rawUrl}`);
  }

  const segs = u.pathname.split("/").filter(Boolean);
  let username = "";
  if (p === "tiktok") {
    const seg = segs.find((s) => s.startsWith("@"));
    username = (seg || segs[0] || "").replace(/^@/, "");
  } else if (p === "youtube") {
    if (segs[0]?.startsWith("@")) username = segs[0].slice(1);
    else if (["c", "channel", "user"].includes(segs[0] || "")) username = segs[1] || "";
    else username = segs[0] || "";
  } else if (p === "facebook") {
    // Nhiều dạng link FB học viên hay gửi:
    if (segs[0] === "profile.php") {
      username = u.searchParams.get("id") || "";                 // profile.php?id=123
    } else if (segs[0] === "people") {
      username = segs[segs.length - 1] || "";                    // /people/Tên/123/ -> id ở cuối
    } else if (segs[0] === "share") {
      throw new Error("Đây là link chia sẻ Facebook rút gọn — mở link trên trình duyệt rồi dán địa chỉ trang thật (dạng facebook.com/tentrang hoặc .../profile.php?id=...)");
    } else {
      username = (segs[0] || "").replace(/^@/, "");              // /tentrang
    }
  } else {
    // instagram
    username = (segs[0] || "").replace(/^@/, "");
  }
  username = username.toLowerCase().replace(/[?#].*$/, "");
  if (!username) throw new Error(`Không bóc được username từ link: ${rawUrl}`);
  return { platform: p, username, url: canonicalUrl(p, username) };
}

export function canonicalUrl(platform: Platform, username: string): string {
  switch (platform) {
    case "tiktok": return `https://www.tiktok.com/@${username}`;
    case "youtube": return `https://www.youtube.com/@${username}`;
    case "facebook": return `https://www.facebook.com/${username}`;
    case "instagram": return `https://www.instagram.com/${username}`;
  }
}
