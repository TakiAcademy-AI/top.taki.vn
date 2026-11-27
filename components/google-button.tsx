"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

/**
 * Nút "Đăng nhập bằng Google" chính thức (Google Identity Services).
 * Client ID lấy từ /api/auth/google lúc chạy; chưa cấu hình GOOGLE_CLIENT_ID thì component ẩn hẳn
 * (kể cả phần `intro`) — trang vẫn dùng bình thường với SĐT.
 */

declare global {
  interface Window { google?: any }
}

let scriptPromise: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { scriptPromise = null; reject(new Error("gsi")); };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/** Đọc email + tên trong ID token để điền sẵn form. CHỈ để hiển thị — server luôn xác thực lại chữ ký. */
export function peekGoogleCredential(credential: string): { email: string; name: string } | null {
  try {
    const bin = atob(credential.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"));
    const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return typeof p.email === "string" ? { email: p.email, name: typeof p.name === "string" ? p.name : "" } : null;
  } catch {
    return null;
  }
}

export function GoogleButton({
  onCredential, text = "signin_with", intro, divider,
}: {
  onCredential: (credential: string) => void;
  text?: "signin_with" | "signup_with" | "continue_with";
  /** nội dung giải thích đặt phía trên nút (chỉ hiện khi Google đã bật) */
  intro?: ReactNode;
  /** chữ trên đường kẻ phân cách phía trên, vd "hoặc" */
  divider?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef(onCredential);
  latest.current = onCredential;
  const [state, setState] = useState<"loading" | "ready" | "off">("loading");

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const d = await fetch("/api/auth/google").then((r) => r.json());
        if (!d.client_id) { if (!dead) setState("off"); return; }
        await loadGsi();
        if (dead || !box.current) return;
        window.google.accounts.id.initialize({
          client_id: d.client_id,
          callback: (r: { credential: string }) => latest.current(r.credential),
        });
        window.google.accounts.id.renderButton(box.current, {
          type: "standard", theme: "outline", size: "large", shape: "pill", text, locale: "vi",
          width: Math.min(400, Math.max(200, box.current.clientWidth || 300)),
        });
        setState("ready");
      } catch {
        if (!dead) setState("off");
      }
    })();
    return () => { dead = true; };
  }, [text]);

  if (state === "off") return null;
  return (
    // Khi đang tải: giữ chiều rộng (để Google đo được) nhưng ẩn, tránh nhấp nháy
    <div style={state === "loading" ? { height: 0, overflow: "hidden" } : undefined}>
      {divider && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0 12px", color: "var(--muted)", fontSize: 12 }}>
          <span style={{ flex: 1, height: 1, background: "var(--line)" }} />{divider}<span style={{ flex: 1, height: 1, background: "var(--line)" }} />
        </div>
      )}
      {intro}
      <div ref={box} style={{ display: "flex", justifyContent: "center", minHeight: 44 }} />
    </div>
  );
}
