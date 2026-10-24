# Quy tắc nghiệp vụ (V4)

Mọi ngưỡng cấu hình bằng `server/.env` (xem `.env.example`). Logic thuần nằm ở `server/policy.js` (có unit test), phần truy vấn CSDL ở `server/routes/appointments.js`.

## 1. Chính sách hủy / đổi lịch
| Tình huống | Quy tắc |
|---|---|
| Lịch `PENDING`, **chưa** thanh toán | Khách hủy/đổi bất cứ lúc nào (chưa phát sinh chi phí, nhả giờ cho người khác) |
| Lịch `CONFIRMED` hoặc đã thanh toán | Chỉ hủy/đổi được **trước giờ hẹn tối thiểu `CANCEL_MIN_HOURS` / `RESCHEDULE_MIN_HOURS` giờ** (mặc định 2). Sát giờ hơn → API trả 403, giao diện khóa nút và nêu lý do |
| Sau khi hết cửa sổ | Khách liên hệ cửa hàng; Admin/Staff vẫn hủy được |

## 2. Hoàn tiền
- Khách hủy (hoặc Admin/Staff hủy) lịch đã thanh toán online → hệ thống **không xóa khoản thu**, đánh dấu `payments.refund_requested_at`, báo Admin ("Cần hoàn tiền") và báo khách.
- Admin chuyển tiền thật ngoài hệ thống (ngân hàng/payOS), rồi bấm **Ghi nhận đã hoàn tiền** và **bắt buộc nhập mã giao dịch hoàn**. Lưu `refund_reference`, `refunded_at`, `refunded_by`; `transaction_code` gốc được giữ nguyên.
- Giới hạn có chủ đích: hệ thống không gọi API hoàn tiền của cổng thanh toán (payOS cho cá nhân không có API hoàn tiền tự động).
- V4.1: tiền về **sau khi lịch đã hủy** cũng được đánh dấu cần hoàn (và báo khách); khoản **lệch số tiền** được ghi nhận số tiền thực nhận (`provider_amount`) và cũng nằm trong danh sách cần hoàn khi lịch bị hủy.

## 3. Chống chiếm giờ ảo
- Tối đa `MAX_ACTIVE_BOOKINGS` (3) lịch chờ/sắp tới mỗi khách.
- `NO_SHOW_BLOCK_COUNT` (3) lần "không đến" trong `NO_SHOW_WINDOW_DAYS` (90) ngày → tạm khóa đặt online (403).
- Lịch "thanh toán tại cơ sở" ở `PENDING` quá `STORE_PENDING_EXPIRE_MINUTES` (720 = 12h) **hoặc** đã qua giờ hẹn → tự hủy (job chạy 5 phút/lần), báo khách.
- Mỗi số điện thoại chỉ một tài khoản; SĐT phải là số di động Việt Nam hợp lệ (chuẩn hóa `+84…` → `0…`).

## 4. Đặt lịch
- `staffId = "ANY"`: hệ thống chọn nhân viên **rảnh đúng khung giờ, ít lịch nhất trong ngày** (hòa thì id nhỏ); nếu người được chọn vừa bị đặt mất thì thử người kế tiếp.
- Thời gian đệm `SLOT_BUFFER_MINUTES` giữa 2 lịch của cùng nhân viên (áp cho đặt lịch, chatbot, đổi lịch, duyệt đổi lịch).
- Chống trùng giờ ở 3 tầng: lọc slot khi hiển thị → kiểm tra chồng lấn trong transaction `SERIALIZABLE` (`UPDLOCK, HOLDLOCK`) → unique index `UX_appointments_staff_slot_active`.

## 5. Tạo lịch hộ khách (walk-in / điện thoại)
- Admin hoặc Staff: `POST /api/appointments/manual`. Lịch **xác nhận ngay**, thanh toán tại cơ sở, ghi `source = WALK_IN | PHONE`, `created_by_user_id`.
- Admin chọn nhân viên hoặc "Bất kỳ"; Staff chỉ tạo cho chính mình và chỉ tra khách bằng đúng SĐT.
- Khách chưa có tài khoản được tạo hồ sơ `customers` (user_id NULL). Khi họ đăng ký bằng cùng SĐT, tài khoản được **gắn vào hồ sơ cũ** để giữ lịch sử.

## 6. Thông báo & email
- Trong ứng dụng (Socket.IO) luôn hoạt động. Email là tùy chọn (`SMTP_HOST`): xác nhận đặt lịch, đổi trạng thái, nhắc lịch trước `REMINDER_HOURS_BEFORE` giờ, quên mật khẩu.
- Không cấu hình SMTP: không lỗi; dev in nội dung email (kể cả link đặt lại mật khẩu) ra console.
- Gửi email lỗi không bao giờ làm hỏng luồng đặt lịch.

## 7. Quên mật khẩu
Token ngẫu nhiên 32 byte, CSDL chỉ lưu SHA-256, hết hạn 30 phút, dùng một lần; 1 yêu cầu/2 phút/tài khoản; phản hồi luôn giống nhau (không lộ tài khoản có tồn tại); đặt lại xong vô hiệu mọi phiên cũ. Tài khoản không có email vẫn nhờ Admin đặt lại.

## 8. Nhân viên xin nghỉ
Staff gửi đơn (tối đa 30 ngày/đơn, không quá khứ, không trùng đơn khác) → Admin duyệt → hệ thống tạo `staff_schedule_exceptions` cho từng ngày. **Không duyệt được nếu nhân viên còn lịch hẹn trong khoảng nghỉ.** Admin cũng không đặt ngày nghỉ/thu hẹp ca ngoại lệ khi đã có lịch hẹn nằm ngoài ca mới.

## 9. Đổi trạng thái lịch (Admin/Staff) — V4.1
- Chuyển hợp lệ: `PENDING → CONFIRMED | CANCELLED`; `CONFIRMED → COMPLETED | CANCELLED | NO_SHOW`. Các trạng thái cuối không đổi tiếp.
- **Không được** đánh dấu `COMPLETED` / `NO_SHOW` trước giờ hẹn (`NO_SHOW` còn có thể chờ thêm `NO_SHOW_AFTER_MINUTES` phút).
- Lịch thanh toán **tại cơ sở** phải được ghi nhận **đã thu tiền** (`collect`) trước khi `COMPLETED`, để doanh thu và tiền đã thu không lệch nhau.

## 10. Chuyển lịch bởi Admin — V4.1
- `PATCH /api/appointments/:id/reassign` đổi nhân viên và/hoặc giờ của lịch `PENDING`/`CONFIRMED`. Dùng đúng quy tắc đặt lịch (phân công dịch vụ, nằm trong ca làm, không chồng lấn kể cả thời gian đệm, transaction SERIALIZABLE).
- Khách, nhân viên cũ và mới được thông báo; yêu cầu đổi lịch đang chờ của lịch đó tự hủy; ghi lịch sử trạng thái và nhật ký.
- Nhân viên **còn lịch mở từ hôm nay** không xóa được (409) cho tới khi chuyển/hủy hết lịch; xóa nhân viên cũng khóa luôn tài khoản đăng nhập.

## 11. Giờ mở cửa & khung giờ — V4.1
- `BUSINESS_OPEN_TIME` / `BUSINESS_CLOSE_TIME` (mặc định 08:00 / 18:00): lịch phải bắt đầu sau giờ mở và **kết thúc** trước giờ đóng. `SLOT_STEP_MINUTES` (mặc định 30) là bước chia khung giờ.

## 12. Dữ liệu cá nhân — V4.1
- Khách tự xóa tài khoản: `POST /api/customers/me/delete-account` (xác nhận mật khẩu; chặn khi còn lịch mở hoặc khoản chờ hoàn). Hồ sơ được **ẩn danh hóa**; lịch hẹn/thanh toán cũ giữ lại cho đối soát.
- Việc nền dọn: lịch sử chat quá `CHAT_RETENTION_DAYS` (180), thông báo đã đọc quá `NOTIFICATION_RETENTION_DAYS` (180), token đặt lại mật khẩu hết hạn.
- Đây là biện pháp kỹ thuật, không phải tư vấn pháp lý; hãy đối chiếu quy định bảo vệ dữ liệu cá nhân hiện hành (vd Nghị định 13/2023/NĐ-CP) với chuyên gia.
