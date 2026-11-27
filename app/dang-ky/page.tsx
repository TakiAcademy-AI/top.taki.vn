"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Countdown, Lane, LBRow, Podium, ProfileModal, SiteHeader, useToast } from "@/components/ui";
import { GoogleButton, peekGoogleCredential } from "@/components/google-button";

type OpenCampaign = {
  id: string;
  name: string;
  prize: string | null;
  end_date: string;
  class_names: string[];
  students: number;
  channels: number;
};

type ChanInput = { platform: string; url: string };

export default function RegisterPage() {
  const router = useRouter();
  const { toast, toastNode } = useToast();
  const [campaign, setCampaign] = useState<OpenCampaign | null>(null);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<LBRow[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [gcred, setGcred] = useState<string | null>(null); // ID token Google: email đã xác minh, khóa ô email
  const [classId, setClassId] = useState("");
  const [chans, setChans] = useState<ChanInput[]>([{ platform: "tiktok", url: "" }]);
  // Kết quả giải mã link theo từng dòng kênh: giúp học viên phát hiện dán nhầm link người khác
  const [checks, setChecks] = useState<Record<number, { loading?: boolean; name?: string | null; username?: string; taken?: boolean; taken_by?: string | null; error?: string }>>({});
  const [platforms, setPlatforms] = useState<{ value: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  // Luồng OTP khi SĐT đã tồn tại
  const [otpMode, setOtpMode] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/platforms").then((r) => r.json()).then((d) => {
      const list = d.platforms ?? [];
      setPlatforms(list);
      if (list.length) setChans([{ platform: list[0].value, url: "" }]);
    }).catch(() => {});
    fetch("/api/me").then((r) => { if (r.ok) router.replace("/dashboard"); }).catch(() => {});
    fetch("/api/campaigns/open").then((r) => r.json()).then((d) => {
      setCampaign(d.campaign);
      if (d.campaign) {
        fetch(`/api/leaderboard?campaign_id=${d.campaign.id}`)
          .then((r) => r.json())
          .then((lb) => setRows(lb.rows ?? []))
          .catch(() => {});
      }
    }).catch(() => {});
    fetch("/api/classes").then((r) => r.json()).then((d) => {
      setClasses(d.classes ?? []);
      // Chọn sẵn lớp nếu tới từ trang lớp: /dang-ky?class=<id>
      const pre = new URLSearchParams(window.location.search).get("class");
      const found = pre && d.classes?.find((c: any) => c.id === pre);
      if (found) setClassId(found.id);
      else if (d.classes?.length) setClassId(d.classes[0].id);
    }).catch(() => {});
  }, [router]);

  // Điền email (+ tên nếu còn trống) từ tài khoản Google; server vẫn xác thực lại token khi gửi đăng ký
  function applyGoogle(credential: string) {
    const info = peekGoogleCredential(credential);
    if (!info) { toast("Không đọc được thông tin Google, thử lại nhé"); return; }
    setGcred(credential);
    setEmail(info.email);
    setName((n) => n || info.name);
  }

  // Tới từ trang đăng nhập (email Google chưa có tài khoản): nhận phiên Google đó, khỏi bấm lại
  useEffect(() => {
    try {
      const c = sessionStorage.getItem("gcred");
      if (c) { sessionStorage.removeItem("gcred"); applyGoogle(c); }
    } catch { /* không bắt buộc */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Giải mã 1 dòng kênh khi học viên rời ô input (hoặc dán xong)
  async function checkChan(i: number) {
    const c = chans[i];
    if (!c?.url?.trim()) { setChecks((p) => ({ ...p, [i]: {} })); return; }
    setChecks((p) => ({ ...p, [i]: { loading: true } }));
    try {
      const res = await fetch("/api/resolve-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: c.platform, url: c.url }),
      });
      const d = await res.json();
      if (!d.ok) { setChecks((p) => ({ ...p, [i]: { error: d.error } })); return; }
      setChecks((p) => ({ ...p, [i]: { name: d.name, username: d.username, taken: d.taken, taken_by: d.taken_by } }));
    } catch {
      setChecks((p) => ({ ...p, [i]: {} }));
    }
  }

  async function doRegister() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: name, phone, email, google_credential: gcred ?? undefined, class_id: classId, channels: chans }),
      });
      const d = await res.json();
      if (res.ok) {
        toast(`Đăng ký thành công. ID của bạn: ${d.public_id}`);
        setTimeout(() => router.push("/dashboard"), 900);
      } else if (res.status === 409 && d.phone_exists) {
        setOtpMode(true);
        toast("SĐT đã đăng ký — đăng nhập bằng OTP bên dưới");
      } else if (d.google_expired) {
        setGcred(null);
        toast(d.error ?? "Phiên Google đã hết hạn — bấm Google lại nhé");
      } else {
        toast(d.error ?? "Có lỗi xảy ra");
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendOtp() {
    const res = await fetch("/api/auth/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send", phone }),
    });
    const d = await res.json();
    if (res.ok) {
      setOtpSent(true);
      toast(d.dev_code ? `Đã gửi OTP (dev: ${d.dev_code})` : "Đã gửi mã OTP qua Zalo/SMS");
    } else toast(d.error ?? "Không gửi được OTP");
  }

  async function verifyOtp() {
    const res = await fetch("/api/auth/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify", phone, code: otpCode }),
    });
    const d = await res.json();
    if (res.ok) router.push("/dashboard");
    else toast(d.error ?? "Mã không đúng");
  }

  const max = rows[0]?.total_score ?? 0;

  return (
    <>
      <SiteHeader
        subtitle="TAKI ACADEMY"
        right={<a href="/" style={{ color: "#C9D3EC", fontSize: 12.5, fontWeight: 700, textDecoration: "none" }}>← Trang chủ</a>}
      />
      <div className="wrap">
        <div className="hero">
          <span className="tag">{campaign ? "Chiến dịch đang mở" : "Chưa có chiến dịch"}</span>
          <h1>{campaign ? campaign.name : "Sắp có đường đua mới"}</h1>
          <p>
            {campaign?.class_names?.length ? `Lớp ${campaign.class_names.join(", ")} · ` : ""}
            Đăng ký kênh của bạn để vào đường đua. Điểm được tính tự động từ dữ liệu kênh thật, cập nhật lúc 5h30 và 18h30 hằng ngày.
            {campaign?.prize ? ` Giải thưởng: ${campaign.prize}.` : ""}
          </p>
          {campaign && (
            <div className="reg-meta">
              <div className="reg-stats">
                <div className="reg-pill">
                  <b>{campaign.students.toLocaleString("vi-VN")}</b>
                  <span>học viên đã vào đua</span>
                </div>
                <div className="reg-pill">
                  <b>{campaign.channels.toLocaleString("vi-VN")}</b>
                  <span>kênh đang theo dõi</span>
                </div>
              </div>
              <div className="reg-countdown">
                <span className="lbl">⏳ Kết thúc sau</span>
                <Countdown endDate={campaign.end_date} />
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-2">
          <div className="card">
            <h3>📝 Đăng ký vào đường đua</h3>
            <div className="field">
              <label>Họ và tên</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nguyễn Văn A" />
            </div>
            <div className="field">
              <label>Số điện thoại (Zalo)</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09xx xxx xxx" inputMode="tel" />
            </div>
            <div className="field">
              <label>Email</label>
              <input
                type="email"
                value={email}
                readOnly={!!gcred}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ten@gmail.com"
                autoComplete="email"
              />
              {gcred ? (
                <p className="mini-note" style={{ color: "#12A150", fontWeight: 600 }}>
                  ✓ Email đã xác minh qua Google — dùng email này để đăng nhập bằng Google.{" "}
                  <a href="#" onClick={(e) => { e.preventDefault(); setGcred(null); setEmail(""); }}>Đổi email</a>
                </p>
              ) : (
                <>
                  <p className="mini-note">Dùng email này để đăng nhập bằng Google sau này.</p>
                  <GoogleButton
                    text="continue_with"
                    onCredential={applyGoogle}
                    intro={<p className="mini-note" style={{ margin: "10px 0 6px" }}>Hoặc điền nhanh và xác minh email bằng Google:</p>}
                  />
                </>
              )}
            </div>
            <div className="field">
              <label>Lớp học</label>
              <select value={classId} onChange={(e) => setClassId(e.target.value)}>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Kênh tham gia đua</label>
              {chans.map((c, i) => {
                const ck = checks[i] ?? {};
                return (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: chans.length > 1 ? "120px 1fr 32px" : "120px 1fr", gap: 8 }}>
                    <select value={c.platform} onChange={(e) => { setChans(chans.map((x, j) => (j === i ? { ...x, platform: e.target.value } : x))); setChecks((p) => ({ ...p, [i]: {} })); }}>
                      {platforms.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                    <input
                      value={c.url}
                      onChange={(e) => { setChans(chans.map((x, j) => (j === i ? { ...x, url: e.target.value } : x))); if (checks[i]) setChecks((p) => ({ ...p, [i]: {} })); }}
                      onBlur={() => checkChan(i)}
                      placeholder="Dán link kênh, ví dụ tiktok.com/@kenhcuaban"
                    />
                    {chans.length > 1 && (
                      <button className="btn-ghost btn-sm" title="Bỏ kênh này" style={{ padding: "0 8px" }}
                        onClick={() => { setChans(chans.filter((_, j) => j !== i)); setChecks({}); }}>✕</button>
                    )}
                  </div>
                  {ck.loading && <div className="mini-note" style={{ marginTop: 4 }}>Đang kiểm tra kênh…</div>}
                  {ck.error && <div className="mini-note" style={{ marginTop: 4, color: "#E5484D" }}>⚠️ {ck.error}</div>}
                  {!ck.loading && !ck.error && (ck.name || ck.username) && (
                    ck.taken ? (
                      <div className="mini-note" style={{ marginTop: 4, color: "#E5484D", fontWeight: 600 }}>
                        ⚠️ Kênh <b>{ck.name || `@${ck.username}`}</b> đã có người đăng ký{ck.taken_by ? ` (${ck.taken_by})` : ""}.
                        {" "}Nếu đây KHÔNG phải kênh của bạn thì bạn đã dán nhầm link — hãy mở kênh <b>của chính bạn</b>, copy lại link rồi dán vào.
                      </div>
                    ) : (
                      <div className="mini-note" style={{ marginTop: 4, color: "#12A150", fontWeight: 600 }}>
                        ✓ Kênh: <b>{ck.name || `@${ck.username}`}</b>. Đúng kênh của bạn thì để nguyên nhé.
                      </div>
                    )
                  )}
                </div>
              );})}
              <button className="btn-ghost btn-sm" onClick={() => setChans([...chans, { platform: platforms[0]?.value ?? "tiktok", url: "" }])}>
                + Thêm kênh
              </button>
              <p className="mini-note">
                Có thể đăng ký nhiều kênh trên nhiều nền tảng. Hệ thống tự động xác minh kênh khi quét — không cần chèn mã gì cả.
              </p>
            </div>
            {!otpMode ? (
              <button className="btn" onClick={doRegister} disabled={busy}>
                {busy ? "Đang xử lý…" : "Nhận ID và vào đường đua"}
              </button>
            ) : (
              <div>
                <p className="mini-note" style={{ marginBottom: 10 }}>
                  SĐT này đã có tài khoản. Đăng nhập bằng mã OTP:
                </p>
                {!otpSent ? (
                  <button className="btn" onClick={sendOtp}>Gửi mã OTP</button>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                    <input value={otpCode} onChange={(e) => setOtpCode(e.target.value)} placeholder="Nhập mã 6 số" inputMode="numeric" />
                    <button className="btn" style={{ width: "auto" }} onClick={verifyOtp}>Đăng nhập</button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="card">
            <h3>🏆 Bảng xếp hạng trực tiếp</h3>
            {rows.length ? (
              <>
                <Podium rows={rows.slice(0, 3)} />
                <div>{rows.slice(3, 10).map((r) => <Lane key={r.student_id} row={r} max={max} onClick={() => setProfileId(r.public_id)} />)}</div>
              </>
            ) : (
              <p className="mini-note">Chưa có dữ liệu xếp hạng. Điểm cập nhật tự động lúc 5h30 và 18h30 hằng ngày.</p>
            )}
          </div>
        </div>
      </div>
      {profileId && <ProfileModal publicId={profileId} onClose={() => setProfileId(null)} />}
      {toastNode}
    </>
  );
}
