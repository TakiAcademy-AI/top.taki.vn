import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Điều khoản sử dụng | Đua Top Xây Kênh",
  description: "Quy định khi tham gia thi đua trên nền tảng Đua Top Xây Kênh của TAKI Academy.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Điều khoản sử dụng" updated="27/11/2026">
      <p>
        Khi đăng ký hoặc đăng nhập Đua Top Xây Kênh (top.taki.vn), bạn đồng ý với các điều khoản dưới đây. Nền tảng do
        CÔNG TY TNHH CÔNG NGHỆ VÀ GIÁO DỤC TAKI (TAKI Academy) vận hành, dành cho học viên của TAKI Academy.
      </p>

      <h2>1. Tài khoản</h2>
      <ul>
        <li>Thông tin bạn khai (họ tên, số điện thoại, email) phải đúng và là của chính bạn.</li>
        <li>Bạn chịu trách nhiệm về mọi thao tác trong tài khoản của mình. Không đưa tài khoản cho người khác dùng.</li>
        <li>Bạn đăng nhập được bằng số điện thoại hoặc bằng Google. Đăng nhập Google là tùy chọn, dùng email đã gắn với hồ sơ của bạn.</li>
      </ul>

      <h2>2. Kênh đăng ký</h2>
      <ul>
        <li>Chỉ đăng ký kênh <b>do chính bạn sở hữu và vận hành</b>. Mỗi kênh chỉ thuộc về một học viên.</li>
        <li>Bạn được thêm, sửa, đổi hoặc gỡ kênh trong Dashboard. Khi đổi hoặc gỡ một kênh đã xác minh, điểm của kênh đó trong các chiến dịch đang chạy sẽ bị xóa. Điểm của các chiến dịch đã kết thúc được giữ nguyên.</li>
        <li>Kênh đang bị gắn cờ chỉ được sửa hoặc gỡ khi có xác nhận của ban tổ chức.</li>
      </ul>

      <h2>3. Cách tính điểm và giải thưởng</h2>
      <ul>
        <li>Điểm được tính tự động từ số liệu thật của kênh (follower, lượt xem, video mới, tương tác, chuyên cần) theo công thức công bố của từng chiến dịch.</li>
        <li>Số liệu lấy từ nền tảng bên thứ ba nên có thể trễ hoặc lệch. Ban tổ chức có quyền điều chỉnh điểm khi phát hiện sai sót.</li>
        <li>Thể lệ riêng của từng chiến dịch là căn cứ xét giải. TAKI Academy không cam kết thứ hạng hay giải thưởng nào ngoài thể lệ đó.</li>
      </ul>

      <h2>4. Hành vi bị cấm</h2>
      <ul>
        <li>Mua hoặc bơm ảo follower, lượt xem, tương tác.</li>
        <li>Đăng ký kênh không phải của mình, hoặc tạo nhiều hồ sơ để lấy lợi thế.</li>
        <li>Can thiệp vào hệ thống: tấn công, quét dữ liệu hàng loạt, khai thác lỗi để tăng điểm.</li>
      </ul>
      <p>
        Nếu vi phạm, ban tổ chức có quyền gắn cờ kênh, trừ hoặc xóa điểm, khóa tài khoản và loại khỏi xét giải. Ban tổ
        chức xem xét từng trường hợp và đưa ra quyết định.
      </p>

      <h2>5. Dịch vụ cung cấp &quot;như hiện có&quot;</h2>
      <p>
        Nền tảng có thể gián đoạn hoặc thiếu số liệu khi TikTok, YouTube, Facebook, Instagram thay đổi cách hiển thị
        hoặc chặn truy cập. Chúng tôi sẽ cố gắng khắc phục nhanh nhất, và trong phạm vi pháp luật cho phép, không chịu
        trách nhiệm cho thiệt hại gián tiếp phát sinh từ việc gián đoạn đó.
      </p>

      <h2>6. Chấm dứt</h2>
      <p>
        Bạn có thể yêu cầu xóa hồ sơ bất cứ lúc nào qua hotro@takigroup.vn. Chúng tôi có thể khóa hoặc xóa tài khoản
        vi phạm điều khoản này.
      </p>

      <h2>7. Dữ liệu cá nhân</h2>
      <p>Cách chúng tôi xử lý dữ liệu của bạn được nêu ở <a href="/chinh-sach-bao-mat">Chính sách bảo mật</a>.</p>

      <h2>8. Thay đổi điều khoản</h2>
      <p>Khi điều khoản đổi, chúng tôi cập nhật ngày ở đầu trang. Bạn tiếp tục dùng dịch vụ nghĩa là đồng ý với bản mới nhất.</p>

      <h2>9. Luật áp dụng và liên hệ</h2>
      <p>
        Điều khoản này theo pháp luật Việt Nam. Tranh chấp ưu tiên giải quyết bằng thương lượng, nếu không được thì do
        tòa án có thẩm quyền tại Việt Nam giải quyết. Liên hệ: hotro@takigroup.vn, hotline 0989.493.588, Tầng 4, TTTM MAC
        Plaza, số 10 Trần Phú, Hà Đông, Hà Nội.
      </p>
    </LegalPage>
  );
}
