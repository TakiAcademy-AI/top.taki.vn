"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Lane, LBRow, METRIC_LABEL, PF_ICON, ProfileModal, SiteHeader, useToast } from "@/components/ui";

type Me = {
  student: { public_id: string; full_name: string; class_name: string | null };
  channels: { id: string; platform: string; username: string; status: string; created_at: string }[];
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
  const [newChan, setNewChan] = useState({ platform: "tiktok", url: "" });
  const [profileId, setProfileId] = useState<string | null>(null);
  const [detailRows, setDetailRows] = useState<any[] | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

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

  async function addChannel() {
    const r = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newChan),
    });
    const d = await r.json();
    if (r.ok) {
      toast("Đã thêm kênh. Gắn mã ID vào bio để xác minh trong 48 giờ.");
      setShowAdd(false);
      setNewChan({ platform: "tiktok", url: "" });
      load();
    } else toast(d.error ?? "Không thêm được kênh");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
  }

  if (!me) return <><SiteHeader subtitle="TAKI ACADEMY" right={<span>Đang tải…</span>} /><div className="wrap"><p className="mini-note">Đang tải dữ liệu…</p></div></>;

  const max = rows[0]?.total_score ?? 0;
  const myRow = rows.find((r) => r.public_id === me.student.public_id);
  const others = rows.filter((r) => r.public_id !== me.student.public_id).slice(0, 9);
  const fTrend = pctLabel(me.stats.followers7, me.stats.followers7prev);
  const vTrend = pctLabel(me.stats.views7, me.stats.views7prev);
  const quota = part?.weekly_quota ?? 0;
  const vidLack = quota > 0 && me.stats.videos7 < quota;

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
                  <div className="chan" key={c.id}>
                    <div className={`pf ${pf.cls}`}>{pf.icon}</div>
                    <div className="u">
                      <b>@{c.username}</b>
                      <span>{pf.label} · {statParts}</span>
                    </div>
                    {c.status === "verified" && <span className="st st-ok">Đã xác minh</span>}
                    {c.status === "flagged" && <span className="st st-flag">Bị gắn cờ</span>}
                    {c.status === "pending" && (
                      <>
                        <span className="st st-wait">Chờ xác minh</span>
                        <button
                          className="btn-ghost btn-sm"
                          disabled={verifyingId === c.id}
                          onClick={() => selfVerify(c.id)}
                        >
                          {verifyingId === c.id ? "Đang quét…" : "Xác minh ngay"}
                        </button>
                      </>
                    )}
                  </div>
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
                      Cách xác minh: chèn mã <b>{me.student.public_id}</b> vào bio/mô tả kênh, rồi bấm{" "}
                      <b>“Xác minh ngay”</b> (hoặc chờ hệ thống tự quét lúc 5:30 sáng).
                    </p>
                  </div>
                );
              })()}
            </div>

            <div className="grid grid-3" style={{ marginTop: 16 }}>
              <div className="stat">
                <b>+{fmt(me.stats.followers7)}</b><span>Follower tăng 7 ngày</span>
                {fTrend && <span className={`tr ${fTrend.cls}`}>{fTrend.text}</span>}
              </div>
              <div className="stat">
                <b>{fmt(me.stats.views7)}</b><span>Lượt xem 7 ngày</span>
                {vTrend && <span className={`tr ${vTrend.cls}`}>{vTrend.text}</span>}
              </div>
              <div className="stat">
                <b>{fmt(me.stats.videos7)}</b><span>Video đã đăng 7 ngày</span>
                {vidLack && <span className="tr down">▼ thiếu {quota - me.stats.videos7} so với chỉ tiêu</span>}
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
              Điểm cập nhật 6:00 sáng mỗi ngày từ dữ liệu kênh thật.
              {part?.updated_on ? ` Cập nhật gần nhất: 06:00 ngày ${part.updated_on.split("-").reverse().join("/")}.` : ""}
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
        <div className="modal-bg" onClick={() => setShowAdd(false)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontWeight: 800, color: "var(--navy)", marginBottom: 14 }}>Thêm kênh mới</h3>
            <div className="field">
              <label>Nền tảng</label>
              <select value={newChan.platform} onChange={(e) => setNewChan({ ...newChan, platform: e.target.value })}>
                <option value="tiktok">TikTok</option>
                <option value="youtube">YouTube</option>
                <option value="facebook">Facebook</option>
                <option value="instagram">Instagram</option>
              </select>
            </div>
            <div className="field">
              <label>Link kênh</label>
              <input value={newChan.url} onChange={(e) => setNewChan({ ...newChan, url: e.target.value })} placeholder="Dán link kênh" />
            </div>
            <button className="btn" onClick={addChannel}>Thêm kênh</button>
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
