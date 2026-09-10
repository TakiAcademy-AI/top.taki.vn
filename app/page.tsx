"use client";

import { useEffect, useState } from "react";
import { ProfileModal, SiteHeader, initials } from "@/components/ui";
import { AppShell } from "@/components/sidebar";

type HomeCampaign = {
  id: string; name: string; prize: string | null; prizes: { label: string; reward: string }[]; scope: string; status: string;
  start_date: string; end_date: string; registration_deadline: string | null;
  class_names: string[]; class_codes: string[];
  participants: number; channels: number;
  top3: { name: string; public_id: string; total_score: number; rank: number }[];
};

type HomeData = {
  today: string;
  stats: { students: number; channels: number; followers7: number; views7: number };
  campaigns: HomeCampaign[];
  class_board: { class_id: string; name: string; code: string | null; students: number; channels: number; avg_score: number }[];
  feed: { icon: string; text: string; when: string }[];
  hall_of_fame: { campaign_name: string; end_date: string; top3: { rank: number; name: string; public_id: string; total_score: number }[] }[];
};

const fmt = (n: number) => Math.round(n).toLocaleString("vi-VN");
const fmtCompact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} Tr`
  : n >= 1_000 ? `${(n / 1_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} K`
  : fmt(n);
const dmy = (d: string) => d.split("-").reverse().join("/");

function daysLeft(endDate: string): number {
  return Math.max(0, Math.ceil((new Date(`${endDate}T23:59:59+07:00`).getTime() - Date.now()) / 86_400_000));
}
function progressPct(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00+07:00`).getTime();
  const e = new Date(`${end}T23:59:59+07:00`).getTime();
  return Math.min(100, Math.max(0, Math.round(((Date.now() - s) / (e - s)) * 100)));
}

export default function HomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then(setData).catch(() => {});
    fetch("/api/me").then((r) => setLoggedIn(r.ok)).catch(() => {});
  }, []);

  const maxAvg = data?.class_board[0]?.avg_score || 1;

  return (
    <AppShell active="home">
      <SiteHeader
        subtitle="TAKI ACADEMY"
        right={
          <nav className="hd-links">
            {loggedIn ? (
              <a className="cta" href="/dashboard">Vào dashboard</a>
            ) : (
              <>
                <a href="/dang-nhap">Đăng nhập</a>
                <a className="cta" href="/dang-ky">Vào đường đua</a>
              </>
            )}
          </nav>
        }
      />
      <div className="wrap">

        {/* 1. Hero toàn hệ thống */}
        <div className="hero">
          <span className="tag">CỔNG ĐUA TOÀN HỆ THỐNG</span>
          <h1>Học viên TAKI đang xây kênh thật, số liệu thật, đua thật</h1>
          <p>Điểm tính tự động 06:00 mỗi sáng từ dữ liệu kênh thật của từng học viên. Không tự khai, không chấm tay.</p>
          <div className="meta">
            <div><b>{data ? fmt(data.stats.students) : "…"}</b><span>học viên đang đua</span></div>
            <div><b>{data ? fmt(data.stats.channels) : "…"}</b><span>kênh đang theo dõi</span></div>
            <div><b><em>+{data ? fmtCompact(data.stats.followers7) : "…"}</em></b><span>follower cả hệ thống tăng 7 ngày</span></div>
            <div><b>{data ? fmtCompact(data.stats.views7) : "…"}</b><span>lượt xem 7 ngày</span></div>
          </div>
          <div className="btns">
            <a className="btn btn-link" style={{ width: "auto" }} href={loggedIn ? "/dashboard" : "/dang-ky"}>
              {loggedIn ? "Vào dashboard của tôi" : "Vào đường đua của lớp tôi"}
            </a>
          </div>
        </div>

        {/* 2. Đường đua đang mở */}
        <div className="sec">
          <div className="sec-head"><h2>🏁 Đường đua đang mở</h2><span>chọn đúng lớp của bạn để vào đua</span></div>
          {data && !data.campaigns.length && (
            <div className="card"><p className="mini-note">Chưa có đường đua nào đang mở. Quay lại sau nhé.</p></div>
          )}
          <div className="grid g3">
            {(data?.campaigns ?? []).map((c) => {
              const dl = daysLeft(c.end_date);
              const pct = progressPct(c.start_date, c.end_date);
              const classLabel = c.scope === "global" ? "TOÀN HỆ THỐNG" : (c.class_names.join(" · ") || "THEO LỚP").toUpperCase();
              const lopHref = c.class_codes[0] ? `/lop/${c.class_codes[0].toLowerCase()}` : "/dang-ky";
              return (
                <div className="card race" key={c.id}>
                  <div className="top">
                    <span className="cls">{classLabel}</span>
                    <span className={`pill ${c.status === "running" ? "pill-live" : "pill-soon"}`}>
                      {c.status === "running" ? "Đang chạy" : "Mở đăng ký"}
                    </span>
                  </div>
                  <h3>{c.name}</h3>
                  {(() => {
                    const list = c.prizes?.length ? c.prizes : c.prize ? [{ label: "Giải thưởng", reward: c.prize }] : [];
                    if (!list.length) return null;
                    return (
                      <div>
                        {list.slice(0, 2).map((p, i) => (
                          <p className="prize" key={i}>🎁 <b>{p.label}:</b> {p.reward}</p>
                        ))}
                        {list.length > 2 && <p className="prize">… và {list.length - 2} giải khác</p>}
                      </div>
                    );
                  })()}
                  <div className="nums">
                    <div><b>{fmt(c.participants)}</b><span>học viên</span></div>
                    <div><b>{fmt(c.channels)}</b><span>kênh</span></div>
                    <div><b>{dl}</b><span>ngày còn lại</span></div>
                  </div>
                  <div className="avas">
                    {c.top3.map((t) => (
                      <div
                        key={t.public_id}
                        className={`a${t.rank === 1 ? " g" : ""}`}
                        title={`${t.name} · ${fmt(t.total_score)} điểm`}
                        style={{ cursor: "pointer" }}
                        onClick={() => setProfileId(t.public_id)}
                      >
                        {initials(t.name)}
                      </div>
                    ))}
                    <span className="more">
                      {c.top3.length ? `+${Math.max(0, c.participants - c.top3.length)} người đang đua` : `${fmt(c.participants)} người đã ghi danh`}
                    </span>
                  </div>
                  <div className="tl"><i style={{ width: `${pct}%` }} /></div>
                  <div className="tl-lb">
                    <span>{dmy(c.start_date)}</span>
                    <span>{pct <= 5 ? "vừa xuất phát" : `đã đi ${pct}% chặng`}</span>
                    <span>{dmy(c.end_date)}</span>
                  </div>
                  <div className="act">
                    <a className="btn btn-link" href="/dang-ky">Vào đua</a>
                    <a className="btn btn-link btn-ghost" href={lopHref}>Bảng xếp hạng</a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 3. Bảng vàng lớp + Feed chiến tích */}
        <div className="sec grid g2h">
          <div className="card">
            <div className="sec-head" style={{ marginBottom: 6 }}>
              <h2>🏆 Bảng vàng giữa các lớp</h2>
              <span>điểm trung bình mỗi học viên — lớp ít người vẫn thắng được lớp đông</span>
            </div>
            {data && !data.class_board.length && <p className="mini-note">Chưa có lớp nào có điểm. Bảng vàng xuất hiện sau chu kỳ tính điểm đầu tiên.</p>}
            {(data?.class_board ?? []).map((cl, i) => (
              <div className={`class-row${i === 0 ? " first" : ""}`} key={cl.class_id}>
                <div className={`rk${i === 0 ? " g" : ""}`}>{i + 1}</div>
                <div className="nm">
                  <b>{cl.code ? <a href={`/lop/${cl.code.toLowerCase()}`}>{cl.name}</a> : cl.name}</b>
                  <span>{fmt(cl.students)} học viên · {fmt(cl.channels)} kênh</span>
                </div>
                <div className="bar"><i style={{ width: `${Math.max(3, Math.round((cl.avg_score / maxAvg) * 100))}%` }} /></div>
                <div className="pts">{cl.avg_score.toLocaleString("vi-VN")}<span>điểm TB/học viên</span></div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="sec-head" style={{ marginBottom: 6 }}><h2>⚡ Chiến tích mới</h2><span>tự sinh từ dữ liệu quét</span></div>
            {data && !data.feed.length && <p className="mini-note">Chưa có chiến tích nào — feed này tự chạy khi hệ thống bắt đầu quét kênh hàng ngày.</p>}
            {(data?.feed ?? []).map((f, i) => (
              <div className="feed-item" key={i}>
                <div className="ic">{f.icon}</div>
                <div>{f.text}<span className="t">{f.when}</span></div>
              </div>
            ))}
          </div>
        </div>

        {/* 4. Hall of Fame */}
        {(data?.hall_of_fame?.length ?? 0) > 0 && (
          <div className="sec grid g2h">
            {data!.hall_of_fame.map((h) => {
              const byRank = (r: number) => h.top3.find((t) => t.rank === r);
              const slot = (r: number, cls: string, label: string) => {
                const t = byRank(r);
                return t ? (
                  <div className={`p ${cls}`}>
                    <div className="ava" style={{ cursor: "pointer" }} onClick={() => setProfileId(t.public_id)}>{initials(t.name)}</div>
                    <div className="box">
                      <div className="rank-num">{label}</div>
                      <div className="name">{t.name}</div>
                      <div className="pts">{fmt(t.total_score)} đ</div>
                    </div>
                  </div>
                ) : <div className="p" />;
              };
              return (
                <div className="card" key={h.campaign_name}>
                  <div className="sec-head" style={{ marginBottom: 10 }}>
                    <h2>👑 Nhà vô địch mùa trước</h2>
                    <span>{h.campaign_name} · kết thúc {dmy(h.end_date)}</span>
                  </div>
                  <div className="podium">
                    {slot(2, "p2", "HẠNG 2")}
                    {slot(1, "p1", "VÔ ĐỊCH")}
                    {slot(3, "p3", "HẠNG 3")}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 5. CTA cho khách chưa là học viên */}
        <div className="guest">
          <div>
            <b>Bạn chưa phải học viên TAKI?</b>
            <span>Toàn bộ số liệu trên trang này là kết quả thực hành thật của học viên sau khóa học, quét tự động từ kênh thật mỗi ngày.</span>
          </div>
          <a className="btn btn-link" style={{ width: "auto" }} href="https://taki.vn" target="_blank" rel="noopener">
            Tìm hiểu khóa học tại taki.vn
          </a>
        </div>
      </div>

      {profileId && <ProfileModal publicId={profileId} onClose={() => setProfileId(null)} />}
    </AppShell>
  );
}
