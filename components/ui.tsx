"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ==== Toast ==== */
export function useToast() {
  const [msg, setMsg] = useState("");
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const toast = useCallback((m: string) => {
    setMsg(m);
    setShow(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 2800);
  }, []);
  const node = <div className={`toast${show ? " show" : ""}`}>{msg}</div>;
  return { toast, toastNode: node };
}

/* ==== Header ==== */
export function SiteHeader({ subtitle, right }: { subtitle: string; right?: React.ReactNode }) {
  return (
    <header className="site-header">
      <div className="logo">
        <div className="flag">🏁</div>
        <div>
          ĐUA TOP XÂY KÊNH<small>{subtitle}</small>
        </div>
      </div>
      <div className="hd-user">{right}</div>
    </header>
  );
}

/* ==== Đồng hồ đếm ngược realtime ==== */
export function Countdown({ endDate }: { endDate: string }) {
  const [left, setLeft] = useState<{ d: number; h: number; m: number } | null>(null);
  useEffect(() => {
    const target = new Date(`${endDate}T23:59:59+07:00`).getTime();
    const tick = () => {
      const ms = Math.max(0, target - Date.now());
      setLeft({
        d: Math.floor(ms / 86_400_000),
        h: Math.floor((ms % 86_400_000) / 3_600_000),
        m: Math.floor((ms % 3_600_000) / 60_000),
      });
    };
    tick();
    const iv = setInterval(tick, 30_000);
    return () => clearInterval(iv);
  }, [endDate]);
  if (!left) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <div className="countdown">
      <div><b>{pad(left.d)}</b><span>ngày</span></div>
      <div><b>{pad(left.h)}</b><span>giờ</span></div>
      <div><b>{pad(left.m)}</b><span>phút</span></div>
    </div>
  );
}

/* ==== Bảng xếp hạng ==== */
export type LBRow = {
  student_id: string;
  rank: number | null;
  prev_rank: number | null;
  name: string;
  public_id: string;
  total_score: number;
};

export function initials(name: string): string {
  return name.split(" ").filter(Boolean).map((t) => t[0]).slice(-2).join("").toUpperCase();
}

export function deltaOf(row: LBRow): { text: string; cls: string } {
  if (row.prev_rank == null || row.rank == null || row.prev_rank === row.rank) return { text: "—", cls: "" };
  const d = row.prev_rank - row.rank;
  return d > 0 ? { text: `▲ ${d}`, cls: "up" } : { text: `▼ ${-d}`, cls: "down" };
}

export function Lane({ row, max, me, onClick }: { row: LBRow; max: number; me?: boolean; onClick?: () => void }) {
  const w = max > 0 ? Math.max(2, Math.round((row.total_score / max) * 100)) : 2;
  const d = deltaOf(row);
  return (
    <div className={`lane${me ? " me" : ""}`} onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>
      <div className="rk">{row.rank ?? "—"}</div>
      <div className="ava" style={me ? { background: "var(--orange)" } : undefined}>
        {me ? "BẠN" : initials(row.name)}
      </div>
      <div className="info">
        <div className="nm">
          {row.name}
          <span className="id-chip">{row.public_id}</span>
          <span className={`delta ${d.cls}`}>{d.text}</span>
        </div>
        <div className="track"><i style={{ width: `${w}%` }} /></div>
      </div>
      <div className="pts">
        {Math.round(row.total_score).toLocaleString("vi-VN")}
        <span>điểm</span>
      </div>
    </div>
  );
}

export function Podium({ rows }: { rows: LBRow[] }) {
  const [r1, r2, r3] = rows;
  if (!r1) return null;
  const slot = (r: LBRow | undefined, cls: string, label: string) =>
    r ? (
      <div className={`p ${cls}`}>
        <div className="ava">{initials(r.name)}</div>
        <div className="box">
          <div className="rank-num">{label}</div>
          <div className="name">{r.name}</div>
          <div className="pts">{Math.round(r.total_score).toLocaleString("vi-VN")} đ</div>
        </div>
      </div>
    ) : <div className="p" />;
  return (
    <div className="podium">
      {slot(r2, "p2", "HẠNG 2")}
      {slot(r1, "p1", "HẠNG 1")}
      {slot(r3, "p3", "HẠNG 3")}
    </div>
  );
}

export const PF_ICON: Record<string, { cls: string; icon: string; label: string }> = {
  tiktok: { cls: "pf-tiktok", icon: "♪", label: "TikTok" },
  youtube: { cls: "pf-youtube", icon: "▶", label: "YouTube" },
  facebook: { cls: "pf-facebook", icon: "f", label: "Facebook" },
  instagram: { cls: "pf-instagram", icon: "📷", label: "Instagram" },
};

export const METRIC_LABEL: Record<string, string> = {
  follower: "Follower tăng",
  views: "Lượt xem",
  new_video: "Video mới",
  engagement: "Tương tác",
  weekly_bonus: "Thưởng chuyên cần",
  manual_adjust: "Điều chỉnh tay",
};

const fmtN = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("vi-VN"));

/* ==== Hồ sơ công khai (bấm vào học viên trên BXH) — không lộ SĐT ==== */
export type PublicProfile = {
  student: { public_id: string; full_name: string; class_name: string | null; joined_at: string };
  channels: {
    platform: string; username: string; url: string; verified: boolean;
    followers: number | null; total_views: number | null; videos_count: number | null;
  }[];
  participations: {
    campaign_name: string; campaign_status: string; rank: number | null;
    total_score: number; breakdown: Record<string, number>;
  }[];
};

export function ProfileModal({ publicId, onClose }: { publicId: string; onClose: () => void }) {
  const [data, setData] = useState<PublicProfile | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch(`/api/students/profile?public_id=${encodeURIComponent(publicId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "Lỗi");
        setData(await r.json());
      })
      .catch((e) => setErr(e.message));
  }, [publicId]);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        {err && <p className="mini-note">{err}</p>}
        {!data && !err && <p className="mini-note">Đang tải hồ sơ…</p>}
        {data && (
          <>
            <h3 style={{ fontWeight: 800, color: "var(--navy)", marginBottom: 2 }}>
              {data.student.full_name}{" "}
              <span className="id-chip" style={{ fontSize: 11, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 6, padding: "1px 6px", color: "var(--muted)" }}>
                {data.student.public_id}
              </span>
            </h3>
            <p className="mini-note" style={{ marginBottom: 14 }}>
              {data.student.class_name ?? "—"} · Tham gia từ {data.student.joined_at.split("-").reverse().join("/")}
            </p>

            {data.channels.map((c, i) => {
              const pf = PF_ICON[c.platform] ?? PF_ICON.tiktok;
              return (
                <div className="chan" key={i}>
                  <div className={`pf ${pf.cls}`}>{pf.icon}</div>
                  <div className="u">
                    <b>
                      <a href={c.url} target="_blank" rel="noopener" style={{ color: "inherit", textDecoration: "none" }}>
                        @{c.username} <span style={{ color: "var(--orange)", fontSize: 11 }}>↗</span>
                      </a>
                    </b>
                    <span>
                      {pf.label} · {fmtN(c.followers)} follower
                      {c.total_views != null ? ` · ${fmtN(c.total_views)} view` : ""}
                      {c.videos_count != null ? ` · ${fmtN(c.videos_count)} video` : ""}
                    </span>
                  </div>
                  <span className={`st ${c.verified ? "st-ok" : "st-wait"}`}>{c.verified ? "Đã xác minh" : "Chờ xác minh"}</span>
                </div>
              );
            })}

            {data.participations.map((p, i) => (
              <div key={i} style={{ marginTop: 12 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "var(--navy)" }}>
                  🏁 {p.campaign_name}: Hạng {p.rank ?? "—"} · {fmtN(p.total_score)} điểm
                </p>
                <p className="mini-note" style={{ marginBottom: 6 }}>
                  Điểm thành phần theo từng chỉ số (đã nhân trọng số) — không phải số thô trên kênh.
                </p>
                <div className="table-scroll">
                  <table>
                    <tbody>
                      {Object.entries(p.breakdown)
                        .filter(([, v]) => v !== 0)
                        .map(([m, v]) => (
                          <tr key={m}>
                            <td>Điểm {(METRIC_LABEL[m] ?? m).toLowerCase()}</td>
                            <td style={{ textAlign: "right" }}><b>{fmtN(v)} đ</b></td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
