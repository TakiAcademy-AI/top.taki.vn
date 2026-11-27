"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteHeader, useToast } from "@/components/ui";
import { GoogleButton } from "@/components/google-button";

export default function LoginPage() {
  const router = useRouter();
  const { toast, toastNode } = useToast();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [noAccount, setNoAccount] = useState<string | null>(null); // email Google chưa gắn với học viên nào

  useEffect(() => {
    // Đã đăng nhập thì vào thẳng dashboard
    fetch("/api/me").then((r) => { if (r.ok) router.replace("/dashboard"); }).catch(() => {});
  }, [router]);

  async function doLogin() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      const d = await res.json();
      if (res.ok) {
        toast("Đăng nhập thành công");
        setTimeout(() => router.push("/dashboard"), 500);
      } else if (d.not_registered) {
        toast("Số điện thoại chưa đăng ký — chuyển sang trang đăng ký");
        setTimeout(() => router.push("/dang-ky"), 900);
      } else {
        toast(d.error ?? "Đăng nhập không thành công");
      }
    } finally {
      setBusy(false);
    }
  }

  async function googleLogin(credential: string) {
    setNoAccount(null);
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      toast("Đăng nhập thành công");
      setTimeout(() => router.push("/dashboard"), 500);
    } else if (d.not_registered) {
      setNoAccount(d.email);
      // Chuyển phiên Google sang trang đăng ký để điền sẵn email, khỏi bắt học viên bấm Google lần nữa
      try { sessionStorage.setItem("gcred", credential); } catch { /* không bắt buộc */ }
    } else {
      toast(d.error ?? "Đăng nhập Google không thành công");
    }
  }

  return (
    <>
      <SiteHeader
        subtitle="TAKI ACADEMY"
        right={<a href="/" style={{ color: "#C9D3EC", fontSize: 12.5, fontWeight: 700, textDecoration: "none" }}>← Trang chủ</a>}
      />
      <div className="wrap">
        <div className="hero">
          <span className="tag">Đăng nhập</span>
          <h1>Đăng nhập học viên</h1>
          <p>Đăng nhập bằng số điện thoại đã dùng khi đăng ký, hoặc bằng tài khoản Google đã gắn với hồ sơ, để xem kênh và thứ hạng của bạn.</p>
        </div>

        <div style={{ maxWidth: 440, margin: "0 auto" }}>
          <div className="card">
            <h3>🔐 Đăng nhập</h3>
            <div className="field">
              <label>Số điện thoại (tài khoản)</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="09xx xxx xxx"
                inputMode="tel"
                autoComplete="username"
                onKeyDown={(e) => { if (e.key === "Enter") document.getElementById("pw-field")?.focus(); }}
              />
            </div>
            <div className="field">
              <label>Mật khẩu</label>
              <input
                id="pw-field"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nhập lại số điện thoại của bạn"
                autoComplete="current-password"
                onKeyDown={(e) => { if (e.key === "Enter") doLogin(); }}
              />
              <p className="mini-note">Mật khẩu chính là số điện thoại của bạn.</p>
            </div>
            <button className="btn" onClick={doLogin} disabled={busy}>
              {busy ? "Đang đăng nhập…" : "Đăng nhập"}
            </button>
            <GoogleButton divider="hoặc" onCredential={googleLogin} />
            {noAccount && (
              <div className="pending-warn" style={{ marginTop: 12 }}>
                <p className="mini-note" style={{ color: "var(--red)", fontWeight: 700, marginBottom: 6 }}>
                  Email {noAccount} chưa gắn với học viên nào.
                </p>
                <p className="mini-note" style={{ marginBottom: 4 }}>
                  • <b>Đã đăng ký trước đây?</b> Đăng nhập bằng số điện thoại ở trên, rồi bấm “Liên kết Google” trong Dashboard — từ lần sau đăng nhập Google được ngay.
                </p>
                <p className="mini-note">
                  • <b>Chưa đăng ký?</b> <a href="/dang-ky" style={{ fontWeight: 700 }}>Đăng ký vào đường đua</a> (email này sẽ được điền sẵn).
                </p>
              </div>
            )}
            <p className="mini-note" style={{ marginTop: 12, textAlign: "center" }}>
              Chưa có tài khoản? <a href="/dang-ky" style={{ fontWeight: 700 }}>Đăng ký vào đường đua</a>
            </p>
          </div>
          <p className="mini-note" style={{ textAlign: "center", marginTop: 14 }}>
            <a href="/chinh-sach-bao-mat">Chính sách bảo mật</a> · <a href="/dieu-khoan">Điều khoản sử dụng</a>
          </p>
        </div>
      </div>
      {toastNode}
    </>
  );
}
