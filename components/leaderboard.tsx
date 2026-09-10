"use client";

import { Fragment, useEffect, useState } from "react";
import { PF_ICON, initials } from "@/components/ui";

/* ==== BXH kiểu dashboard: thẻ thống kê + podium + bảng đầy đủ có mở rộng kênh ==== */

export type LBChannel = {
  platform: string; username: string; url: string;
  followers: number | null; views: number | null; videos: number | null; engagement: number | null;
};

export type LBDetailRow = {
  student_id: string; rank: number | null; prev_rank: number | null;
  name: string; public_id: string; class_name: string | null;
  total_score: number; today_points: number; verified_channels: number;
  channel_followers: number; channel_views: number; channel_engagement: number;
  follower_growth_pct: number | null;
  channels: LBChannel[];
};

const fmt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("vi-VN"));
const compact = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}Tr`;
  if (n >= 1_000) return `${(n / 1_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}K`;
  return fmt(n);
};

function rankDelta(r: LBDetailRow): { text: string; cls: string } {
  if (r.prev_rank == null || r.rank == null || r.prev_rank === r.rank) return { text: "", cls: "" };
  const d = r.prev_rank - r.rank;
  return d > 0 ? { text: `▲${d}`, cls: "up" } : { text: `▼${-d}`, cls: "down" };
}

/* Thẻ thống kê tổng của đường đua */
export function LBStats({ rows, updated }: { rows: LBDetailRow[]; updated: string | null }) {
  const sum = (f: (r: LBDetailRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const cards = [
    { icon: "👥", label: "Học viên đang đua", value: fmt(rows.length), note: `${fmt(sum((r) => r.verified_channels))} kênh đã xác minh` },
    { icon: "❤️", label: "Tổng follower", value: compact(sum((r) => r.channel_followers)), note: "cộng mọi kênh đang đua" },
    { icon: "▶️", label: "Tổng lượt xem", value: compact(sum((r) => r.channel_views)), note: "cộng mọi kênh đang đua" },
    { icon: "⚡", label: "Tổng tương tác", value: compact(sum((r) => r.channel_engagement)), note: updated ? `cập nhật ${updated.split("-").reverse().join("/")}` : "chưa có dữ liệu" },
  ];
  return (
    <div className="lb-stats">
      {cards.map((c) => (
        <div className="lb-stat" key={c.label}>
          <div className="ic">{c.icon}</div>
          <div>
            <b>{c.value}</b>
            <span>{c.label}</span>
            <em>{c.note}</em>
          </div>
        </div>
      ))}
    </div>
  );
}

/* Podium top 3 kiểu mockup — #1 giữa có vương miện */
export function LBPodium({ rows, onOpen }: { rows: LBDetailRow[]; onOpen: (id: string) => void }) {
  const byRank = (n: number) => rows.find((r) => r.rank === n);
  const slot = (r: LBDetailRow | undefined, cls: string, medal: string) => {
    if (!r) return <div className="pd-card empty" />;
    return (
      <div className={`pd-card ${cls}`} onClick={() => onOpen(r.public_id)}>
        {cls === "pd-1" && <div className="crown">👑</div>}
        <div className="medal">{medal}</div>
        <div className="pd-ava">{initials(r.name)}</div>
        <b className="pd-name">{r.name}</b>
        <span className="pd-class">{r.class_name ?? "—"}</span>
        <div className="pd-nums">
          <div><b>{fmt(r.total_score)}</b><span>điểm</span></div>
          <div><b>{compact(r.channel_followers)}</b><span>follower</span></div>
          <div><b>{compact(r.channel_engagement)}</b><span>tương tác</span></div>
        </div>
      </div>
    );
  };
  if (!rows.length) return null;
  return (
    <div className="pd-row">
      {slot(byRank(2), "pd-2", "🥈")}
      {slot(byRank(1), "pd-1", "🥇")}
      {slot(byRank(3), "pd-3", "🥉")}
    </div>
  );
}

/* Bảng xếp hạng đầy đủ — bấm hàng để xổ danh sách kênh kèm link */
export function LBTable({ rows, onOpen }: { rows: LBDetailRow[]; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="table-scroll">
      <table className="lb-table">
        <thead>
          <tr>
            <th style={{ width: 44 }}>Hạng</th>
            <th>Học viên</th>
            <th className="num">Điểm</th>
            <th className="num">Follower</th>
            <th className="num">Lượt xem</th>
            <th className="num">Tương tác</th>
            <th className="num">Biến động</th>
            <th style={{ width: 30 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = rankDelta(r);
            const isOpen = open === r.student_id;
            const medal = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : null;
            return (
              <Fragment key={r.student_id}>
                <tr className={`lb-row${isOpen ? " on" : ""}`} onClick={() => setOpen(isOpen ? null : r.student_id)}>
                  <td className="rk">{medal ?? r.rank ?? "—"}</td>
                  <td>
                    <div className="who">
                      <div className="ava">{initials(r.name)}</div>
                      <div>
                        <b className="nm" onClick={(e) => { e.stopPropagation(); onOpen(r.public_id); }}>{r.name}</b>
                        <span>{r.class_name ?? "—"} · {r.verified_channels} kênh</span>
                      </div>
                    </div>
                  </td>
                  <td className="num pts">{fmt(r.total_score)}{r.today_points > 0 && <em>+{fmt(r.today_points)} hôm nay</em>}</td>
                  <td className="num">{compact(r.channel_followers)}</td>
                  <td className="num">{compact(r.channel_views)}</td>
                  <td className="num">{compact(r.channel_engagement)}</td>
                  <td className="num">
                    {r.follower_growth_pct != null && r.follower_growth_pct !== 0 && (
                      <span className={r.follower_growth_pct > 0 ? "up" : "down"}>
                        {r.follower_growth_pct > 0 ? "↗" : "↘"} {Math.abs(r.follower_growth_pct)}%
                      </span>
                    )}
                    {d.text && <span className={`delta ${d.cls}`} style={{ marginLeft: 6 }}>{d.text}</span>}
                    {r.follower_growth_pct == null && !d.text && "—"}
                  </td>
                  <td className="chev">{isOpen ? "▴" : "▾"}</td>
                </tr>
                {isOpen && (
                  <tr className="lb-expand">
                    <td colSpan={8}>
                      {r.channels.length ? (
                        <div className="chan-grid">
                          {r.channels.map((c, i) => {
                            const pf = PF_ICON[c.platform] ?? PF_ICON.tiktok;
                            return (
                              <a className="chan-card" key={i} href={c.url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>
                                <div className={`pf ${pf.cls}`}>{pf.icon}</div>
                                <div className="u">
                                  <b>@{c.username} ↗</b>
                                  <span>
                                    {compact(c.followers)} follower · {compact(c.views)} view
                                    {c.videos != null ? ` · ${fmt(c.videos)} video` : ""}
                                    {c.engagement != null ? ` · ${compact(c.engagement)} tương tác` : ""}
                                  </span>
                                </div>
                              </a>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="mini-note">Chưa có kênh nào được xác minh.</p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* Khối BXH hoàn chỉnh — tự fetch theo campaign_id */
export function LeaderboardBoard({ campaignId, onOpenProfile }: { campaignId: string; onOpenProfile: (id: string) => void }) {
  const [rows, setRows] = useState<LBDetailRow[] | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/leaderboard?campaign_id=${campaignId}&detail=1`)
      .then((r) => r.json())
      .then((d) => { setRows(d.rows ?? []); setUpdated(d.last_entry_date ?? null); })
      .catch(() => setRows([]));
  }, [campaignId]);

  if (rows === null) return <p className="mini-note">Đang tải bảng xếp hạng…</p>;
  if (!rows.length) return <p className="mini-note">Chưa có ai trên bảng xếp hạng — điểm xuất hiện sau chu kỳ tính điểm đầu tiên (cập nhật mỗi 30 phút).</p>;

  return (
    <>
      <LBStats rows={rows} updated={updated} />
      <LBPodium rows={rows} onOpen={onOpenProfile} />
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="lb-head">
          <h3 style={{ margin: 0 }}>📊 Bảng xếp hạng toàn bộ học viên</h3>
          <span className="mini-note">bấm vào hàng để xem danh sách kênh · bấm tên xem hồ sơ</span>
        </div>
        <LBTable rows={rows} onOpen={onOpenProfile} />
      </div>
    </>
  );
}
