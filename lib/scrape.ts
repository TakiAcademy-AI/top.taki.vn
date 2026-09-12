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

// Proxy quét: ưu tiên env SCRAPE_PROXY; nếu không có thì đọc từ DB (app_settings.scrape_proxy).
// Cho phép bật/đổi/tắt proxy mà KHÔNG cần sửa env server (chỉ cần đổi 1 dòng trong DB). Cache 5 phút.
let _proxyCache: { val: string | undefined; at: number } | null = null;
async function getScrapeProxy(): Promise<string | undefined> {
  if (process.env.SCRAPE_PROXY) return process.env.SCRAPE_PROXY;
  const now = Date.now();
  if (_proxyCache && now - _proxyCache.at < 300_000) return _proxyCache.val;
  let val: string | undefined;
  try {
    const { data } = await supabaseAdmin().from("app_settings").select("value").eq("key", "scrape_proxy").maybeSingle();
    val = (data?.value ?? "").trim() || undefined;
  } catch {
    val = _proxyCache?.val; // lỗi DB: giữ giá trị cache cũ nếu có
  }
  _proxyCache = { val, at: now };
  return val;
}

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
  const proxy = await getScrapeProxy();
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

/** Link chia sẻ FB rút gọn (/share/xxx) -> theo redirect lấy URL trang thật (profile.php?id / /people/.../id).
 *  Trả URL đích, hoặc URL gốc nếu không resolve được. */
export async function resolveFacebookShareUrl(rawUrl: string): Promise<string> {
  const impersonate = path.join(process.cwd(), "bin", "curl_chrome131");
  const bin = fs.existsSync(impersonate) ? impersonate : "curl";
  try {
    const { stdout } = await pexec(
      bin,
      ["-sL", "-o", "/dev/null", "--max-time", "30", "-H", "Accept-Language: en-US,en;q=0.9", "-w", "%{url_effective}", rawUrl],
      { timeout: 35_000, maxBuffer: 1024 * 1024 }
    );
    const finalUrl = stdout.trim();
    return finalUrl && /facebook\.com/i.test(finalUrl) ? finalUrl : rawUrl;
  } catch {
    return rawUrl;
  }
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

// Parse số rút gọn kiểu "2.5K" / "1.2M" / "11,712" -> số nguyên
function parseCompact(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = String(s).trim().match(/^([\d.,]+)\s*([KkMm])?$/);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const suf = (m[2] || "").toLowerCase();
  if (suf === "k") n *= 1000;
  else if (suf === "m") n *= 1_000_000;
  return Math.round(n);
}

/**
 * Quét tab Reels của một page Facebook: đếm số reel + cộng view.
 * FB nhúng sẵn "play_count_reduced":"2.5K" cho mỗi reel trong HTML (SSR) -> curl đọc được, không cần JS.
 * Lưu ý: chỉ lấy được lô reel render sẵn ban đầu (~8-12 reel mới nhất với kênh nhiều bài); view là số rút gọn.
 */
export async function scrapeFacebookReels(username: string, proxy?: string): Promise<{ totalViews: number; videoCount: number } | null> {
  const impersonate = path.join(process.cwd(), "bin", "curl_chrome131");
  const bin = fs.existsSync(impersonate) ? impersonate : "curl";
  const url = /^\d+$/.test(username)
    ? `https://www.facebook.com/profile.php?id=${username}&sk=reels_tab`
    : `https://www.facebook.com/${encodeURIComponent(username)}/reels`;
  const args = ["-sL", "--compressed", "--max-time", "40", "-H", "Accept-Language: en-US,en;q=0.9",
    ...(proxy ? ["-x", proxy] : []), url];
  let html: string;
  try {
    const { stdout } = await pexec(bin, args, { timeout: 50_000, maxBuffer: 30 * 1024 * 1024 });
    html = stdout;
  } catch {
    return null;
  }
  const views: number[] = [];
  for (const m of html.matchAll(/"play_count_reduced":"([^"]+)"/g)) {
    const v = parseCompact(m[1]);
    if (v != null) views.push(v);
  }
  if (!views.length) return { totalViews: 0, videoCount: 0 };
  return { totalViews: views.reduce((s, v) => s + v, 0), videoCount: views.length };
}

export async function scrapeFacebookPage(username: string): Promise<NormalizedProfile | null> {
  const proxy = await getScrapeProxy();
  // Quét tab Reels SONG SONG với trang chính (không phụ thuộc nhau) -> khỏi chậm gấp đôi.
  const reelsPromise = scrapeFacebookReels(username, proxy).catch(() => null);
  const impersonate = path.join(process.cwd(), "bin", "curl_chrome131");
  const bin = fs.existsSync(impersonate) ? impersonate : "curl";
  const url = /^\d+$/.test(username)
    ? `https://www.facebook.com/profile.php?id=${username}`
    : `https://www.facebook.com/${encodeURIComponent(username)}`;
  // Ép FB trả HTML tiếng Anh nhất quán (IP máy chủ hay nhận tiếng Việt "người theo dõi" -> lệch regex)
  const args = ["-sL", "--compressed", "--max-time", "40", "-H", "Accept-Language: en-US,en;q=0.9",
    ...(proxy ? ["-x", proxy] : []), url];

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

  // "1.5K" / "11,712" -> số (K/M = nghìn/triệu, dấu phẩy = ngăn nghìn)
  const parseCount = (s: string | undefined): number | null => {
    if (!s) return null;
    const m = s.trim().match(/^([\d.,]+)\s*([KkMm])?$/);
    if (!m) return null;
    let n = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) return null;
    const suf = (m[2] || "").toLowerCase();
    if (suf === "k") n *= 1000;
    else if (suf === "m") n *= 1_000_000;
    return Math.round(n);
  };

  // Page: "{likes} likes · {talking} talking about this. {bio}"
  const likes = desc.match(/([\d.,]+\s*[KkMm]?)\s*(?:likes?|lượt thích)/i);
  const followersDesc = desc.match(/([\d.,]+\s*[KkMm]?)\s*(?:followers?|người theo dõi)/i);
  const talking = desc.match(/([\d.,]+\s*[KkMm]?)\s*(?:talking about this|người đang nói)/i);
  const toNum = (m: RegExpMatchArray | null) => (m ? parseCount(m[1]) : null);

  // Profile cá nhân (không phải Page): follower không nằm trong og:description mà trong JSON nhúng
  // dạng "text":"0 followers" / "text":"1.5K followers" -> lấy từ HTML làm fallback.
  let followers = toNum(followersDesc) ?? toNum(likes);
  if (followers == null) {
    const mHtml = htmlText.match(/"text":"([\d.,]+\s*[KkMm]?)\s*(?:followers?|người theo dõi)"/i);
    if (mHtml) followers = parseCount(mHtml[1]);
  }

  // bio = phần sau mệnh đề số liệu cuối cùng (…likes · …followers · …talking about this.)
  let bio = desc;
  const metrics = [...desc.matchAll(/[\d.,]+\s*(?:likes?|lượt thích|followers?|người theo dõi|talking about this|người đang nói)/gi)];
  if (metrics.length) {
    const last = metrics[metrics.length - 1];
    bio = desc.slice(last.index! + last[0].length).replace(/^[·.\s]+/, "");
  } else if (name && desc.startsWith(name)) {
    bio = desc.slice(name.length).replace(/^[.\s]+/, "");
  }

  if (followers == null && !bio) throw new Error("og:description không parse được số liệu");

  // Kết quả reels (đã chạy song song ở trên). Lỗi reels KHÔNG chặn việc lấy follower.
  const reels = await reelsPromise;
  const totalViews: number | null = reels ? reels.totalViews : null;
  const videosCount: number | null = reels ? reels.videoCount : null;

  return {
    ref: username.toLowerCase(),
    followers,
    totalViews,
    videosCount,
    engagement: toNum(talking),
    bio,
    raw: {
      engine: "facebook-curl", name, likes: toNum(likes), talking: toNum(talking),
      reels_views: totalViews, reels_count: videosCount,
      // debug khi không đọc được follower — soi VPS nhận HTML gì
      ...(followers == null
        ? { dbg_len: htmlText.length, dbg_has_follow: htmlText.includes("follower") || htmlText.includes("theo dõi"),
            dbg_desc: desc.slice(0, 80), dbg_login: htmlText.slice(0, 300).toLowerCase().includes("log in") }
        : {}),
    },
  };
}

/* ==== Lưu snapshot + xác minh bio (cùng logic với pipeline cũ) ==== */
export async function saveProfile(ch: any, prof: NormalizedProfile | null, date: string, errDetail?: string): Promise<{ ok: boolean; verified: boolean }> {
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
    // KHÔNG cần mã trong bio: quét đọc được kênh là tự động xác minh.
    // Mốc khởi điểm = 0 -> tính toàn bộ follower hiện có thành điểm.
    await db
      .from("channels")
      .update({
        status: "verified",
        verified_at: new Date().toISOString(),
        verified_by: "system",
        baseline_followers: 0,
        baseline_views: 0,
      })
      .eq("id", ch.id);
    await db.from("audit_logs").insert({
      actor_id: "system",
      action: "verify_channel_auto",
      target_type: "channel",
      target_id: ch.id,
      detail: { followers: prof.followers, engine: "direct" },
    });
    verified = true;
  }

  // Chống nhiễu IP: Facebook hay bóp số về 0/trống với IP máy chủ dù kênh có follower thật.
  // Nếu lần này đọc 0/null nhưng kênh ĐÃ từng đọc được số > 0 -> giữ số tốt gần nhất, tránh nhảy điểm.
  let followersOut = prof.followers;
  let engagementOut = prof.engagement;
  if (followersOut == null || followersOut === 0) {
    const { data: lastGood } = await db
      .from("channel_snapshots")
      .select("followers, engagement")
      .eq("channel_id", ch.id)
      .gt("followers", 0)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastGood?.followers) {
      followersOut = lastGood.followers;
      if (engagementOut == null) engagementOut = lastGood.engagement ?? null;
    }
  }

  const { error } = await db.from("channel_snapshots").upsert(
    {
      channel_id: ch.id,
      snapshot_date: date,
      followers: followersOut,
      total_views: prof.totalViews,
      videos_count: prof.videosCount,
      engagement: engagementOut,
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

/* ==== Nạp số liệu quét từ ngoài (Chrome Extension) ====
 * WAF của TikTok chặn theo TLS fingerprint + IP datacenter — máy chủ Vercel/VPS hay bị trả trang
 * bot-check. Extension chạy trong Chrome thật của admin nên đọc được trang bình thường; nó gửi
 * số liệu đã chuẩn hóa về đây. Ghi snapshot qua ĐÚNG saveProfile() của luồng quét máy chủ nên
 * logic tự xác minh kênh, giữ số tốt gần nhất và chấm điểm không đổi. */

export type ExternalProfileItem = {
  username: string;
  followers?: number | null;
  totalViews?: number | null;
  videosCount?: number | null;
  engagement?: number | null;
  bio?: string | null;
  error?: string | null;
};

export type IngestResult = {
  date: string;
  ok: number;
  failed: string[];
  verified: number;
  unknown: string[]; // username gửi lên nhưng không có kênh nào đang theo dõi
};

/** Ghi snapshot cho một lô kênh do extension quét. Idempotent theo (channel_id, snapshot_date). */
export async function ingestExternalProfiles(
  platform: string,
  items: ExternalProfileItem[],
  source = "extension"
): Promise<IngestResult> {
  const db = supabaseAdmin();
  const date = todayVN();
  const out: IngestResult = { date, ok: 0, failed: [], verified: 0, unknown: [] };
  if (!items.length) return out;

  const { data: channels } = await db
    .from("channels")
    .select("*")
    .eq("platform", platform)
    .in("status", ["pending", "verified"]);
  const byName = new Map((channels ?? []).map((c) => [String(c.username).toLowerCase(), c]));

  const runId = `${source}-${platform}-${Date.now()}`;
  await db.from("scrape_runs").insert({
    run_id: runId,
    platform,
    actor: `${source}/${platform}`,
    status: "started",
    channels_count: items.length,
    cost_usd: 0,
  });

  for (const it of items) {
    const uname = String(it.username ?? "").trim().toLowerCase().replace(/^@/, "");
    const ch = byName.get(uname);
    if (!ch) {
      out.unknown.push(uname);
      continue;
    }

    // Không có số nào đọc được -> coi như quét lỗi, giữ nguyên điểm hôm qua.
    const hasData =
      num(it.followers) != null || num(it.totalViews) != null || num(it.videosCount) != null;
    const prof: NormalizedProfile | null =
      it.error || !hasData
        ? null
        : {
            ref: uname,
            followers: num(it.followers),
            totalViews: num(it.totalViews),
            videosCount: num(it.videosCount),
            engagement: num(it.engagement) ?? num(it.totalViews),
            bio: String(it.bio ?? ""),
            raw: { engine: `${platform}-${source}` },
          };

    const saved = await saveProfile(ch, prof, date, it.error ?? "extension: không đọc được số liệu");
    if (saved.ok) out.ok++;
    else out.failed.push(`${platform}:@${uname}`);
    if (saved.verified) out.verified++;
  }

  await db
    .from("scrape_runs")
    .update({ status: out.ok > 0 ? "succeeded" : "failed", finished_at: new Date().toISOString() })
    .eq("run_id", runId);

  return out;
}
