/** Bóc số liệu kênh TikTok từ JSON nhúng trong trang profile.
 *  Giữ ĐÚNG cấu trúc mà lib/scrape.ts phía máy chủ đang đọc, để hai luồng cho cùng một con số:
 *    followers = followerCount · totalViews = engagement = heartCount · videosCount = videoCount
 *  Service worker MV3 không có DOMParser nên cắt thẻ <script> bằng regex như phía máy chủ. */

const REHYDRATION_RE =
  /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Nhận nội dung JSON của thẻ __UNIVERSAL_DATA_FOR_REHYDRATION__ -> số liệu chuẩn hóa. */
export function parseRehydrationJson(jsonText) {
  let scope;
  try {
    scope = JSON.parse(jsonText)?.__DEFAULT_SCOPE__ ?? {};
  } catch {
    throw new Error("JSON nhúng hỏng");
  }
  const info = scope["webapp.user-detail"]?.userInfo;
  const user = info?.user;
  const stats = info?.stats ?? info?.statsV2;
  if (!user?.uniqueId) {
    const status = scope["webapp.user-detail"]?.statusCode;
    throw new Error(status ? `TikTok trả statusCode ${status} (kênh riêng tư/không tồn tại?)` : "Không thấy dữ liệu kênh");
  }
  const heart = num(stats?.heartCount) ?? num(stats?.heart);
  return {
    username: String(user.uniqueId).toLowerCase(),
    followers: num(stats?.followerCount),
    totalViews: heart,
    videosCount: num(stats?.videoCount),
    engagement: heart,
    bio: String(user.signature ?? ""),
  };
}

/** Nhận HTML đầy đủ của trang profile -> số liệu chuẩn hóa. */
export function parseProfileHtml(html) {
  const m = html.match(REHYDRATION_RE);
  if (!m) {
    throw new Error(`bot-check hoặc đổi cấu trúc trang (html ${html.length} bytes)`);
  }
  return parseRehydrationJson(m[1]);
}
