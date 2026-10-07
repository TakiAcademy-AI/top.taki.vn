import type { NormalizedProfile } from "./scrape";
import type { ReelView } from "./scrape";

/** Facebook Graph API — nguồn CHÍNH THỐNG: học viên cấp quyền "Thông tin chi tiết" (read_insights) + token.
 *  Đọc follower + TẤT CẢ reel (view chính xác, không WAF/tường login/sót reel cũ). Dùng cho kênh có fb_token.
 *  Chỉ số ánh xạ thẳng mô hình hiện tại: followers + reel{id,views} -> total_views/videos_count qua union.
 *  Engagement để null (giữ nguyên "talking about this" công khai cho nhất quán toàn giải — bật sau nếu cần). */

export const GRAPH_VERSION = "v23.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

type GraphErr = { error?: { message?: string; type?: string; code?: number } };

async function graphGet(pathAndQuery: string, token: string): Promise<any> {
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  const url = `${GRAPH}/${pathAndQuery}${sep}access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url, { cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as GraphErr & Record<string, any>;
  if (!r.ok || j.error) {
    throw new Error(`graph ${r.status}: ${j.error?.message ?? "lỗi không rõ"}${j.error?.code ? ` (code ${j.error.code})` : ""}`);
  }
  return j;
}

const toNum = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Lấy view của 1 reel: ưu tiên field `views` trả thẳng; nếu thiếu thì gọi video_insights đếm lượt phát. */
function reelViews(node: any): number | null {
  // FB đổi tên field qua các bản: thử lần lượt các khóa hay gặp.
  for (const k of ["views", "post_views", "blue_reels_play_count", "video_view_count"]) {
    const v = toNum(node?.[k]);
    if (v != null) return v;
  }
  return null;
}

/** Quét 1 kênh Facebook qua Graph API bằng token của chính kênh đó.
 *  pageId: node id để query (page id hoặc user-pro id). token: Page/insights access token (read-only). */
export async function scrapeFacebookGraph(
  pageId: string,
  token: string
): Promise<{ profile: NormalizedProfile; reels: ReelView[] } | null> {
  // 1) Follower + tên (fan_count = like Trang cũ, followers_count = người theo dõi — ưu tiên followers_count)
  const meta = await graphGet(`${pageId}?fields=name,followers_count,fan_count`, token);
  const followers = toNum(meta.followers_count) ?? toNum(meta.fan_count);

  // 1b) Tương tác = page_post_engagements (28 ngày, giá trị mới nhất) — KHỚP "Lượt tương tác" dashboard FB.
  //     Lỗi insights thì để null (giữ "talking about this" công khai). Chỉ số cuộn -> saveProfile giữ đỉnh.
  let engagement: number | null = null;
  try {
    const ins = await graphGet(`${pageId}/insights?metric=page_post_engagements&period=days_28`, token);
    const vals = ins?.data?.[0]?.values;
    if (Array.isArray(vals) && vals.length) engagement = toNum(vals[vals.length - 1]?.value);
  } catch { /* không có quyền insights / lỗi -> null, giữ số cũ */ }

  // 2) TẤT CẢ reel: phân trang hết (limit 100/trang), gom {id, views}. Reel là nguồn view chuẩn nhất.
  const reels: ReelView[] = [];
  let next: string | null = `${pageId}/video_reels?fields=id,views,post_views,blue_reels_play_count&limit=100`;
  let page = 0;
  while (next && page < 50) {
    const res: any = await graphGet(next, token);
    for (const node of res.data ?? []) {
      const id = node?.id != null ? String(node.id) : null;
      const v = reelViews(node);
      if (id && v != null) reels.push({ id, views: v });
    }
    // phân trang: lấy cursor after (giữ nguyên fields), dừng khi hết
    const after = res.paging?.cursors?.after;
    next = res.paging?.next && after
      ? `${pageId}/video_reels?fields=id,views,post_views,blue_reels_play_count&limit=100&after=${encodeURIComponent(after)}`
      : null;
    page++;
  }

  // Graph trả ĐỦ + CHÍNH XÁC mọi reel -> tính total THẲNG. KHÔNG ghi vào channel_reels: reel id của Graph
  // (video id dạng số) KHÁC id scraping (story "Uzpf...") -> cùng reel nhưng khác id -> union sẽ CỘNG ĐÔI.
  const totalViews = reels.reduce((s, r) => s + r.views, 0);
  const profile: NormalizedProfile = {
    ref: String(pageId),
    followers,
    totalViews: reels.length ? totalViews : null,
    videosCount: reels.length || null,
    engagement,         // page_post_engagements 28 ngày (khớp dashboard) cho kênh có token; else null -> giữ số cũ
    bio: "",
    raw: { engine: "graph-api", name: meta.name ?? null, followers_count: meta.followers_count ?? null, reels: reels.length, engagement },
  };
  return { profile, reels };
}
