# Thanh toán online qua payOS

## Luồng
1. Khách chọn dịch vụ → nhân viên → ngày → giờ → **Thanh toán online**. Server tạo lịch `PENDING` + payment `PENDING` (số tiền = `price_at_booking`).
2. Khách mở QR: server gọi payOS tạo payment link, giao diện hiển thị QR động + đếm ngược.
3. Khách quét QR bằng app ngân hàng.
4. payOS gọi webhook `POST /api/payments/payos/webhook`; server **xác minh chữ ký**, kiểm tra `orderCode` và số tiền, rồi ghi `PAID` và chuyển lịch `PENDING → CONFIRMED` trong một transaction. Webhook trùng không tạo doanh thu hai lần.
5. Giao diện tự kiểm tra mỗi 5 giây (có nút "Kiểm tra thanh toán" làm dự phòng khi webhook chậm).
6. Quá hạn: server hỏi payOS lần cuối; nếu vẫn chưa trả → payment `EXPIRED`, lịch `CANCELLED`, nhả khung giờ.
7. Khách trả tiền **sau** khi lịch đã hủy: Admin nhận thông báo "Cần hoàn tiền" để hoàn tiền hoặc xếp lại lịch.

Không có nút "xác nhận tay": Admin/Staff không thể xác nhận lịch online khi chưa `PAID`.

## Cấu hình
1. Đăng ký tại https://my.payos.vn, kết nối tài khoản ngân hàng, tạo **Kênh thanh toán**.
2. Điền vào `server/.env` (hoặc `.env` của Docker): `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`.
3. `APP_WEB_URL`, `PAYOS_RETURN_URL`, `PAYOS_CANCEL_URL` = địa chỉ giao diện người dùng thấy. Khi payOS đưa khách quay lại, giao diện tự mở trang "Lịch của tôi" và xác nhận.
4. `PAYOS_WEBHOOK_URL` = `https://<tên-miền>/api/payments/payos/webhook` (bắt buộc HTTPS, truy cập được từ Internet).
5. Khởi động server, đăng nhập ADMIN, gọi **một lần**: `POST /api/payments/admin/confirm-webhook` (header `Authorization: Bearer <token>`). payOS sẽ kiểm tra webhook và đăng ký.

Chạy trên máy cá nhân: `cloudflared tunnel --url http://localhost:5000` (hoặc ngrok) rồi dùng URL công khai nhận được cho `PAYOS_WEBHOOK_URL`.

## Kiểm tra bằng SQL
```sql
SELECT a.appointment_code, a.status, a.price_at_booking,
       p.payment_status, p.amount, p.provider_order_code, p.paid_at, p.qr_expires_at
FROM dbo.appointments a LEFT JOIN dbo.payments p ON p.appointment_id=a.id
ORDER BY a.id DESC;
```

## Checklist trước khi chạy thật
- [ ] QR sinh riêng cho từng lịch, đúng số tiền
- [ ] Quét thật và chuyển đúng tiền → lịch tự `CONFIRMED`, doanh thu tăng đúng 1 lần
- [ ] Để QR hết hạn → lịch tự hủy, khung giờ trống lại
- [ ] Webhook gửi lại nhiều lần không nhân đôi doanh thu
- [ ] `REFUNDED` chỉ là ghi nhận trong hệ thống; tiền thật phải hoàn trên cổng/ngân hàng

## Cập nhật V4.1 — các trường hợp biên
| Tình huống | Hệ thống xử lý |
|---|---|
| Khách/Admin hủy lịch khi QR còn hiệu lực | Link payOS bị hủy ngay (QR cũ không thanh toán được nữa) |
| Payment `FAILED`/`CANCELLED`/`EXPIRED` mà lịch còn `PENDING` quá 10 phút | Lịch tự hủy, nhả khung giờ, báo khách (job nền, có thể mở lại QR trước đó) |
| Tiền về đúng số nhưng lịch đã `CANCELLED` | Payment = `PAID`, đặt `refund_requested_at`, báo khách + Admin → hoàn tay |
| Tiền về **sai số** | Payment = `FAILED`, lưu `provider_amount`, đặt cờ hoàn tiền, báo Admin |
| Webhook sai chữ ký | 400 (không xử lý) |
| Webhook lỗi nội bộ (CSDL…) | 500 để cổng thanh toán biết chưa xử lý |
