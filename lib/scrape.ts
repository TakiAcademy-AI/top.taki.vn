import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { supabaseAdmin } from "./supabase";
import { todayVN } from "./format";

/** Số liệu chuẩn hóa của một kênh sau khi quét. */
export type NormalizedProfile = {
  ref: string;            // username nhận diện được
  followers: number | null;
  totalViews: number | null;
  videosCount: number | null;
  engagement: number | null;
  bio: string;
  raw: unknown;
};

/**
 * Engine quét TRỰC TIẾP — chi phí $0:
 *  - TikTok: đọc JSON __UNIVERSAL_DATA_FOR_REHYDRATION__ nhúng trong trang profile công khai.
 *  - Facebook: gọi binary `fb` (github.com/tamnd/facebook-cli) đọc dữ liệu trang ở chế độ ẩn danh.
 *  - YouTube: chờ YouTube Data API key (V1.1) — nền tảng đang bật mà chưa có engine sẽ báo skip.
 * Quét TUẦN TỰ có giãn cách ngẫu nhiên để không bị chặn. Kênh lỗi ghi scrape_status=failed
 * (giữ điểm hôm qua, không chặn kênh khác).
 *
 * Định nghĩa chỉ số (giữ tương thích với snapshot cũ):
 *  - TikTok: followers=followerCount · totalViews=heartCount (tổng tim)
 *            videosCount=videoCount · engagement=heartCount (tổng tương tác nhận được, cộng dồn)
 *  - Facebook: followers thật + bio=chuỗi giới thiệu trang
 *            totalViews/videosCount/engagement=null (chế độ ẩn danh chỉ đọc được bài mới nhất)
 */

const pexec = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (base: number) => base + Math.floor(Math.random() * base);

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

/* ==== TikTok: parse JSON nhúng trong trang profile ====
 * WAF của TikTok (SlardarWAF) chặn theo TLS fingerprint — fetch() của Node bị trả trang
 * bot-check. Dùng curl-impersonate (giả lập TLS Chrome) nếu có trong ./bin, fallback curl thường. */
export async function scrapeTikTokProfile(username: string): Promise<NormalizedProfile | null> {
  const jar = `/tmp/tiktok-cookies.jar`;
  const impersonate = path.join(process.cwd(), "bin", "curl_chrome131");
  const useImpersonate = fs.existsSync(impersonate);
  const bin = useImpersonate ? impersonate : "curl";
  const proxy = process.env.SCRAPE_PROXY;
  const args = [
    "-sL",
    "--compressed",
    "--max-time", "40",
    ...(proxy ? ["-x", proxy] : []),
    "-c", jar, "-b", jar,
    // curl_chrome131 tự set đầy đủ headers Chrome; curl thường thì tự thêm
    ...(useImpersonate ? [] : Object.entries(BROWSER_HEADERS).flatMap(([k, v]) => ["-H", `${k}: ${v}`])),
    `https://www.tiktok.com/@${encodeURIComponent(username)}`,
  ];
  let html: string;
  try {
    const { stdout } = await pexec(bin, args, { timeout: 50_000, maxBuffer: 20 * 1024 * 1024 });
    html = stdout;
  } catch (e: any) {
    throw new Error(String(e?.stderr || e?.message || e).slice(0, 300) || "curl failed");
  }
  const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`bot-check/đổi cấu trúc (html ${html.length} bytes)`); // trang bot-check hoặc đổi cấu trúc
  let scope: any;
  try {
    scope = JSON.parse(m[1])?.__DEFAULT_SCOPE__ ?? {};
  } catch {
    return null;
  }
  const info = scope["webapp.user-detail"]?.userInfo;
  const user = info?.user;
  const stats = info?.stats ?? info?.statsV2;
  if (!user?.uniqueId) return null;
  const heart = num(stats?.heartCount) ?? num(stats?.heart);
  return {
    ref: String(user.uniqueId).toLowerCase(),
    followers: num(stats?.followerCount),
    totalViews: heart,
    videosCount: num(stats?.videoCount),
    engagement: heart,
    bio: String(user.signature ?? ""),
    raw: { engine: "tiktok-direct", stats: stats ?? null },
  };
}

/* ==== Facebook: fetch trang công khai bằng curl-impersonate (giả TLS Chrome, qua chặn IP datacenter) ====
 * Parse og:description — chứa số CHÍNH XÁC: "{tên}. {likes} likes · {talking} talking about this. {bio}".
 * Page thì likes ≈ followers, dùng likes làm số theo dõi (chính xác hơn text '11K' rút gọn của HTML).
 * fb-cli (signed-in) không dùng vì đăng nhập lại KHÔNG trả follower. Hỗ trợ SCRAPE_PROXY nếu cần. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

export async function scrapeFacebookPage(username: string): Promise<NormalizedProfile | null> {
  const proxy = process.env.SCRAPE_PROXY;
  const impersonate = path.join(process.cwd(), "bin", "curl_chrome131");
  const bin = fs.existsSync(impersonate) ? impersonate : "curl";
  const url = /^\d+$/.test(username)
    ? `https://www.facebook.com/profile.php?id=${username}`
    : `https://www.facebook.com/${encodeURIComponent(username)}`;
  const args = ["-sL", "--compressed", "--max-time", "40", ...(proxy ? ["-x", proxy] : []), url];

  let htmlText: string;
  try {
    const { stdout } = await pexec(bin, args, { timeout: 50_000, maxBuffer: 20 * 1024 * 1024 });
    htmlText = stdout;
  } catch (e: any) {
    throw new Error(String(e?.stderr || e?.message || e).slice(0, 200) || "curl failed");
  }

  const mDesc = htmlText.match(/og:description" content="([^"]+)"/);
  const mTitle = htmlText.match(/og:title" content="([^"]+)"/);
  if (!mDesc) {
    // trang bắt đăng nhập hoàn toàn / đổi cấu trúc
    throw new Error(`không thấy og:description (html ${htmlText.length} bytes${htmlText.includes("login") ? ", có tường login" : ""})`);
  }
  const desc = decodeEntities(mDesc[1]);
  const name = mTitle ? decodeEntities(mTitle[1]) : "";

  // "{likes} likes · {talking} talking about this. {bio}" (cũng có biến thể 'followers'/'people follow this')
  const likes = desc.match(/([\d.,]+)\s*(?:likes|lượt thích)/i);
  const followersTxt = desc.match(/([\d.,]+)\s*(?:followers|người theo dõi)/i);
  const talking = desc.match(/([\d.,]+)\s*(?:talking about this|người đang nói)/i);
  const toNum = (m: RegExpMatchArray | null) => (m ? num(m[1].replace(/[.,]/g, "")) : null);
  const followers = toNum(followersTxt) ?? toNum(likes); // ưu tiên followers, fallback likes

  // bio = phần sau mệnh đề số liệu cuối cùng (…likes · …followers · …talking about this.)
  let bio = desc;
  const metrics = [...desc.matchAll(/[\d.,]+\s*(?:likes|lượt thích|followers|người theo dõi|talking about this|người đang nói)/gi)];
  if (metrics.length) {
    const last = metrics[metrics.length - 1];
    bio = desc.slice(last.index! + last[0].length).replace(/^[·.\s]+/, "");
  } else if (name && desc.startsWith(name)) {
    bio = desc.slice(name.length).replace(/^[.\s]+/, "");
  }

  if (followers == null && !bio) throw new Error("og:description không parse được số liệu");

  return {
    ref: username.toLowerCase(),
    followers,
    totalViews: null,
    videosCount: null,
    engagement: toNum(talking),
    bio,
    raw: { engine: "facebook-curl", name, likes: toNum(likes), talking: toNum(talking) },
  };
}

/* ==== Lưu snapshot + xác minh bio (cùng logic với pipeline cũ) ==== */
async function saveProfile(ch: any, prof: NormalizedProfile | null, date: string, errDetail?: string): Promise<{ ok: boolean; verified: boolean }> {
  const db = supabaseAdmin();
  if (!prof) {
    await db.from("channel_snapshots").upsert(
      { channel_id: ch.id, snapshot_date: date, scrape_status: "failed", raw: { engine: "direct", error: errDetail ?? "no-data" } },
      { onConflict: "channel_id,snapshot_date" }
    );
    return { ok: false, verified: false };
  }

  let verified = false;
  if (ch.status === "pending") {
    const publicId: string = ch.students?.public_id ?? "";
    if (publicId && prof.bio.toUpperCase().includes(publicId.toUpperCase())) {
      await db
        .from("channels")
        .update({
          status: "verified",
          verified_at: new Date().toISOString(),
          verified_by: "system",
          baseline_followers: prof.followers,
          baseline_views: prof.totalViews,
        })
        .eq("id", ch.id);
      await db.from("audit_logs").insert({
        actor_id: "system",
        action: "verify_channel_bio",
        target_type: "channel",
        target_id: ch.id,
        detail: { public_id: publicId, followers: prof.followers, engine: "direct" },
      });
      verified = true;
    }
  }

  const { error } = await db.from("channel_snapshots").upsert(
    {
      channel_id: ch.id,
      snapshot_date: date,
      followers: prof.followers,
      total_views: prof.totalViews,
      videos_count: prof.videosCount,
      engagement: prof.engagement,
      raw: prof.raw,
      scrape_status: "ok",
    },
    { onConflict: "channel_id,snapshot_date" }
  );
  return { ok: !error, verified };
}

const SCRAPERS: Record<string, (username: string) => Promise<NormalizedProfile | null>> = {
  tiktok: scrapeTikTokProfile,
  facebook: scrapeFacebookPage,
};

export type ScrapeResult = {
  engine: "direct";
  platforms: { platform: string; channels: number; ok: number; failed: string[]; verified: number }[];
  skipped: string[]; // nền tảng đang bật nhưng chưa có engine trực tiếp (vd youtube chờ API key)
};

/** Quét toàn bộ kênh pending + verified bằng engine trực tiếp. Chạy tuần tự có giãn cách. */
export async function startDailyScrape(): Promise<ScrapeResult> {
  const db = supabaseAdmin();
  const date = todayVN();

  const { data: channels } = await db
    .from("channels")
    .select("*, students!inner(id, public_id)")
    .in("status", ["pending", "verified"]);
  const { data: configs } = await db.from("platform_configs").select("platform").eq("is_active", true);

  const result: ScrapeResult = { engine: "direct", platforms: [], skipped: [] };

  for (const cfg of configs ?? []) {
    const scraper = SCRAPERS[cfg.platform];
    const list = (channels ?? []).filter((c) => c.platform === cfg.platform);
    if (!list.length) continue;
    if (!scraper) {
      result.skipped.push(cfg.platform);
      continue;
    }

    const runId = `direct-${cfg.platform}-${Date.now()}`;
    await db.from("scrape_runs").insert({
      run_id: runId,
      platform: cfg.platform,
      actor: `direct/${cfg.platform}`,
      status: "started",
      channels_count: list.length,
      cost_usd: 0,
    });

    const stat = { platform: cfg.platform, channels: list.length, ok: 0, failed: [] as string[], verified: 0 };
    for (const ch of list) {
      let prof: NormalizedProfile | null = null;
      let errDetail: string | undefined;
      try {
        prof = await scraper(ch.username);
      } catch (e: any) {
        errDetail = String(e?.message ?? e);
      }
      if (!prof) {
        await sleep(jitter(4000)); // nghỉ dài hơn rồi thử lại 1 lần
        try {
          prof = await scraper(ch.username);
          errDetail = undefined;
        } catch (e: any) {
          errDetail = String(e?.message ?? e);
        }
      }
      const saved = await saveProfile(ch, prof, date, errDetail);
      if (saved.ok) stat.ok++;
      else stat.failed.push(`${ch.platform}:@${ch.username}`);
      if (saved.verified) stat.verified++;
      await sleep(jitter(1500)); // giãn cách 1.5-3s giữa các kênh
    }

    await db
      .from("scrape_runs")
      .update({ status: stat.ok > 0 ? "succeeded" : "failed", finished_at: new Date().toISOString() })
      .eq("run_id", runId);
    result.platforms.push(stat);
  }
  return result;
}
