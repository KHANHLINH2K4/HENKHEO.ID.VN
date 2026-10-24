# Triển khai & vận hành (V4.1)

## 1. Docker (khuyến nghị)
```bash
cp .env.docker.example .env
# Điền: DB_PASSWORD (mật khẩu sa, KHÔNG để mẫu), APP_DB_PASSWORD (tài khoản app ít quyền), JWT_SECRET, khóa payOS, DOMAIN
docker compose up -d --build
docker compose run --rm app node seed-admin.js
```
- `migrate` chạy bằng `sa`, tạo database, áp migration và (nếu có `APP_DB_USER`/`APP_DB_PASSWORD`) tạo user `henkheo_app` chỉ có `db_datareader` + `db_datawriter`. Container `app` chạy bằng user đó.
- Cổng ứng dụng mặc định chỉ mở ở `127.0.0.1` (`APP_BIND`). Muốn HTTPS tự động: đặt `DOMAIN`, trỏ DNS, rồi `docker compose --profile https up -d` (Caddy + Let's Encrypt).
- Healthcheck: `GET /api/live` (sống) · `GET /api/health` (sẵn sàng, kiểm tra cả CSDL).

## 2. Chạy trực tiếp
Xem `README.md`. Production nên đặt `NODE_ENV=production`; server từ chối chạy nếu `JWT_SECRET` yếu hoặc còn mật khẩu CSDL mẫu, hoặc thiếu chỉ mục chống trùng giờ (`UX_appointments_staff_slot_active`).

## 3. Nhiều instance
- Việc nền dùng khóa CSDL (`sp_getapplock`) nên chạy nhiều instance không bị trùng việc. Có thể tắt việc nền ở instance chỉ phục vụ web bằng `ENABLE_BACKGROUND_JOBS=false`.
- Rate limit đăng nhập và khóa theo tài khoản đang lưu **trong bộ nhớ từng instance**; chạy nhiều instance nên bổ sung giới hạn ở reverse proxy hoặc Redis.
- `TRUST_PROXY`: số lớp proxy tin cậy (Caddy/Nginx = 1; Cloudflare + Nginx = 2).

## 4. Việc cần làm định kỳ
| Việc | Gợi ý |
|---|---|
| Sao lưu CSDL | hằng ngày, thử khôi phục định kỳ (hệ thống chưa tự sao lưu) |
| `npm audit` | CI đã chạy; xem thêm khi nâng cấp |
| Đối soát hoàn tiền | tab Lịch hẹn → cảnh báo "cần hoàn tiền" |
| Báo cáo | tab Báo cáo (xuất CSV theo khoảng ngày) |

## 5. Giới hạn đã biết
- JWT lưu `localStorage` (CSP `script-src 'self'` giảm rủi ro XSS). Chuyển sang cookie httpOnly cần thêm chống CSRF và đổi cả Socket.IO.
- Email gửi có thử lại trong bộ nhớ; tiến trình tắt giữa chừng sẽ mất email chưa gửi (chưa có hàng đợi lưu CSDL).
- Chưa có: đặt cọc, voucher, danh sách chờ, xác minh SĐT bằng OTP, nhiều chi nhánh, ngày nghỉ lễ chung của cửa hàng.
