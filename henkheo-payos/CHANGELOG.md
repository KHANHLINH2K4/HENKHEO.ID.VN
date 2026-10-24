# Changelog

## 4.1.0
### Sửa lỗi nghiệp vụ
- Lịch online có thanh toán `FAILED/CANCELLED/EXPIRED` không còn kẹt `PENDING` vĩnh viễn (tự hủy sau 10 phút).
- Hủy link payOS khi lịch bị hủy; tiền về sau khi lịch đã hủy hoặc lệch số tiền được đánh dấu cần hoàn.
- Không đánh dấu hoàn thành/không đến trước giờ hẹn; lịch thu tại cơ sở phải thu tiền trước khi hoàn thành.
- Giới hạn số lịch chờ kiểm tra trong transaction; deadlock trả 409 thay vì 500.
- Giờ mở/đóng cửa và bước khung giờ cấu hình được; mã lịch/thanh toán ngẫu nhiên.
- `/appointments/availability` không còn lộ id lịch/dịch vụ; chat ẩn danh có token; xóa nhân viên chặn khi còn lịch mở và khóa tài khoản.
- Webhook payOS: lỗi nội bộ trả 500.
### Tính năng
- Admin chuyển lịch sang nhân viên/giờ khác; tab Báo cáo + xuất CSV; tải .ics; khách tự xóa (ẩn danh) tài khoản.
### Bảo mật / vận hành
- nodemailer 10.x (hết lỗ hổng); khóa tạm đăng nhập theo tài khoản; tài khoản CSDL ít quyền; HTTPS qua Caddy; healthcheck; font tự host + CSP chặt hơn.
- Log JSON + request-id; `/api/live`; khóa việc nền ở CSDL; dọn dữ liệu theo thời hạn lưu trữ; kiểm tra chỉ mục chống trùng giờ lúc khởi động.
### Hiệu năng / chất lượng
- Gộp truy vấn N+1 khi tính khung giờ trống; lọc/giới hạn danh sách lịch; lazy-load biểu đồ; retry email.
- `notify.js`, `jobs.js` tách khỏi route; ESLint cho server; CI GitHub Actions; thêm test (53 unit + integration bổ sung).
### Lưu ý khi nâng cấp
- `npm install` ở `server/` và `client/`, rồi `npm run db:migrate`.
- Đặt mật khẩu CSDL mạnh (production từ chối mật khẩu mẫu). Docker mặc định chỉ mở cổng ở `127.0.0.1`.
