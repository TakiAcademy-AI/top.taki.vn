import { SiteHeader } from "@/components/ui";

/** Khung chung cho các trang văn bản pháp lý (chính sách bảo mật, điều khoản). Server component, không cần đăng nhập. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader
        subtitle="TAKI ACADEMY"
        right={<a href="/" style={{ color: "#C9D3EC", fontSize: 12.5, fontWeight: 700, textDecoration: "none" }}>← Trang chủ</a>}
      />
      <div className="wrap">
        <div className="hero">
          <span className="tag">Văn bản</span>
          <h1>{title}</h1>
          <p>Cập nhật lần cuối: {updated}</p>
        </div>
        <div className="card legal" style={{ maxWidth: 820, margin: "0 auto" }}>{children}</div>
        <p className="mini-note" style={{ textAlign: "center", marginTop: 18 }}>
          <a href="/chinh-sach-bao-mat">Chính sách bảo mật</a> · <a href="/dieu-khoan">Điều khoản sử dụng</a>
        </p>
      </div>
    </>
  );
}
