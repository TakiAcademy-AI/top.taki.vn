"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Lane, LBRow, METRIC_LABEL, PF_ICON, ProfileModal, SiteHeader, useToast } from "@/components/ui";
import { GoogleButton } from "@/components/google-button";

type Me = {
  student: { public_id: string; full_name: string; class_name: string | null; email: string | null; email_verified: boolean };
  channels: { id: string; platform: string; username: string; url: string; status: string; created_at: string; has_token?: boolean; fb_page_id?: string | null }[];
  stats: {
    followers7: number; views7: number; videos7: number;
    followers7prev: number; views7prev: number;
    latestByChannel: Record<string, { followers: number | null; total_views: number | null; videos_count: number | null; snapshot_date: string } | null>;
  };
  participations: {
    campaign_id: string; campaign_name: string; campaign_status: string;
    end_date: string; weekly_quota: number;
    total_score: number; rank: number | null; prev_rank: number | null; updated_on: string | null;
  }[];
};

type HistoryEntry = {
  entry_date: string; metric: string; raw_value: number | null; weight: number | null;
  points: number; note: string | null; manual: boolean; channel: string | null;
};

const fmt = (n: number) => Math.round(n).toLocaleString("vi-VN");

function pctLabel(cur: number, prev: number): { text: string; cls: string } | null {
  if (prev <= 0) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct >= 0) return { text: `▲ ${pct}% so với tuần trước`, cls: "up" };
  return { text: `▼ ${-pct}% so với tuần trước`, cls: "down" };
}

export default function DashboardPage() {
  const router = useRouter();
  const { toast, toastNode } = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<LBRow[]>([]);
  const [qr, setQr] = useState("");
  const [campIdx, setCampIdx] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [newChan, setNewChan] = useState({ platform: "tiktok", url: "" });
  const [platforms, setPlatforms] = useState<{ value: string; label: string }[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [detailRows, setDetailRows] = useState<any[] | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [tokenFor, setTokenFor] = useState<string | null>(null);         // kênh đang mở ô nhập token
  const [tokenForm, setTokenForm] = useState({ page_id: "", token: "" });
  const [savingToken, setSavingToken] = useState(false);

  async function saveFbToken(channelId: string) {
    if (!tokenForm.token.trim()) { toast("Dán token vào đã nhé"); return; }
    setSavingToken(true);
    toast("Đang kiểm tra token với Facebook…");
    try {
      const r = await fetch("/api/me/fb-token", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channelId, page_id: tokenForm.page_id.trim(), token: tokenForm.token.trim() }),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        const p = d.preview;
        toast(`✅ Kết nối thành công! ${fmt(p.followers ?? 0)} follower · ${p.reels} reel · ${fmt(p.total_reel_views)} view · ${fmt(p.engagement ?? 0)} tương tác`);
        setTokenFor(null); setTokenForm({ page_id: "", token: "" }); load();
      } else toast(d.error ?? "Token không dùng được");
    } finally { setSavingToken(false); }
  }

  async function removeFbToken(channelId: string) {
    if (!confirm("Gỡ kết nối Facebook? Kênh sẽ quay lại cách đếm cũ (có thể thiếu/sai hơn).")) return;
    const r = await fetch("/api/me/fb-token", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel_id: channelId }),
    });
    if (r.ok) { toast("Đã gỡ kết nối"); load(); }
  }

  async function linkGoogle(credential: string) {
    const r = await fetch("/api/me/google", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { toast(`✅ Đã liên kết Google (${d.email}). Từ nay đăng nhập bằng Google được.`); load(); }
    else toast(d.error ?? "Không liên kết được Google");
  }

  async function selfVerify(channelId: string) {
    setVerifyingId(channelId);
    toast("Đang quét kênh của bạn…");
    try {
      const r = await fetch("/api/me/verify-channel", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channelId }),
      });
      const d = await r.json();
      if (d.status === "verified") { toast("✅ Đã xác minh kênh! Bắt đầu tính điểm từ hôm nay."); load(); }
      else toast(d.message ?? d.error ?? "Chưa xác minh được, thử lại sau.");
    } finally {
      setVerifyingId(null);
    }
  }

  useEffect(() => {
    fetch("/api/platforms").then((r) => r.json()).then((d) => {
      const list = d.platforms ?? [];
      setPlatforms(list);
      if (list.length) setNewChan((n) => ({ ...n, platform: list[0].value }));
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const r = await fetch("/api/me");
    if (!r.ok) { router.replace("/"); return; }
    const d: Me = await r.json();
    setMe(d);
    QRCode.toDataURL(d.student.public_id, { margin: 0, width: 96 }).then(setQr).catch(() => {});
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const part = me?.participations[campIdx] ?? me?.participations[0] ?? null;

  useEffect(() => {
    if (!part) return;
    fetch(`/api/leaderboard?campaign_id=${part.campaign_id}`)
      .then((r) => r.json())
      .then((d) => setRows(d.rows ?? []));
  }, [part?.campaign_id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openHistory() {
    if (!part) return;
    const r = await fetch(`/api/me/score-history?campaign_id=${part.campaign_id}`);
    const d = await r.json();
    setHistory(d.entries ?? []);
  }

  async function reloadRows(campaignId?: string) {
    if (!campaignId) return;
    const d = await fetch(`/api/leaderboard?campaign_id=${campaignId}`).then((r) => r.json()).catch(() => null);
    if (d) setRows(d.rows ?? []);
  }

  // Kênh đã xác minh đang được tính điểm: đổi/gỡ sẽ xóa điểm của kênh đó -> phải hỏi lại cho rõ
  const editingVerified = !!editId && me?.channels.find((c) => c.id === editId)?.status === "verified";

  async function saveChannel() {
    if (editingVerified && !confirm(
      "Đổi sang kênh khác?\n\nKênh mới phải xác minh lại từ đầu, còn ĐIỂM CỦA KÊNH CŨ trong các chiến dịch đang chạy sẽ bị xóa và không khôi phục được."
    )) return;
    const r = editId
      ? await fetch(`/api/channels/${editId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newChan) })
      : await fetch("/api/channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newChan) });
    const d = await r.json();
    if (r.ok) {
      toast(
        !editId ? "Đã thêm kênh. Hệ thống sẽ tự xác minh ở lượt quét kế tiếp (hoặc bấm Xác minh ngay)."
        : d.replaced ? "Đã đổi kênh. Kênh mới đang chờ xác minh — bấm Xác minh ngay để tính điểm."
        : d.identity_changed ? "Đã sửa kênh. Hệ thống sẽ tự xác minh, hoặc bấm Xác minh ngay."
        : "Đã lưu."
      );
      setShowAdd(false);
      setEditId(null);
      setNewChan({ platform: platforms[0]?.value ?? "tiktok", url: "" });
      load();
      if (d.replaced) reloadRows(part?.campaign_id);
    } else toast(d.error ?? "Không lưu được kênh");
  }

  async function deleteMyChannel(id: string, username: string, status: string) {
    const msg = status === "verified"
      ? `Gỡ kênh @${username}?\n\nKênh đang được tính điểm: toàn bộ ĐIỂM CỦA KÊNH NÀY trong các chiến dịch đang chạy sẽ bị xóa và không khôi phục được.\n(Muốn chuyển sang link khác thì bấm "Đổi kênh" thay vì gỡ.)`
      : `Xóa kênh @${username}?`;
    if (!confirm(msg)) return;
    const r = await fetch(`/api/channels/${id}`, { method: "DELETE" });
    if (r.ok) { toast("Đã xóa kênh"); load(); if (status === "verified") reloadRows(part?.campaign_id); }
    else toast((await r.json().catch(() => ({}))).error ?? "Không xóa được");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
  }

  if (!me) return <><SiteHeader subtitle="TAKI ACADEMY" right={<span>Đang tải…</span>} /><div className="wrap"><p className="mini-note">Đang tải dữ liệu…</p></div></>;

  const max = rows[0]?.total_score ?? 0;
  const myRow = rows.find((r) => r.public_id === me.student.public_id);
  const others = rows.filter((r) => r.public_id !== me.student.public_id).slice(0, 9);
  // Tổng số hiện tại từ snapshot mới nhất của các kênh (thay cho "tăng 7 ngày" vì hệ thống còn mới)
  const chStats = Object.values(me.stats.latestByChannel) as ({ followers: number | null; total_views: number | null; videos_count: number | null } | null)[];
  const totF = chStats.reduce((s, x) => s + (x?.followers ?? 0), 0);
  const totV = chStats.reduce((s, x) => s + (x?.total_views ?? 0), 0);
  const totVid = chStats.reduce((s, x) => s + (x?.videos_count ?? 0), 0);

  return (
    <>
      <SiteHeader
        subtitle="TAKI ACADEMY"
        right={<><span>{me.student.full_name} · {me.student.public_id}</span><button onClick={logout}>Thoát</button></>}
      />
      <div className="wrap">
        <div className="grid grid-2">
          <div>
            <div className="id-card">
              <div className="top">
                <div className="brand">TAKI ACADEMY · THẺ ĐUA TOP</div>
                <div className="qr">{qr ? <img src={qr} alt="QR check-in" /> : <>QR<br />CHECK-IN</>}</div>
              </div>
              <h2>{me.student.full_name}</h2>
              <div className="code">{me.student.public_id}</div>
              <div className="row">
                <div><b>{me.student.class_name ?? "—"}</b><span>Lớp học</span></div>
                <div><b>{part?.rank ? `Hạng ${part.rank}` : "—"}</b><span>Vị trí hiện tại</span></div>
                <div><b>{part ? `${fmt(part.total_score)} đ` : "—"}</b><span>Tổng điểm</span></div>
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <h3>
                📡 Kênh của tôi
                <button className="btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => setShowAdd(true)}>+ Thêm</button>
              </h3>
              {me.channels.map((c) => {
                const pf = PF_ICON[c.platform] ?? PF_ICON.tiktok;
                const snap = me.stats.latestByChannel[c.id];
                const statParts = snap
                  ? [
                      snap.followers != null ? `${fmt(snap.followers)} follower` : null,
                      snap.total_views != null ? `${fmt(snap.total_views)} view` : null,
                      snap.videos_count != null ? `${fmt(snap.videos_count)} video` : null,
                    ].filter(Boolean).join(" · ")
                  : "chờ quét lần đầu";
                return (
                  <Fragment key={c.id}>
                  <div className="chan">
                    <div className={`pf ${pf.cls}`}>{pf.icon}</div>
                    <div className="u">
                      <b>@{c.username}</b>
                      <span>{pf.label} · {statParts}</span>
                    </div>
                    {c.status === "verified" && <span className="st st-ok">Đã xác minh</span>}
                    {c.status === "flagged" && <span className="st st-flag">Bị gắn cờ</span>}
                    {c.status === "pending" && <span className="st st-wait">Chờ xác minh</span>}
                    {c.status === "flagged" ? (
                      <p className="mini-note" style={{ flexBasis: "100%", margin: 0 }}>
                        Kênh đang được trợ giảng kiểm tra — liên hệ trợ giảng nếu cần sửa hoặc gỡ.
                      </p>
                    ) : (
                      <div className="chan-acts">
                        {c.status === "pending" && (
                          <button className="btn-ghost btn-sm" disabled={verifyingId === c.id} onClick={() => selfVerify(c.id)}>
                            {verifyingId === c.id ? "Đang quét…" : "Xác minh ngay"}
                          </button>
                        )}
                        <button className="btn-ghost btn-sm" title={c.status === "verified" ? "Đổi sang link kênh khác" : "Sửa link kênh"}
                          onClick={() => { setEditId(c.id); setNewChan({ platform: c.platform, url: c.url ?? "" }); setShowAdd(true); }}>
                          {c.status === "verified" ? "Đổi kênh" : "Sửa"}
                        </button>
                        <button className="btn-ghost btn-sm btn-danger" title={c.status === "verified" ? "Gỡ kênh" : "Xóa kênh"}
                          style={{ marginLeft: "auto" }} onClick={() => deleteMyChannel(c.id, c.username, c.status)}>
                          {c.status === "verified" ? "Gỡ kênh" : "✕"}
                        </button>
                      </div>
                    )}
                  </div>
                  {c.platform === "facebook" && (
                    <div className="fb-connect">
                      {c.has_token ? (
                        <div className="fb-connected">
                          <span>🟢 <b>Đã kết nối Facebook</b> — số liệu lấy chính xác qua Graph API</span>
                          <button className="btn-ghost btn-sm" onClick={() => removeFbToken(c.id)}>Gỡ</button>
                        </div>
                      ) : tokenFor === c.id ? (
                        <div className="fb-form">
                          <p className="mini-note" style={{ margin: "0 0 6px" }}>
                            Dán <b>Page access token</b> (và Page ID nếu có) để hệ thống đọc đúng số như trong Trang chuyên nghiệp của bạn.
                          </p>
                          <input className="inp" placeholder="Page ID (không bắt buộc)" value={tokenForm.page_id}
                            onChange={(e) => setTokenForm((f) => ({ ...f, page_id: e.target.value }))} />
                          <input className="inp" placeholder="Dán token vào đây" value={tokenForm.token}
                            onChange={(e) => setTokenForm((f) => ({ ...f, token: e.target.value }))} style={{ marginTop: 6 }} />
                          <div className="chan-acts" style={{ marginTop: 6 }}>
                            <button className="btn btn-sm" disabled={savingToken} onClick={() => saveFbToken(c.id)}>
                              {savingToken ? "Đang kiểm tra…" : "Lưu & kiểm tra"}
                            </button>
                            <button className="btn-ghost btn-sm" onClick={() => { setTokenFor(null); setTokenForm({ page_id: "", token: "" }); }}>Hủy</button>
                          </div>
                        </div>
                      ) : (
                        <button className="btn-ghost btn-sm" onClick={() => { setTokenFor(c.id); setTokenForm({ page_id: c.fb_page_id ?? "", token: "" }); }}>
                          🔗 Kết nối Facebook để lấy số chính xác
                        </button>
                      )}
                    </div>
                  )}
                  </Fragment>
                );
              })}
              {me.channels.some((c) => c.status === "pending") && (() => {
                const stale = me.channels.some((c) => {
                  if (c.status !== "pending") return false;
                  const days = (Date.now() - new Date(c.created_at).getTime()) / 86_400_000;
                  return days >= 2;
                });
                return (
                  <div className={stale ? "pending-warn" : undefined} style={stale ? undefined : {}}>
                    {stale && (
                      <p className="mini-note" style={{ color: "var(--red)", fontWeight: 700, marginBottom: 4 }}>
                        ⚠️ Có kênh chờ xác minh đã quá 2 ngày! Kênh chưa xác minh <b>không được tính điểm</b>.
                      </p>
                    )}
                    <p className="mini-note">
                      Kênh sẽ được <b>tự động xác minh</b> khi hệ thống quét (5h30 và 18h30 hằng ngày). Muốn xác minh
                      liền thì bấm <b>“Xác minh ngay”</b>. Không cần chèn mã gì vào bio cả.
                    </p>
                  </div>
                );
              })()}
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <h3>📧 Email đăng nhập</h3>
              {me.student.email && me.student.email_verified ? (
                <p className="mini-note" style={{ margin: 0 }}>
                  <b>{me.student.email}</b> <span className="st st-ok" style={{ marginLeft: 6 }}>Đã liên kết Google</span>
                  <br />Bạn có thể đăng nhập bằng nút Google với email này.
                </p>
              ) : (
                <>
                  <p className="mini-note" style={{ marginTop: 0 }}>
                    {me.student.email ? <>Email đã khai: <b>{me.student.email}</b> (chưa xác minh). </> : "Chưa có email trong hồ sơ. "}
                    Liên kết Google để đăng nhập nhanh, khỏi nhập số điện thoại.
                  </p>
                  <div style={{ marginTop: 10 }}>
                    <GoogleButton text="continue_with" onCredential={linkGoogle} />
                  </div>
                </>
              )}
            </div>

            <div className="grid grid-3" style={{ marginTop: 16 }}>
              <div className="stat">
                <b>{fmt(totF)}</b><span>Tổng follower</span>
              </div>
              <div className="stat">
                <b>{fmt(totV)}</b><span>Tổng lượt xem</span>
              </div>
              <div className="stat">
                <b>{fmt(totVid)}</b><span>Số video (reel)</span>
              </div>
            </div>
          </div>

          <div className="card">
            <h3>
              🏁 Đường đua{part ? ` · ${part.campaign_name}` : ""}
              {me.participations.length > 1 && (
                <select
                  style={{ maxWidth: 220, marginLeft: "auto" }}
                  value={campIdx}
                  onChange={(e) => setCampIdx(Number(e.target.value))}
                >
                  {me.participations.map((p, i) => <option key={p.campaign_id} value={i}>{p.campaign_name}</option>)}
                </select>
              )}
            </h3>
            {rows.length ? (
              <div>
                {others.map((r) => <Lane key={r.student_id} row={r} max={max} onClick={() => setProfileId(r.public_id)} />)}
                {myRow && <Lane row={{ ...myRow }} max={max} me onClick={() => setProfileId(myRow.public_id)} />}
              </div>
            ) : (
              <p className="mini-note">Chưa có điểm — bảng xếp hạng xuất hiện sau chu kỳ tính điểm đầu tiên.</p>
            )}
            <p className="mini-note" style={{ marginTop: 12 }}>
              Điểm cập nhật tự động lúc 5h30 và 18h30 hằng ngày từ dữ liệu kênh thật.
              {part?.updated_on ? ` Cập nhật gần nhất: ngày ${part.updated_on.split("-").reverse().join("/")}.` : ""}
              {" "}Bấm vào từng học viên để xem hồ sơ kênh.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button className="btn-ghost btn-sm" onClick={openHistory}>Lịch sử cộng điểm của tôi</button>
              <button
                className="btn-ghost btn-sm"
                onClick={async () => {
                  if (!part) return;
                  const r = await fetch(`/api/leaderboard?campaign_id=${part.campaign_id}&detail=1`);
                  const d = await r.json();
                  setDetailRows(d.rows ?? []);
                }}
              >
                Bảng điểm chi tiết
              </button>
            </div>
          </div>
        </div>
      </div>

      {showAdd && (
        <div className="modal-bg" onClick={() => { setShowAdd(false); setEditId(null); }}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontWeight: 800, color: "var(--navy)", marginBottom: 14 }}>
              {editingVerified ? "Đổi kênh" : editId ? "Sửa kênh" : "Thêm kênh mới"}
            </h3>
            {editingVerified && (
              <p className="mini-note" style={{ color: "var(--red)", fontWeight: 700, marginBottom: 12 }}>
                ⚠️ Kênh này đã xác minh và đang tính điểm. Đổi sang kênh khác = đăng ký kênh mới: phải xác minh lại,
                điểm của kênh cũ trong các chiến dịch đang chạy sẽ bị xóa.
              </p>
            )}
            <div className="field">
              <label>Nền tảng</label>
              <select value={newChan.platform} onChange={(e) => setNewChan({ ...newChan, platform: e.target.value })}>
                {platforms.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Link kênh</label>
              <input value={newChan.url} onChange={(e) => setNewChan({ ...newChan, url: e.target.value })} placeholder="Dán link kênh" />
            </div>
            <button className="btn" onClick={saveChannel}>{editingVerified ? "Đổi kênh" : editId ? "Lưu thay đổi" : "Thêm kênh"}</button>
          </div>
        </div>
      )}

      {profileId && <ProfileModal publicId={profileId} onClose={() => setProfileId(null)} />}

      {detailRows && (
        <div className="modal-bg" onClick={() => setDetailRows(null)}>
          <div className="modal" style={{ maxWidth: 860 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontWeight: 800, color: "var(--navy)", marginBottom: 14 }}>
              Bảng điểm chi tiết · {part?.campaign_name}
            </h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Hạng</th><th>Học viên</th><th>Follower kênh</th><th>View kênh</th>
                    <th>Đ.Follower</th><th>Đ.Lượt xem</th><th>Đ.Video</th>
                    <th>Đ.Tương tác</th><th>Chuyên cần</th><th>Hôm nay</th><th>Tổng</th>
                  </tr>
                </thead>
                <tbody>
                  {detailRows.map((r: any) => (
                    <tr key={r.student_id} style={r.public_id === me.student.public_id ? { background: "var(--orange-soft)" } : undefined}>
                      <td><b>{r.rank ?? "—"}</b></td>
                      <td>{r.name} <span className="mini-note">{r.public_id}</span></td>
                      <td><b>{fmt(r.channel_followers ?? 0)}</b></td>
                      <td><b>{fmt(r.channel_views ?? 0)}</b></td>
                      <td>{fmt(r.breakdown?.follower ?? 0)}</td>
                      <td>{fmt(r.breakdown?.views ?? 0)}</td>
                      <td>{fmt(r.breakdown?.new_video ?? 0)}</td>
                      <td>{fmt(r.breakdown?.engagement ?? 0)}</td>
                      <td>{fmt(r.breakdown?.weekly_bonus ?? 0)}</td>
                      <td className={r.today_points > 0 ? "up" : ""}>{r.today_points > 0 ? `+${fmt(r.today_points)}` : "—"}</td>
                      <td><b>{fmt(r.total_score)}</b></td>
                    </tr>
                  ))}
                  {!detailRows.length && <tr><td colSpan={11}>Chưa có dữ liệu điểm.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {history && (
        <div className="modal-bg" onClick={() => setHistory(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontWeight: 800, color: "var(--navy)", marginBottom: 14 }}>
              Lịch sử cộng điểm · {part?.campaign_name}
            </h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Ngày</th><th>Kênh</th><th>Chỉ số</th><th>Giá trị</th><th>Trọng số</th><th>Điểm</th></tr>
                </thead>
                <tbody>
                  {history.map((e, i) => (
                    <tr key={i}>
                      <td>{e.entry_date.split("-").reverse().join("/")}</td>
                      <td>{e.channel ?? "—"}</td>
                      <td>{METRIC_LABEL[e.metric] ?? e.metric}{e.manual && e.note ? ` (${e.note})` : ""}</td>
                      <td>{e.raw_value != null ? fmt(e.raw_value) : "—"}</td>
                      <td>{e.weight ?? "—"}</td>
                      <td><b>{e.points.toLocaleString("vi-VN")}</b></td>
                    </tr>
                  ))}
                  {!history.length && <tr><td colSpan={6}>Chưa có dòng cộng điểm nào.</td></tr>}
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
