/** Bộ điều phối quét. Chạy trong service worker của extension nên fetch tới TikTok mang đúng
 *  TLS fingerprint + cookie của Chrome thật -> qua được SlardarWAF (thứ đang chặn máy chủ).
 *
 *  Mỗi kênh thử 2 đường:
 *    1. fetch thẳng trang profile rồi bóc JSON nhúng (nhanh, ~1 request).
 *    2. nếu trượt (bot-check) -> mở tab ngầm, đọc JSON từ DOM đã render, đóng tab.
 *  Gửi số liệu về server theo từng lô 20 kênh để mất điện/đóng Chrome giữa chừng vẫn giữ được
 *  phần đã quét (endpoint ghi idempotent theo channel_id + ngày). */

import { parseProfileHtml, parseRehydrationJson } from "./parse.js";

const BATCH_SIZE = 20;
const TAB_LOAD_TIMEOUT = 30_000;
const DEFAULT_CONFIG = { baseUrl: "", token: "", autoEnabled: false, autoTime: "05:45" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (base) => base + Math.floor(Math.random() * base);

/* ==== cấu hình + trạng thái (giữ trong storage để popup đóng/mở vẫn thấy tiến trình) ==== */

async function getConfig() {
  const { config } = await chrome.storage.local.get("config");
  return { ...DEFAULT_CONFIG, ...(config ?? {}) };
}

async function getState() {
  const { runState } = await chrome.storage.local.get("runState");
  return runState ?? { running: false, total: 0, done: 0, ok: 0, failed: 0, log: [] };
}

async function setState(patch) {
  const cur = await getState();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ runState: next });
  return next;
}

/** Ghi 1 dòng nhật ký (giữ 200 dòng gần nhất). Ghi storage mỗi kênh cũng giúp service worker
 *  không bị Chrome ngủ giữa lượt quét dài. */
async function log(line) {
  const cur = await getState();
  const stamp = new Date().toLocaleTimeString("vi-VN", { hour12: false });
  const logs = [...(cur.log ?? []), `${stamp}  ${line}`].slice(-200);
  await chrome.storage.local.set({ runState: { ...cur, log: logs } });
}

/* ==== gọi API hệ thống ==== */

function apiUrl(baseUrl, path) {
  return `${String(baseUrl).replace(/\/+$/, "")}${path}`;
}

async function api(config, path, init = {}) {
  const res = await fetch(apiUrl(config.baseUrl, path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

/* ==== đọc số liệu 1 kênh ==== */

/** Đường 1: fetch thẳng. */
async function scanByFetch(username) {
  const res = await fetch(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
    credentials: "include",
    redirect: "follow",
    headers: { "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseProfileHtml(await res.text());
}

/** Chờ tab load xong (hoặc hết giờ). */
function waitForTab(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("tab quá hạn tải"));
    }, TAB_LOAD_TIMEOUT);
    function onUpdated(id, info) {
      if (id !== tabId || info.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

/** Đường 2: mở tab ngầm rồi đọc JSON từ DOM đã render. */
async function scanByTab(username) {
  const tab = await chrome.tabs.create({
    url: `https://www.tiktok.com/@${encodeURIComponent(username)}`,
    active: false,
  });
  try {
    await waitForTab(tab.id);
    // Đọc 2 lần cách nhau 3s: lần đầu trượt thì cho trang kịp render/qua bước kiểm tra.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__")?.textContent ?? null,
      });
      if (res?.result) return parseRehydrationJson(res.result);
      if (attempt === 1) await sleep(3000);
    }
    throw new Error("tab không có dữ liệu nhúng (bot-check?)");
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/** Quét 1 kênh, tự chuyển sang đường tab nếu fetch trượt. */
async function scanOne(username) {
  try {
    return await scanByFetch(username);
  } catch (e1) {
    try {
      const data = await scanByTab(username);
      await log(`  ↳ @${username}: fetch trượt (${e1.message}), đọc qua tab OK`);
      return data;
    } catch (e2) {
      throw new Error(`fetch: ${e1.message} | tab: ${e2.message}`);
    }
  }
}

/* ==== vòng quét ==== */

let stopRequested = false;

async function runScan({ all = false } = {}) {
  const state = await getState();
  if (state.running) throw new Error("Đang có lượt quét chạy");

  const config = await getConfig();
  if (!config.baseUrl || !config.token) throw new Error("Chưa cấu hình địa chỉ hệ thống và token");

  stopRequested = false;
  await chrome.storage.local.set({
    runState: { running: true, total: 0, done: 0, ok: 0, failed: 0, log: [], startedAt: Date.now() },
  });

  try {
    const list = await api(config, `/api/ingest/tiktok${all ? "?all=1" : ""}`);
    const channels = list.channels ?? [];
    await setState({ total: channels.length });
    await log(`Ngày ${list.date} — ${list.total} kênh TikTok, cần quét ${channels.length}.`);
    if (!channels.length) {
      await log("Không có kênh nào cần quét. Xong.");
      return await setState({ running: false, finishedAt: Date.now() });
    }

    let buffer = [];
    let ok = 0;
    let failed = 0;

    const flush = async () => {
      if (!buffer.length) return;
      const batch = buffer;
      buffer = [];
      try {
        const r = await api(config, "/api/ingest/tiktok", {
          method: "POST",
          body: JSON.stringify({ items: batch }),
        });
        const extra = r.unknown?.length ? `, ${r.unknown.length} kênh lạ bị bỏ` : "";
        await log(`Đã gửi ${batch.length} kênh → ghi ${r.ok}, lỗi ${r.failed.length}${extra}.`);
      } catch (e) {
        // Không ném tiếp: mất 1 lô còn hơn hỏng cả lượt quét. Lô sau vẫn gửi bình thường.
        await log(`LỖI gửi lô ${batch.length} kênh: ${e.message}`);
      }
    };

    for (const [i, ch] of channels.entries()) {
      if (stopRequested) {
        await log("Đã dừng theo yêu cầu.");
        break;
      }
      try {
        const data = await scanOne(ch.username);
        buffer.push(data);
        ok++;
        await log(`[${i + 1}/${channels.length}] @${ch.username}: ${data.followers ?? "—"} follower, ${data.totalViews ?? "—"} tim`);
      } catch (e) {
        buffer.push({ username: ch.username, error: String(e.message).slice(0, 300) });
        failed++;
        await log(`[${i + 1}/${channels.length}] @${ch.username}: LỖI — ${e.message}`);
      }
      await setState({ done: i + 1, ok, failed });
      if (buffer.length >= BATCH_SIZE) await flush();
      if (i < channels.length - 1) await sleep(jitter(1500));
    }

    await flush();
    await log(`Xong: ${ok} kênh đọc được, ${failed} lỗi.`);
    return await setState({ running: false, finishedAt: Date.now() });
  } catch (e) {
    await log(`LƯỢT QUÉT HỎNG: ${e.message}`);
    return await setState({ running: false, finishedAt: Date.now() });
  }
}

/* ==== hẹn giờ chạy tự động mỗi ngày ==== */

const ALARM = "daily-scan";

async function syncAlarm() {
  await chrome.alarms.clear(ALARM);
  const config = await getConfig();
  if (!config.autoEnabled) return;
  const [h, m] = String(config.autoTime).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return;
  const next = new Date();
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  await chrome.alarms.create(ALARM, { when: next.getTime(), periodInMinutes: 1440 });
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) runScan({}).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => syncAlarm());
chrome.runtime.onInstalled.addListener(() => syncAlarm());

/* ==== kênh liên lạc với popup ==== */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "getState":
        return { state: await getState(), config: await getConfig() };
      case "saveConfig":
        await chrome.storage.local.set({ config: { ...(await getConfig()), ...msg.config } });
        await syncAlarm();
        return { ok: true };
      case "testConn": {
        const list = await api(await getConfig(), "/api/ingest/tiktok");
        return { ok: true, ...list };
      }
      case "start":
        runScan({ all: Boolean(msg.all) }).catch(() => {});
        return { ok: true };
      case "stop":
        stopRequested = true;
        return { ok: true };
      default:
        return { error: "Lệnh không hợp lệ" };
    }
  })()
    .then(sendResponse)
    .catch((e) => sendResponse({ error: e.message }));
  return true; // giữ kênh mở cho phản hồi bất đồng bộ
});
