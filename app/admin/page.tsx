"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Lane, LBRow, METRIC_LABEL, SiteHeader, useToast } from "@/components/ui";

type Prize = { label: string; reward: string };
type Campaign = {
  id: string; name: string; scope: string; class_names: string[]; class_ids: string[];
  start_date: string; end_date: string; registration_deadline: string | null;
  prize: string | null; prizes: Prize[]; weights: Record<string, number>; weekly_quota: number;
  status: string; participants: number;
};
type StudentRow = {
  id: string; public_id: string; full_name: string; phone: string; status: string;
  class_name: string | null; platforms: string[]; verified: number; total_channels: number; best_score: number;
};

const fmt = (n: number) => Math.round(n).toLocaleString("vi-VN");
const dmy = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
/* ==== Ô nhập ngày định dạng Việt dd/mm/yyyy cố định (không phụ thuộc ngôn ngữ trình duyệt) ====
 * Gõ tay tự chèn dấu "/", hoặc bấm 📅 mở lịch. Giá trị lưu/truyền đi luôn là ISO yyyy-mm-dd. */
const iso2dmy = (iso: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : "";
const dmy2iso = (t: string): string | null => {
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const dt = new Date(`${iso}T00:00:00`);
  if (isNaN(dt.getTime()) || dt.getDate() !== Number(d) || dt.getMonth() + 1 !== Number(mo)) return null;
  return iso;
};

function DateField({ value, onChange, disabled }: { value: string; onChange: (iso: string) => void; disabled?: boolean }) {
  const [text, setText] = useState(iso2dmy(value));
  const [bad, setBad] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setText(iso2dmy(value)); setBad(false); }, [value]);

  function handleText(raw: string) {
    // chỉ giữ số, tự chèn "/" theo dd/mm/yyyy
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    let t = digits;
    if (digits.length > 4) t = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2) t = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    setText(t);
    if (!t) { setBad(false); onChange(""); return; }
    const iso = dmy2iso(t);
    if (iso) { setBad(false); onChange(iso); }
    else setBad(t.length >= 10);
  }

  return (
    <div style={{ display: "flex", gap: 6 }}>
      <input
        value={text}
        onChange={(e) => handleText(e.target.value)}
        placeholder="dd/mm/yyyy"
        inputMode="numeric"
        disabled={disabled}
        style={bad ? { borderColor: "var(--red)" } : undefined}
      />
      <button
        type="button"
        className="btn-ghost btn-sm"
        disabled={disabled}
        title="Mở lịch"
        style={{ flexShrink: 0 }}
        onClick={() => { const p = pickerRef.current as any; if (p?.showPicker) p.showPicker(); else p?.click(); }}
      >
        📅
      </button>
      <input
        ref={pickerRef}
        type="date"
        value={/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
      />
    </div>
  );
}
const STATUS_PILL: Record<string, [string, string]> = {
  running: ["pill-live", "Đang chạy"],
  open: ["pill-soon", "Mở đăng ký"],
  draft: ["pill-soon", "Nháp"],
  paused: ["pill-warn", "Tạm dừng"],
  finished: ["pill-done", "Đã kết thúc"],
};

export default function AdminPage() {
  const { toast, toastNode } = useToast();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState<"camp" | "new" | "students" | "bxh" | "scrape">("camp");

  const [stats, setStats] = useState({ running: 0, students: 0, channels: 0 });
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [q, setQ] = useState("");
  const [lbCampId, setLbCampId] = useState("");
  const [lbRows, setLbRows] = useState<any[]>([]);
  const [lbView, setLbView] = useState<"lanes" | "detail">("lanes");
  const [lbLastDate, setLbLastDate] = useState<string | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [scrape, setScrape] = useState<any | null>(null);
  const [scrapeBusy, setScrapeBusy] = useState(false);

  // Form tạo chiến dịch
  const [form, setForm] = useState({
    name: "", scope: "class", class_ids: [] as string[],
    start_date: "", end_date: "", registration_deadline: "",
    prizes: [{ label: "Top 1", reward: "" }] as Prize[],
    weekly_quota: "5",
    weights: { follower: "10", per_1000_views: "5", new_video: "20", engagement: "2", weekly_bonus: "100" },
  });
  const [newClassName, setNewClassName] = useState("");
  // Modal sửa giải thưởng (sửa được mọi lúc, kể cả khi đang chạy)
  const [prizeEdit, setPrizeEdit] = useState<{ camp: Campaign; rows: Prize[] } | null>(null);
  const [editCamp, setEditCamp] = useState<{
    id: string; status: string; scope: string; name: string; start_date: string; end_date: string;
    registration_deadline: string; weekly_quota: string; weights: Record<string, string>; class_ids: string[];
  } | null>(null);

  const loadCampaigns = useCallback(async () => {
    const r = await fetch("/api/admin/campaigns");
    if (r.status === 401) { setAuthed(false); return; }
    if (!r.ok) {
      setAuthed(false);
      toast("Không kết nối được database — kiểm tra .env.local và chạy migration");
      return;
    }
    const d = await r.json();
    setAuthed(true);
    setStats(d.stats);
    setCampaigns(d.campaigns);
    if (!lbCampId && d.campaigns.length) setLbCampId(d.campaigns[0].id);
  }, [lbCampId]);

  useEffect(() => {
    loadCampaigns();
    fetch("/api/classes").then((r) => r.json()).then((d) => setClasses(d.classes ?? []));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadStudents = useCallback(async (query: string) => {
    const r = await fetch(`/api/admin/students?q=${encodeURIComponent(query)}`);
    if (r.ok) setStudents((await r.json()).students);
  }, []);

  useEffect(() => { if (authed && tab === "students") loadStudents(q); }, [authed, tab, q, loadStudents]);
  useEffect(() => {
    if (authed && tab === "bxh" && lbCampId) {
      fetch(`/api/leaderboard?campaign_id=${lbCampId}&detail=1`)
        .then((r) => r.json())
        .then((d) => { setLbRows(d.rows ?? []); setLbLastDate(d.last_entry_date ?? null); });
    }
  }, [authed, tab, lbCampId]);

  const loadScrape = useCallback(async () => {
    const r = await fetch("/api/admin/scrape");
    if (r.ok) setScrape(await r.json());
  }, []);
  useEffect(() => { if (authed && tab === "scrape") loadScrape(); }, [authed, tab, loadScrape]);

  async function scrapeAction(action: "scrape" | "score") {
    if (scrapeBusy) return;
    setScrapeBusy(true);
    try {
      const r = await fetch("/api/admin/scrape", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      const d = await r.json();
      if (!r.ok) { toast(d.error ?? "Lỗi"); return; }
      if (action === "scrape") {
        const parts = (d.platforms ?? []).map((s: any) => `${s.platform}: ${s.ok}/${s.channels} kênh${s.verified ? ` (+${s.verified} xác minh)` : ""}`);
        toast(parts.length ? `Đã quét xong — ${parts.join(" · ")}` : "Không có kênh nào cần quét hoặc nền tảng nào đang bật");
      } else {
        toast(`Đã tính điểm ${d.date}: ${d.campaigns} chiến dịch, ${d.entries} dòng điểm${d.flagged?.length ? `, gắn cờ ${d.flagged.length} kênh` : ""}`);
      }
      loadScrape();
    } finally {
      setScrapeBusy(false);
    }
  }


  async function togglePlatform(cfg: any) {
    const r = await fetch("/api/admin/scrape", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: cfg.platform, is_active: !cfg.is_active }),
    });
    if (r.ok) { toast(cfg.is_active ? `Đã tắt quét ${cfg.platform}` : `Đã bật quét ${cfg.platform}`); loadScrape(); }
    else toast((await r.json()).error ?? "Lỗi");
  }

  async function login() {
    const r = await fetch("/api/admin/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (r.ok) { setAuthed(true); loadCampaigns(); }
    else toast((await r.json()).error ?? "Sai mật khẩu");
  }

  async function createClass() {
    const name = newClassName.trim();
    if (!name) { toast("Nhập tên lớp trước đã"); return; }
    const r = await fetch("/api/admin/classes", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    });
    const d = await r.json();
    if (!r.ok) { toast(d.error ?? "Không tạo được lớp"); return; }
    setClasses((prev) => [...prev, d.class].sort((a, b) => a.name.localeCompare(b.name, "vi")));
    setForm((f) => ({ ...f, class_ids: [...f.class_ids, d.class.id] }));
    setNewClassName("");
    toast(`Đã tạo lớp "${d.class.name}" và chọn sẵn cho chiến dịch`);
  }

  async function deleteSelectedClasses() {
    const targets = classes.filter((c) => form.class_ids.includes(c.id));
    if (!targets.length) { toast("Bấm chọn lớp cần xóa trong danh sách trước đã"); return; }
    const names = targets.map((c) => `"${c.name}"`).join(", ");
    if (!confirm(`Xóa ${targets.length} lớp: ${names}?\nLớp đã có học viên hoặc chiến dịch sẽ chỉ bị ẩn đi, không mất dữ liệu.`)) return;
    for (const c of targets) {
      const r = await fetch(`/api/admin/classes/${c.id}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) { toast(d.error ?? `Không xóa được lớp "${c.name}"`); continue; }
      setClasses((prev) => prev.filter((x) => x.id !== c.id));
      setForm((f) => ({ ...f, class_ids: f.class_ids.filter((id) => id !== c.id) }));
      toast(d.deleted ? `Đã xóa lớp "${c.name}"` : `Lớp "${c.name}" đang có ${d.students} học viên, ${d.campaigns} chiến dịch — đã ẩn khỏi danh sách`);
    }
  }

  async function createCampaign() {
    const body = {
      name: form.name,
      scope: form.scope,
      class_ids: form.class_ids,
      start_date: form.start_date,
      end_date: form.end_date,
      registration_deadline: form.registration_deadline || null,
      prizes: form.prizes.filter((p) => p.reward.trim()),
      weekly_quota: Number(form.weekly_quota || 0),
      weights: Object.fromEntries(Object.entries(form.weights).map(([k, v]) => [k, Number(v)])),
    };
    const r = await fetch("/api/admin/campaigns", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await r.json();
    if (r.ok) {
      toast(`Đã tạo chiến dịch: ${body.name}`);
      setTab("camp");
      loadCampaigns();
    } else toast(d.error ?? "Không tạo được chiến dịch");
  }

  async function campaignAction(c: Campaign, action: "pause" | "resume" | "finish") {
    const labels = { pause: "TẠM DỪNG", resume: "chạy tiếp", finish: "KẾT THÚC SỚM" };
    if (action !== "resume" && !confirm(`Xác nhận ${labels[action]} chiến dịch "${c.name}"?`)) return;
    if (action === "finish" && !confirm(`Chắc chắn kết thúc "${c.name}"? Hành động này không hoàn tác được.`)) return;
    const r = await fetch(`/api/admin/campaigns/${c.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
    });
    const d = await r.json();
    if (r.ok) { toast("Đã cập nhật trạng thái"); loadCampaigns(); }
    else toast(d.error ?? "Không cập nhật được");
  }

  function openCampaignEdit(c: Campaign) {
    setEditCamp({
      id: c.id, status: c.status, scope: c.scope, name: c.name,
      start_date: c.start_date, end_date: c.end_date,
      registration_deadline: c.registration_deadline ?? "",
      weekly_quota: String(c.weekly_quota ?? 0),
      weights: Object.fromEntries(Object.entries(c.weights ?? {}).map(([k, v]) => [k, String(v)])),
      class_ids: c.class_ids ?? [],
    });
  }

  async function saveCampaignEdit() {
    if (!editCamp) return;
    const frozen = !["draft", "open"].includes(editCamp.status);
    const body: Record<string, unknown> = {
      name: editCamp.name,
      end_date: editCamp.end_date,
      registration_deadline: editCamp.registration_deadline || null,
    };
    if (editCamp.scope === "class") body.class_ids = editCamp.class_ids;
    if (!frozen) {
      body.start_date = editCamp.start_date;
      body.weekly_quota = Number(editCamp.weekly_quota || 0);
      body.weights = Object.fromEntries(Object.entries(editCamp.weights).map(([k, v]) => [k, Number(v || 0)]));
    }
    const r = await fetch(`/api/admin/campaigns/${editCamp.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await r.json();
    if (r.ok) { toast("Đã cập nhật chiến dịch"); setEditCamp(null); loadCampaigns(); }
    else toast(d.error ?? "Không cập nhật được");
  }

  async function savePrizes() {
    if (!prizeEdit) return;
    const r = await fetch(`/api/admin/campaigns/${prizeEdit.camp.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prizes: prizeEdit.rows.filter((p) => p.reward.trim()) }),
    });
    const d = await r.json();
    if (r.ok) { toast("Đã lưu cơ cấu giải thưởng"); setPrizeEdit(null); loadCampaigns(); }
    else toast(d.error ?? "Không lưu được");
  }

  async function openProfile(id: string) {
    const r = await fetch(`/api/admin/students/${id}`);
    if (r.ok) setProfile(await r.json());
  }

  async function verifyChannel(chId: string) {
    toast("Đang quét kênh để lấy số liệu gốc…");
    const r = await fetch(`/api/admin/channels/${chId}/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      const fl = d.baseline_followers != null ? Number(d.baseline_followers).toLocaleString("vi-VN") : "—";
      toast(`Đã xác minh · mốc gốc ${fl} follower (${d.source ?? "—"})`);
      openProfile(profile.student.id); loadStudents(q);
    } else toast(d.error ?? "Lỗi");
  }

  async function removeChannel(chId: string, username: string) {
    const reason = prompt(`Gỡ kênh @${username}? Kênh sẽ ẩn khỏi hệ thống và ngừng tính điểm (lịch sử vẫn giữ).\nNhập lý do (bắt buộc):`);
    if (!reason) return;
    const r = await fetch(`/api/admin/channels/${chId}?reason=${encodeURIComponent(reason)}`, { method: "DELETE" });
    if (r.ok) { toast("Đã gỡ kênh"); openProfile(profile.student.id); loadStudents(q); }
    else toast((await r.json()).error ?? "Lỗi");
  }

  async function restoreChannel(chId: string) {
    const r = await fetch(`/api/admin/channels/${chId}`, { method: "PATCH" });
    if (r.ok) { toast("Đã khôi phục kênh — chờ xác minh lại"); openProfile(profile.student.id); loadStudents(q); }
    else toast((await r.json()).error ?? "Lỗi");
  }

  async function toggleLock() {
    const lock = profile.student.status !== "locked";
    const reason = lock ? prompt("Lý do khóa học viên (bắt buộc):") : null;
    if (lock && !reason) return;
    const r = await fetch(`/api/admin/students/${profile.student.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: lock ? "locked" : "active", reason }),
    });
    if (r.ok) { toast(lock ? "Đã khóa học viên" : "Đã mở khóa"); openProfile(profile.student.id); }
  }

  async function deleteStudent() {
    const s = profile.student;
    if (!confirm(`XÓA HẲN hồ sơ "${s.full_name}" (${s.public_id})?\n\nSẽ xóa vĩnh viễn: toàn bộ kênh (giải phóng cho người khác đăng ký), điểm số, lịch sử ghi danh.\nHành động này KHÔNG hoàn tác được.`)) return;
    const reason = prompt("Nhập lý do xóa (bắt buộc, lưu vào nhật ký hệ thống):");
    if (!reason?.trim()) return;
    const r = await fetch(`/api/admin/students/${s.id}?reason=${encodeURIComponent(reason)}`, { method: "DELETE" });
    const d = await r.json();
    if (r.ok) { toast(`Đã xóa hồ sơ ${s.public_id}`); setProfile(null); loadStudents(q); }
    else toast(d.error ?? "Không xóa được");
  }

  async function adjustScore(campaignId: string) {
    const points = Number(prompt("Số điểm điều chỉnh (âm để trừ):") ?? "");
    if (!Number.isFinite(points) || points === 0) return;
    const note = prompt("Lý do điều chỉnh (bắt buộc):")?.trim();
    if (!note) { toast("Bắt buộc nhập lý do"); return; }
    const r = await fetch("/api/admin/scores/adjust", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaign_id: campaignId, student_id: profile.student.id, points, note }),
    });
    if (r.ok) { toast("Đã điều chỉnh điểm"); openProfile(profile.student.id); }
    else toast((await r.json()).error ?? "Lỗi");
  }

  if (authed === false) {
    return (
      <>
        <SiteHeader subtitle="BẢNG ĐIỀU KHIỂN ADMIN" right={<span>Admin · TAKI ACADEMY</span>} />
        <div className="wrap" style={{ maxWidth: 420 }}>
          <div className="card">
            <h3>🔐 Đăng nhập admin</h3>
            <div className="field">
              <label>Mật khẩu</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && login()} />
            </div>
            <button className="btn" onClick={login}>Đăng nhập</button>
          </div>
        </div>
        {toastNode}
      </>
    );
  }
  if (authed === null) return <><SiteHeader subtitle="BẢNG ĐIỀU KHIỂN ADMIN" right={<span />} /><div className="wrap"><p className="mini-note">Đang tải…</p></div></>;

  const maxLb = lbRows[0]?.total_score ?? 0;

  return (
    <>
      <SiteHeader subtitle="BẢNG ĐIỀU KHIỂN ADMIN" right={<span>Admin · TAKI ACADEMY</span>} />
      <div className="wrap">
        <div className="tabs">
          <button className={tab === "camp" ? "on" : ""} onClick={() => { setTab("camp"); loadCampaigns(); }}>Chiến dịch</button>
          <button className={tab === "new" ? "on" : ""} onClick={() => setTab("new")}>+ Tạo chiến dịch</button>
          <button className={tab === "students" ? "on" : ""} onClick={() => setTab("students")}>Học viên</button>
          <button className={tab === "bxh" ? "on" : ""} onClick={() => setTab("bxh")}>Bảng xếp hạng</button>
          <button className={tab === "scrape" ? "on" : ""} onClick={() => setTab("scrape")}>Quét dữ liệu</button>
        </div>

        {tab === "camp" && (
          <div>
            <div className="grid grid-3" style={{ marginBottom: 18 }}>
              <div className="stat"><b>{stats.running}</b><span>Chiến dịch đang chạy</span></div>
              <div className="stat"><b>{fmt(stats.students)}</b><span>Học viên tham gia</span></div>
              <div className="stat"><b>{fmt(stats.channels)}</b><span>Kênh đang theo dõi</span></div>
            </div>
            <div className="card">
              <h3>📋 Tất cả chiến dịch</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>Chiến dịch</th><th>Phạm vi</th><th>Thời gian</th><th>Học viên</th><th>Trạng thái</th><th></th></tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => {
                      const pill = STATUS_PILL[c.status] ?? ["pill-done", c.status];
                      return (
                        <tr key={c.id}>
                          <td>
                            <b>{c.name}</b>
                            {c.prizes?.length
                              ? <div className="mini-note">🎁 {c.prizes.length} giải · {c.prizes[0].label}: {c.prizes[0].reward}</div>
                              : c.prize ? <div className="mini-note">🎁 {c.prize}</div> : null}
                          </td>
                          <td>{c.scope === "global" ? "Toàn hệ thống" : c.class_names.join(", ") || "Theo lớp"}</td>
                          <td>{dmy(c.start_date)} – {dmy(c.end_date)}</td>
                          <td>{c.participants || "—"}</td>
                          <td><span className={`pill ${pill[0]}`}>{pill[1]}</span></td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <button className="btn-ghost btn-sm" onClick={() => openCampaignEdit(c)}>✏️ Sửa</button>{" "}
                            <button
                              className="btn-ghost btn-sm"
                              onClick={() => setPrizeEdit({
                                camp: c,
                                rows: c.prizes?.length ? c.prizes.map((p) => ({ ...p }))
                                  : c.prize ? [{ label: "Giải thưởng", reward: c.prize }]
                                  : [{ label: "Top 1", reward: "" }],
                              })}
                            >
                              🎁 Giải
                            </button>{" "}
                            {c.status === "running" && (
                              <button className="btn-ghost btn-sm" onClick={() => campaignAction(c, "pause")}>Tạm dừng</button>
                            )}{" "}
                            {c.status === "paused" && (
                              <button className="btn-ghost btn-sm" onClick={() => campaignAction(c, "resume")}>Chạy tiếp</button>
                            )}{" "}
                            {["running", "paused", "open"].includes(c.status) && (
                              <button className="btn-ghost btn-sm btn-danger" onClick={() => campaignAction(c, "finish")}>Kết thúc</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {!campaigns.length && <tr><td colSpan={6}>Chưa có chiến dịch nào.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === "new" && (
          <div className="two-col">
            <div className="card">
              <h3>🚀 Thông tin chiến dịch</h3>
              <div className="field"><label>Tên chiến dịch</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ví dụ: Đường đua 30 ngày K12" /></div>
              <div className="field"><label>Phạm vi đua</label>
                <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
                  <option value="class">Theo lớp học</option>
                  <option value="global">Toàn hệ thống (liên lớp)</option>
                  <option value="industry">Theo nhóm ngành hàng</option>
                </select></div>
              {form.scope === "class" && (
                <div className="field"><label>Chọn lớp áp dụng (giữ Cmd/Ctrl để chọn nhiều)</label>
                  <select multiple size={3} value={form.class_ids}
                    onChange={(e) => setForm({ ...form, class_ids: Array.from(e.target.selectedOptions).map((o) => o.value) })}>
                    {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, marginTop: 8 }}>
                    <input value={newClassName} placeholder="Chưa có lớp? Nhập tên lớp mới, ví dụ: Minh Trí Kim Cương K13"
                      onChange={(e) => setNewClassName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") createClass(); }} />
                    <button className="btn-ghost btn-sm" onClick={createClass}>+ Thêm lớp</button>
                    <button className="btn-ghost btn-sm btn-danger" onClick={deleteSelectedClasses}>🗑 Xóa lớp đang chọn</button>
                  </div>
                </div>
              )}
              <div className="two-col">
                <div className="field"><label>Ngày bắt đầu</label>
                  <DateField value={form.start_date} onChange={(v) => setForm({ ...form, start_date: v })} /></div>
                <div className="field"><label>Ngày kết thúc</label>
                  <DateField value={form.end_date} onChange={(v) => setForm({ ...form, end_date: v })} /></div>
              </div>
              <div className="field"><label>Hạn chốt đăng ký kênh</label>
                <DateField value={form.registration_deadline} onChange={(v) => setForm({ ...form, registration_deadline: v })} /></div>
              <div className="field">
                <label>Cơ cấu giải thưởng (hiện trên trang đua, sửa được cả khi đang chạy)</label>
                {form.prizes.map((p, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "110px 1fr auto", gap: 8, marginBottom: 8 }}>
                    <input value={p.label} placeholder="Top 1"
                      onChange={(e) => setForm({ ...form, prizes: form.prizes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                    <input value={p.reward} placeholder="Ví dụ: Suất coaching 1:1 cùng Founder"
                      onChange={(e) => setForm({ ...form, prizes: form.prizes.map((x, j) => (j === i ? { ...x, reward: e.target.value } : x)) })} />
                    <button className="btn-ghost btn-sm" onClick={() => setForm({ ...form, prizes: form.prizes.filter((_, j) => j !== i) })}>✕</button>
                  </div>
                ))}
                <button className="btn-ghost btn-sm" onClick={() => setForm({ ...form, prizes: [...form.prizes, { label: `Top ${form.prizes.length + 1}`, reward: "" }] })}>
                  + Thêm giải
                </button>
              </div>
            </div>

            <div className="card">
              <h3>⚖️ Công thức tính điểm</h3>
              <p className="mini-note" style={{ marginBottom: 12 }}>
                Đặt trọng số cho từng chỉ số. Điểm = tổng các chỉ số nhân trọng số, chuẩn hóa theo quy mô kênh
                lúc xuất phát để công bằng giữa kênh mới và kênh lớn. Công thức đóng băng khi chiến dịch bắt đầu.
              </p>
              {([
                ["follower", "Follower tăng thêm"],
                ["per_1000_views", "Mỗi 1.000 lượt xem"],
                ["new_video", "Mỗi video đăng mới"],
                ["engagement", "Tương tác (like + share + bình luận)"],
                ["weekly_bonus", "Điểm chuyên cần (đăng đủ chỉ tiêu tuần)"],
              ] as const).map(([key, label]) => (
                <div className="w-row" key={key}>
                  <span>{label}</span>
                  <input type="number" min={0} value={form.weights[key]}
                    onChange={(e) => setForm({ ...form, weights: { ...form.weights, [key]: e.target.value } })} />
                </div>
              ))}
              <div className="field" style={{ marginTop: 14 }}>
                <label>Chỉ tiêu video tối thiểu mỗi tuần</label>
                <input type="number" min={0} value={form.weekly_quota}
                  onChange={(e) => setForm({ ...form, weekly_quota: e.target.value })} placeholder="Ví dụ: 5" />
              </div>
              <button className="btn" onClick={createCampaign}>Tạo chiến dịch và mở đăng ký</button>
            </div>
          </div>
        )}

        {tab === "students" && (
          <div className="card">
            <h3>
              👥 Học viên đã đăng ký
              <input placeholder="Tìm theo tên, ID, SĐT…" style={{ maxWidth: 240, marginLeft: "auto" }}
                value={q} onChange={(e) => setQ(e.target.value)} />
            </h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>ID</th><th>Học viên</th><th>Lớp</th><th>Kênh</th><th>Xác minh</th><th>Điểm</th><th></th></tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id} style={s.status === "locked" ? { opacity: 0.55 } : undefined}>
                      <td><b>{s.public_id}</b></td>
                      <td>{s.full_name}{s.status === "locked" ? " 🔒" : ""}</td>
                      <td>{s.class_name ?? "—"}</td>
                      <td>{s.platforms.map((p) => p[0].toUpperCase() + p.slice(1)).join(", ") || "—"}</td>
                      <td>
                        <span className={`pill ${s.verified === s.total_channels && s.total_channels > 0 ? "pill-live" : "pill-soon"}`}>
                          {s.verified}/{s.total_channels}
                        </span>
                      </td>
                      <td><b>{s.best_score ? fmt(s.best_score) : "—"}</b></td>
                      <td><button className="btn-ghost btn-sm" onClick={() => openProfile(s.id)}>Hồ sơ</button></td>
                    </tr>
                  ))}
                  {!students.length && <tr><td colSpan={7}>Không có học viên nào khớp.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "bxh" && (
          <div className="card">
            <h3>
              🏆 Bảng xếp hạng
              <select style={{ maxWidth: 280, marginLeft: "auto" }} value={lbCampId} onChange={(e) => setLbCampId(e.target.value)}>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button className="btn-ghost btn-sm" onClick={() => setLbView(lbView === "lanes" ? "detail" : "lanes")}>
                {lbView === "lanes" ? "Xem bảng chi tiết" : "Xem đường đua"}
              </button>
              <a className="btn-ghost btn-sm" href={`/api/admin/export/leaderboard?campaign_id=${lbCampId}`} style={{ textDecoration: "none" }}>
                Xuất Excel
              </a>
            </h3>
            {lbLastDate && (
              <p className="mini-note" style={{ marginBottom: 10 }}>
                Dòng điểm gần nhất: {dmy(lbLastDate)}. Cột "Hôm nay" = điểm của ngày đó.
              </p>
            )}
            {lbView === "lanes" ? (
              <div>
                {lbRows.map((r) => <Lane key={r.student_id} row={r} max={maxLb} />)}
                {!lbRows.length && <p className="mini-note">Chưa có dữ liệu xếp hạng cho chiến dịch này.</p>}
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Hạng</th><th>±</th><th>ID</th><th>Học viên</th><th>Lớp</th><th>Kênh ✓</th>
                      <th>Follower kênh</th><th>View kênh</th>
                      <th>Đ.Follower</th><th>Đ.Lượt xem</th><th>Đ.Video</th><th>Đ.Tương tác</th>
                      <th>Chuyên cần</th><th>Điều chỉnh</th><th>Hôm nay</th><th>Tổng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lbRows.map((r: any) => {
                      const d = r.prev_rank != null && r.rank != null ? r.prev_rank - r.rank : 0;
                      return (
                        <tr key={r.student_id}>
                          <td><b>{r.rank ?? "—"}</b></td>
                          <td className={d > 0 ? "up" : d < 0 ? "down" : ""}>{d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : "—"}</td>
                          <td><b>{r.public_id}</b></td>
                          <td>{r.name}</td>
                          <td>{r.class_name ?? "—"}</td>
                          <td>{r.verified_channels ?? 0}</td>
                          <td><b>{fmt(r.channel_followers ?? 0)}</b></td>
                          <td><b>{fmt(r.channel_views ?? 0)}</b></td>
                          <td>{fmt(r.breakdown?.follower ?? 0)}</td>
                          <td>{fmt(r.breakdown?.views ?? 0)}</td>
                          <td>{fmt(r.breakdown?.new_video ?? 0)}</td>
                          <td>{fmt(r.breakdown?.engagement ?? 0)}</td>
                          <td>{fmt(r.breakdown?.weekly_bonus ?? 0)}</td>
                          <td>{fmt(r.breakdown?.manual_adjust ?? 0)}</td>
                          <td className={r.today_points > 0 ? "up" : ""}>{r.today_points > 0 ? `+${fmt(r.today_points)}` : "—"}</td>
                          <td><b>{fmt(r.total_score)}</b></td>
                        </tr>
                      );
                    })}
                    {!lbRows.length && <tr><td colSpan={16}>Chưa có dữ liệu.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "scrape" && (
          <div>
            <div className="grid grid-3" style={{ marginBottom: 18 }}>
              <div className="stat">
                <b style={{ color: "var(--green)" }}>{scrape ? "Quét trực tiếp" : "…"}</b>
                <span>Engine quét (miễn phí, không qua bên thứ ba)</span>
              </div>
              <div className="stat">
                <b>{scrape ? `${scrape.channels_scanned_today}/${scrape.channels_total}` : "…"}</b>
                <span>Kênh đã quét hôm nay</span>
              </div>
              <div className="stat">
                <b>{scrape?.runs?.[0] ? new Date(scrape.runs[0].started_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "—"}</b>
                <span>Lần quét gần nhất</span>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 18 }}>
              <h3>
                📡 Nền tảng quét
                <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <button className="btn-ghost btn-sm" disabled={scrapeBusy} onClick={() => scrapeAction("scrape")}>
                    {scrapeBusy ? "Đang chạy…" : "▶ Quét ngay"}
                  </button>
                  <button className="btn-ghost btn-sm" disabled={scrapeBusy} onClick={() => scrapeAction("score")}>
                    🧮 Tính điểm lại hôm nay
                  </button>
                </span>
              </h3>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Nền tảng</th><th>Cách quét</th><th>Trạng thái</th><th></th></tr></thead>
                  <tbody>
                    {(scrape?.configs ?? []).map((cfg: any) => {
                      const ENGINE: Record<string, string> = {
                        tiktok: "Đọc trực tiếp trang profile",
                        facebook: "Đọc trực tiếp trang (fb-cli)",
                        youtube: "Chờ YouTube API key",
                        instagram: "Chưa hỗ trợ quét trực tiếp",
                      };
                      return (
                        <tr key={cfg.platform}>
                          <td><b>{cfg.platform}</b></td>
                          <td style={{ fontSize: 12.5, color: "var(--muted)" }}>{ENGINE[cfg.platform] ?? "—"}</td>
                          <td><span className={`pill ${cfg.is_active ? "pill-live" : "pill-done"}`}>{cfg.is_active ? "Đang bật" : "Đang tắt"}</span></td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <button className="btn-ghost btn-sm" onClick={() => togglePlatform(cfg)}>{cfg.is_active ? "Tắt" : "Bật"}</button>
                          </td>
                        </tr>
                      );
                    })}
                    {scrape && !scrape.configs?.length && (
                      <tr><td colSpan={4}>Chưa có cấu hình nền tảng.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="mini-note" style={{ marginTop: 10 }}>
                Lịch tự động: quét 05:30 · tính điểm 06:00 giờ VN. Quét trực tiếp từ máy chủ, không tốn phí dịch vụ ngoài.
              </p>
            </div>

            <div className="two-col" style={{ marginBottom: 18 }}>
              <div className="card">
                <h3>⚠️ Kênh chưa quét được hôm nay ({scrape?.not_scanned?.length ?? 0})</h3>
                {(scrape?.not_scanned ?? []).slice(0, 15).map((c: any) => (
                  <p key={c.id} style={{ fontSize: 12.5, marginBottom: 5 }}>
                    <b>{c.platform}</b> @{c.username} · {c.student ?? "—"}{" "}
                    <span className={`st ${c.status === "verified" ? "st-ok" : "st-wait"}`} style={{ fontSize: 10 }}>{c.status}</span>
                  </p>
                ))}
                {scrape && !scrape.not_scanned?.length && <p className="mini-note">Tất cả kênh đã có số liệu hôm nay ✓</p>}
              </div>
              <div className="card">
                <h3>🚩 Kênh bị gắn cờ gian lận ({scrape?.flagged?.length ?? 0})</h3>
                {(scrape?.flagged ?? []).map((c: any) => (
                  <p key={c.id} style={{ fontSize: 12.5, marginBottom: 5 }}>
                    <b>{c.platform}</b> @{c.username} · {c.student ?? "—"} — xử lý trong Hồ sơ học viên (xác minh tay để mở lại)
                  </p>
                ))}
                {scrape && !scrape.flagged?.length && <p className="mini-note">Không có kênh nào bị gắn cờ ✓</p>}
              </div>
            </div>

            <div className="card">
              <h3>🗂 20 lượt quét gần nhất</h3>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Thời điểm</th><th>Nền tảng</th><th>Engine</th><th>Kênh</th><th>Trạng thái</th></tr></thead>
                  <tbody>
                    {(scrape?.runs ?? []).map((r: any) => (
                      <tr key={r.id}>
                        <td>{new Date(r.started_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</td>
                        <td><b>{r.platform}</b></td>
                        <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.actor}</td>
                        <td>{r.channels_count ?? "—"}</td>
                        <td>
                          <span className={`pill ${r.status === "succeeded" ? "pill-live" : r.status === "failed" ? "pill-warn" : "pill-soon"}`}>
                            {r.status === "succeeded" ? "Thành công" : r.status === "failed" ? "Lỗi" : "Đang chạy"}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {scrape && !scrape.runs?.length && <tr><td colSpan={5}>Chưa có lượt quét nào. Bấm "Quét ngay" để chạy thử.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {editCamp && (() => {
        const frozen = !["draft", "open"].includes(editCamp.status);
        return (
          <div className="modal-bg" onClick={() => setEditCamp(null)}>
            <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ fontWeight: 800, color: "var(--navy)", marginBottom: 4 }}>✏️ Sửa chiến dịch</h3>
              {frozen && (
                <p className="mini-note" style={{ marginBottom: 12 }}>
                  Chiến dịch đã bắt đầu — <b>luật tính điểm bị đóng băng</b> (ngày bắt đầu, trọng số, chỉ tiêu tuần)
                  để không thay luật giữa cuộc đua. Tên, ngày kết thúc và hạn đăng ký vẫn sửa được.
                </p>
              )}
              <div className="field"><label>Tên chiến dịch</label>
                <input value={editCamp.name} onChange={(e) => setEditCamp({ ...editCamp, name: e.target.value })} /></div>
              {editCamp.scope === "class" && (
                <div className="field"><label>Lớp áp dụng (giữ Cmd/Ctrl để chọn nhiều)</label>
                  <select multiple size={Math.min(4, Math.max(2, classes.length))} value={editCamp.class_ids}
                    onChange={(e) => setEditCamp({ ...editCamp, class_ids: Array.from(e.target.selectedOptions).map((o) => o.value) })}>
                    {classes.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                  </select>
                  <p className="mini-note" style={{ marginTop: 4 }}>
                    Bỏ lớp chỉ chặn đăng ký mới — học viên đã ghi danh vẫn ở lại đường đua.
                  </p>
                </div>
              )}
              <div className="two-col">
                <div className="field"><label>Ngày bắt đầu{frozen ? " 🔒" : ""}</label>
                  <DateField value={editCamp.start_date} disabled={frozen}
                    onChange={(v) => setEditCamp({ ...editCamp, start_date: v })} /></div>
                <div className="field"><label>Ngày kết thúc</label>
                  <DateField value={editCamp.end_date}
                    onChange={(v) => setEditCamp({ ...editCamp, end_date: v })} /></div>
              </div>
              <div className="field"><label>Hạn chốt đăng ký kênh (bỏ trống = không giới hạn)</label>
                <DateField value={editCamp.registration_deadline}
                  onChange={(v) => setEditCamp({ ...editCamp, registration_deadline: v })} /></div>
              <div className="field"><label>Chỉ tiêu video tối thiểu mỗi tuần{frozen ? " 🔒" : ""}</label>
                <input type="number" min={0} value={editCamp.weekly_quota} disabled={frozen}
                  onChange={(e) => setEditCamp({ ...editCamp, weekly_quota: e.target.value })} /></div>
              <label style={{ marginBottom: 6 }}>Trọng số điểm{frozen ? " 🔒" : ""}</label>
              {([
                ["follower", "Follower tăng thêm"],
                ["per_1000_views", "Mỗi 1.000 lượt xem"],
                ["new_video", "Mỗi video đăng mới"],
                ["engagement", "Tương tác"],
                ["weekly_bonus", "Chuyên cần (đủ chỉ tiêu tuần)"],
              ] as const).map(([key, label]) => (
                <div className="w-row" key={key}>
                  <span>{label}</span>
                  <input type="number" min={0} value={editCamp.weights[key] ?? "0"} disabled={frozen}
                    onChange={(e) => setEditCamp({ ...editCamp, weights: { ...editCamp.weights, [key]: e.target.value } })} />
                </div>
              ))}
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button className="btn" style={{ width: "auto" }} onClick={saveCampaignEdit}>Lưu thay đổi</button>
                <button className="btn-ghost" onClick={() => setEditCamp(null)}>Hủy</button>
              </div>
            </div>
          </div>
        );
      })()}

      {prizeEdit && (
        <div className="modal-bg" onClick={() => setPrizeEdit(null)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontWeight: 800, color: "var(--navy)", marginBottom: 4 }}>🎁 Cơ cấu giải thưởng</h3>
            <p className="mini-note" style={{ marginBottom: 14 }}>
              {prizeEdit.camp.name} · sửa được cả khi chiến dịch đang chạy, hiển thị ngay trên trang đua
            </p>
            {prizeEdit.rows.map((p, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "110px 1fr auto", gap: 8, marginBottom: 8 }}>
                <input value={p.label} placeholder="Top 1"
                  onChange={(e) => setPrizeEdit({ ...prizeEdit, rows: prizeEdit.rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                <input value={p.reward} placeholder="Phần thưởng"
                  onChange={(e) => setPrizeEdit({ ...prizeEdit, rows: prizeEdit.rows.map((x, j) => (j === i ? { ...x, reward: e.target.value } : x)) })} />
                <button className="btn-ghost btn-sm" onClick={() => setPrizeEdit({ ...prizeEdit, rows: prizeEdit.rows.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn-ghost btn-sm" onClick={() => setPrizeEdit({ ...prizeEdit, rows: [...prizeEdit.rows, { label: `Top ${prizeEdit.rows.length + 1}`, reward: "" }] })}>
                + Thêm giải
              </button>
              <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={savePrizes}>Lưu giải thưởng</button>
            </div>
          </div>
        </div>
      )}

      {profile && (
        <div className="modal-bg" onClick={() => setProfile(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontWeight: 800, color: "var(--navy)", marginBottom: 4 }}>
              {profile.student.full_name} · <span style={{ color: "var(--orange)" }}>{profile.student.public_id}</span>
            </h3>
            <p className="mini-note" style={{ marginBottom: 14 }}>
              SĐT: {profile.student.phone} · Lớp: {profile.student.classes?.name ?? "—"} ·{" "}
              {profile.student.status === "locked" ? "🔒 Đang bị khóa" : "Đang hoạt động"}
              <button className="btn-ghost btn-sm btn-danger" style={{ marginLeft: 10 }} onClick={toggleLock}>
                {profile.student.status === "locked" ? "Mở khóa" : "Khóa học viên"}
              </button>
              <button className="btn-ghost btn-sm btn-danger" style={{ marginLeft: 6 }} onClick={deleteStudent}>
                🗑 Xóa hồ sơ
              </button>
            </p>

            <h4 style={{ fontWeight: 800, fontSize: 13, color: "var(--navy)", margin: "10px 0 8px" }}>Kênh</h4>
            {profile.channels.map((c: any) => (
              <div className="chan" key={c.id}>
                <div className="u">
                  <b>{c.platform} · @{c.username}</b>
                  <span>
                    {c.latest
                      ? `${c.latest.followers != null ? fmt(c.latest.followers) : "—"} follower · ${c.latest.total_views != null ? fmt(Number(c.latest.total_views)) : "—"} view · ${c.latest.videos_count != null ? fmt(c.latest.videos_count) : "—"} video (${String(c.latest.snapshot_date).split("-").reverse().join("/")})`
                      : "chưa quét lần nào"}
                    {" · "}Baseline: {c.baseline_followers != null ? fmt(c.baseline_followers) : "—"} fl / {c.baseline_views != null ? fmt(Number(c.baseline_views)) : "—"} view
                  </span>
                </div>
                {c.status === "verified" ? <span className="st st-ok">Đã xác minh</span>
                  : c.status === "flagged" ? <span className="st st-flag">Gắn cờ</span>
                  : c.status === "removed" ? <span className="st" style={{ color: "#8a94a6", borderColor: "#8a94a6" }}>Đã gỡ</span>
                  : <span className="st st-wait">Chờ xác minh</span>}
                {c.status === "removed" ? (
                  <button className="btn-ghost btn-sm" onClick={() => restoreChannel(c.id)}>Khôi phục</button>
                ) : (
                  <>
                    {c.status !== "verified" && (
                      <button className="btn-ghost btn-sm" onClick={() => verifyChannel(c.id)}>Xác minh tay</button>
                    )}
                    <button className="btn-ghost btn-sm btn-danger" onClick={() => removeChannel(c.id, c.username)}>Gỡ kênh</button>
                  </>
                )}
              </div>
            ))}

            <h4 style={{ fontWeight: 800, fontSize: 13, color: "var(--navy)", margin: "14px 0 8px" }}>Chiến dịch</h4>
            {profile.participations.map((p: any) => (
              <p key={p.campaign_id} style={{ fontSize: 13, marginBottom: 6 }}>
                {p.campaign_name}: <b>{fmt(p.total_score)} điểm</b> · Hạng {p.rank ?? "—"}
                <button className="btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => adjustScore(p.campaign_id)}>
                  Điều chỉnh điểm
                </button>
              </p>
            ))}

            <h4 style={{ fontWeight: 800, fontSize: 13, color: "var(--navy)", margin: "14px 0 8px" }}>Lịch sử điểm gần nhất</h4>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Ngày</th><th>Chiến dịch</th><th>Chỉ số</th><th>Điểm</th><th>Ghi chú</th></tr></thead>
                <tbody>
                  {profile.score_entries.slice(0, 30).map((e: any, i: number) => (
                    <tr key={i}>
                      <td>{dmy(e.entry_date)}</td>
                      <td>{e.campaign_name}</td>
                      <td>{METRIC_LABEL[e.metric] ?? e.metric}</td>
                      <td><b>{e.points.toLocaleString("vi-VN")}</b></td>
                      <td>{e.note ?? "—"}</td>
                    </tr>
                  ))}
                  {!profile.score_entries.length && <tr><td colSpan={5}>Chưa có điểm.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {toastNode}
    </>
  );
}
