"use client";

import { useEffect, useState } from "react";

/* Sidebar trái theo mockup — chỉ chứa mục có thật. Hiện ở màn ≥1000px, mobile giữ header cũ. */

type ClassLite = { id: string; name: string; code?: string | null };

export function AppShell({ active, children }: { active: "home" | "race" | "dashboard" | "register"; children: React.ReactNode }) {
  const [classes, setClasses] = useState<ClassLite[]>([]);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then((d) => {
      const seen = new Map<string, ClassLite>();
      for (const c of d?.campaigns ?? []) {
        (c.class_codes ?? []).forEach((code: string, i: number) => {
          if (code && !seen.has(code)) seen.set(code, { id: code, name: c.class_names?.[i] ?? code, code });
        });
      }
      setClasses([...seen.values()]);
    }).catch(() => {});
    fetch("/api/me").then((r) => setLoggedIn(r.ok)).catch(() => {});
  }, []);

  const item = (key: string, href: string, icon: string, label: string, ext?: boolean) => (
    <a key={key} className={`sb-item${active === key ? " on" : ""}`} href={href} target={ext ? "_blank" : undefined} rel={ext ? "noopener" : undefined}>
      <span className="ic">{icon}</span>{label}{ext && <span className="ext">↗</span>}
    </a>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="sb-logo" href="/">
          <div className="flag">🏁</div>
          <div>ĐUA TOP<small>XÂY KÊNH · TAKI</small></div>
        </a>
        <nav>
          {item("home", "/", "🏠", "Tổng quan")}
          <div className="sb-group">Đua top xây kênh</div>
          {classes.length
            ? classes.map((c) => (
                <a key={c.code} className={`sb-item sb-sub${active === "race" ? " on-soft" : ""}`} href={`/lop/${String(c.code).toLowerCase()}`}>
                  <span className="ic">🏆</span>{c.name}
                </a>
              ))
            : item("race", "/", "🏆", "Bảng xếp hạng")}
          <div className="sb-group">Cá nhân</div>
          {item("dashboard", loggedIn ? "/dashboard" : "/dang-nhap", "👤", loggedIn ? "Dashboard của tôi" : "Đăng nhập")}
          {item("register", "/dang-ky", "📝", "Đăng ký kênh")}
          <div className="sb-group">TAKI Academy</div>
          {item("hoc-tap", "https://edu.nguyentatkiem.com/", "🎓", "Học tập", true)}
        </nav>
        <div className="sb-note">
          Số liệu quét tự động mỗi ngày lúc 05:30 · điểm chốt 06:00
        </div>
      </aside>
      <main className="shell-main">{children}</main>
    </div>
  );
}
