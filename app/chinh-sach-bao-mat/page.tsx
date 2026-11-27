import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Chính sách bảo mật | Đua Top Xây Kênh",
  description: "Đua Top Xây Kênh thu thập, dùng và bảo vệ dữ liệu của học viên TAKI Academy như thế nào.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Chính sách bảo mật" updated="27/11/2026">
      <p>
        Trang này nói rõ <b>Đua Top Xây Kênh</b> (top.taki.vn) thu thập dữ liệu gì của bạn, dùng để làm gì, ai nhìn thấy
        và bạn kiểm soát nó ra sao.
      </p>

      <h2>1. Đơn vị vận hành</h2>
      <p>
        CÔNG TY TNHH CÔNG NGHỆ VÀ GIÁO DỤC TAKI (TAKI Academy), trụ sở: Tầng 4, TTTM MAC Plaza, số 10 Trần Phú, Hà Đông,
        Hà Nội. Hotline: 0989.493.588. Email: hotro@takigroup.vn.
      </p>

      <h2>2. Dữ liệu chúng tôi thu thập</h2>
      <ul>
        <li><b>Bạn cung cấp khi đăng ký:</b> họ tên, số điện thoại, email, lớp học, link và tên các kênh TikTok, YouTube, Facebook, Instagram bạn đăng ký thi đua.</li>
        <li><b>Từ tài khoản Google, nếu bạn chọn đăng nhập hoặc liên kết Google:</b> chỉ địa chỉ email, họ tên hiển thị và xác nhận của Google rằng email đó thuộc về bạn. Chúng tôi không đọc Gmail, Drive, lịch hay danh bạ của bạn, và không bao giờ nhận mật khẩu Google của bạn.</li>
        <li><b>Số liệu kênh:</b> số follower, lượt xem, số video, lượt tương tác. Hệ thống tự lấy từ trang công khai của kênh hoặc từ API chính thức của nền tảng, hai lần mỗi ngày, để tính điểm.</li>
        <li><b>Facebook Page access token:</b> chỉ khi chính bạn dán vào hồ sơ để hệ thống đọc số liệu chính xác hơn. Token chỉ dùng để đọc số liệu của kênh đó. Bạn gỡ được bất cứ lúc nào trong Dashboard.</li>
        <li><b>Dữ liệu kỹ thuật:</b> cookie đăng nhập (giữ phiên tối đa 30 ngày) và nhật ký thao tác trên hồ sơ như đăng ký, đổi hoặc gỡ kênh, liên kết Google.</li>
      </ul>

      <h2>3. Chúng tôi dùng dữ liệu để làm gì</h2>
      <ul>
        <li>Nhận ra bạn khi đăng nhập.</li>
        <li>Tính điểm, xếp hạng và xét giải theo thể lệ của từng chiến dịch.</li>
        <li>Hiển thị bảng xếp hạng.</li>
        <li>Phát hiện số liệu bất thường hoặc gian lận.</li>
        <li>Liên hệ, hỗ trợ bạn về chương trình.</li>
      </ul>
      <p>Chúng tôi không dùng dữ liệu của bạn để chạy quảng cáo cho bên thứ ba và không bán dữ liệu cho bất kỳ ai.</p>

      <h2>4. Ai nhìn thấy dữ liệu của bạn</h2>
      <p>
        Bảng xếp hạng và hồ sơ công khai hiển thị: họ tên, mã học viên, lớp, điểm, hạng, tên kênh và số liệu kênh.
        <b> Số điện thoại và email của bạn không bao giờ hiển thị công khai.</b> Chỉ bạn và đội ngũ quản trị của TAKI
        Academy xem được chúng.
      </p>

      <h2>5. Chia sẻ với bên thứ ba</h2>
      <p>Chúng tôi chỉ chia sẻ dữ liệu trong các trường hợp sau:</p>
      <ul>
        <li>Nhà cung cấp hạ tầng kỹ thuật xử lý dữ liệu thay chúng tôi: máy chủ, cơ sở dữ liệu, dịch vụ chống tấn công và tăng tốc truy cập (như Cloudflare).</li>
        <li>Google, khi bạn chủ động dùng đăng nhập bằng Google.</li>
        <li>Cơ quan nhà nước có thẩm quyền khi có yêu cầu hợp pháp.</li>
      </ul>
      <p>
        Việc chúng tôi sử dụng và chuyển giao thông tin nhận được từ Google APIs sang bất kỳ ứng dụng nào khác sẽ tuân
        thủ Chính sách dữ liệu người dùng của Google API Services, bao gồm các yêu cầu Sử dụng Hạn chế.
      </p>
      <p>
        TAKI&apos;s use and transfer to any other app of information received from Google APIs will adhere to the Google
        API Services User Data Policy, including the Limited Use requirements.
      </p>

      <h2>6. Lưu trữ và bảo mật</h2>
      <p>
        Dữ liệu lưu trong thời gian chương trình diễn ra và thêm khoảng thời gian cần thiết để đối soát giải thưởng.
        Kết nối tới top.taki.vn dùng HTTPS. Cơ sở dữ liệu không cho trình duyệt truy cập trực tiếp: mọi thao tác đều đi
        qua máy chủ ứng dụng và được kiểm tra quyền.
      </p>

      <h2>7. Quyền của bạn</h2>
      <ul>
        <li>Xem, sửa thông tin và đổi hoặc gỡ kênh ngay trong Dashboard.</li>
        <li>Gỡ kết nối Facebook của từng kênh trong Dashboard.</li>
        <li>Thu hồi quyền của ứng dụng với tài khoản Google tại myaccount.google.com/permissions.</li>
        <li>Yêu cầu xóa hồ sơ hoặc gỡ email khỏi hồ sơ: gửi email tới hotro@takigroup.vn, chúng tôi xử lý sớm nhất có thể.</li>
      </ul>

      <h2>8. Thay đổi chính sách</h2>
      <p>Khi chính sách đổi, chúng tôi cập nhật ngày ở đầu trang này. Bạn tiếp tục dùng dịch vụ nghĩa là đồng ý với bản mới nhất.</p>

      <h2>9. Liên hệ</h2>
      <p>Mọi câu hỏi về dữ liệu cá nhân: hotro@takigroup.vn hoặc hotline 0989.493.588 (08:00 đến 17:30 các ngày làm việc).</p>
    </LegalPage>
  );
}
