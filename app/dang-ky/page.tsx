"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Countdown, Lane, LBRow, Podium, ProfileModal, SiteHeader, useToast } from "@/components/ui";

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
  const [classId, setClassId] = useState("");
  const [chans, setChans] = useState<ChanInput[]>([{ platform: "tiktok", url: "" }]);
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

  async function doRegister() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: name, phone, class_id: classId, channels: chans }),
      });
      const d = await res.json();
      if (res.ok) {
        toast(`Đăng ký thành công. ID của bạn: ${d.public_id}`);
        setTimeout(() => router.push("/dashboard"), 900);
      } else if (res.status === 409 && d.phone_exists) {
        setOtpMode(true);
        toast("SĐT đã đăng ký — đăng nhập bằng OTP bên dưới");
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
            Đăng ký kênh của bạn để vào đường đua. Điểm được tính tự động mỗi ngày từ dữ liệu kênh thật.
            {campaign?.prize ? ` Giải thưởng: ${campaign.prize}.` : ""}
          </p>
          {campaign && (
            <div className="meta">
              <div><b>{campaign.students.toLocaleString("vi-VN")}</b><span>học viên đã vào đua</span></div>
              <div><b>{campaign.channels.toLocaleString("vi-VN")}</b><span>kênh đang theo dõi</span></div>
              <div>
                <span>Kết thúc sau</span>
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
              <label>Lớp học</label>
              <select value={classId} onChange={(e) => setClassId(e.target.value)}>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Kênh tham gia đua</label>
              {chans.map((c, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, marginBottom: 8 }}>
                  <select value={c.platform} onChange={(e) => setChans(chans.map((x, j) => (j === i ? { ...x, platform: e.target.value } : x)))}>
                    {platforms.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                  <input
                    value={c.url}
                    onChange={(e) => setChans(chans.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                    placeholder="Dán link kênh, ví dụ tiktok.com/@kenhcuaban"
                  />
                </div>
              ))}
              <button className="btn-ghost btn-sm" onClick={() => setChans([...chans, { platform: platforms[0]?.value ?? "tiktok", url: "" }])}>
                + Thêm kênh
              </button>
              <p className="mini-note">
                Có thể đăng ký nhiều kênh trên nhiều nền tảng. Hệ thống sẽ xác minh quyền sở hữu bằng mã ID gắn trong bio.
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
              <p className="mini-note">Chưa có dữ liệu xếp hạng. Điểm cập nhật 6:00 sáng mỗi ngày.</p>
            )}
          </div>
        </div>
      </div>
      {profileId && <ProfileModal publicId={profileId} onClose={() => setProfileId(null)} />}
      {toastNode}
    </>
  );
}
