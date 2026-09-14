/** Giao diện popup: chỉ đọc/ghi cấu hình và hiển thị tiến trình.
 *  Toàn bộ việc quét nằm ở background.js — popup đóng lại lượt quét vẫn chạy tiếp. */

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

function showMsg(text, isError = false) {
  const el = $("msg");
  el.textContent = text;
  el.className = isError ? "msg err" : "msg";
}

/** Extension chỉ xin quyền tới đúng tên miền admin nhập, không xin sẵn toàn bộ web. */
async function ensureHostPermission(baseUrl) {
  let origin;
  try {
    origin = `${new URL(baseUrl).origin}/*`;
  } catch {
    throw new Error("Địa chỉ hệ thống không hợp lệ");
  }
  if (await chrome.permissions.contains({ origins: [origin] })) return;
  if (!(await chrome.permissions.request({ origins: [origin] }))) {
    throw new Error(`Cần cấp quyền truy cập ${origin}`);
  }
}

function render(state) {
  const { running, total, done, ok, failed, log } = state;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("barFill").style.width = `${pct}%`;
  $("stat").textContent = total
    ? `${done}/${total} kênh · ${ok} đọc được · ${failed} lỗi${running ? " · đang chạy…" : ""}`
    : running
      ? "Đang lấy danh sách kênh…"
      : "Chưa chạy lượt nào.";

  const pre = $("log");
  const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 24;
  pre.textContent = (log ?? []).join("\n");
  if (atBottom) pre.scrollTop = pre.scrollHeight;

  for (const id of ["start", "startAll"]) $(id).disabled = running;
  $("stop").disabled = !running;
}

async function refresh() {
  const res = await send({ type: "getState" });
  if (res?.state) render(res.state);
}

async function init() {
  const res = await send({ type: "getState" });
  const c = res?.config ?? {};
  $("baseUrl").value = c.baseUrl ?? "";
  $("token").value = c.token ?? "";
  $("autoEnabled").checked = Boolean(c.autoEnabled);
  $("autoTime").value = c.autoTime ?? "05:45";
  if (res?.state) render(res.state);
  setInterval(refresh, 700);
}

async function saveConfig() {
  const baseUrl = $("baseUrl").value.trim();
  const token = $("token").value.trim();
  if (!baseUrl || !token) throw new Error("Nhập đủ địa chỉ hệ thống và token");
  await ensureHostPermission(baseUrl);
  await send({
    type: "saveConfig",
    config: {
      baseUrl,
      token,
      autoEnabled: $("autoEnabled").checked,
      autoTime: $("autoTime").value || "05:45",
    },
  });
}

$("save").onclick = async () => {
  try {
    await saveConfig();
    showMsg("Đã lưu cấu hình.");
  } catch (e) {
    showMsg(e.message, true);
  }
};

$("test").onclick = async () => {
  try {
    await saveConfig();
    showMsg("Đang kiểm tra…");
    const r = await send({ type: "testConn" });
    if (r?.error) throw new Error(r.error);
    showMsg(`OK — ngày ${r.date}: ${r.total} kênh TikTok, ${r.remaining} kênh cần quét.`);
  } catch (e) {
    showMsg(e.message, true);
  }
};

const startScan = (all) => async () => {
  try {
    await saveConfig();
    showMsg("");
    const r = await send({ type: "start", all });
    if (r?.error) throw new Error(r.error);
  } catch (e) {
    showMsg(e.message, true);
  }
};
$("start").onclick = startScan(false);
$("startAll").onclick = startScan(true);
$("stop").onclick = () => send({ type: "stop" });

init();
