# Hẹn Khéo — Hệ thống đặt lịch dịch vụ

Node.js + Express + **SQL Server** (API) · React + Vite + Tailwind (giao diện) · Socket.IO (thông báo realtime) · **payOS** (thanh toán QR online) · Chatbot NLP đặt lịch qua hội thoại.

Vai trò: **CUSTOMER** (đặt lịch, thanh toán, đổi/hủy lịch, đánh giá) · **STAFF** (lịch hẹn, lịch làm, doanh số cá nhân) · **ADMIN** (toàn bộ quản trị).

```
client/   giao diện React            server/   API Express + SQL Server
docs/     kiến trúc, test case       docker-compose.yml, Dockerfile

client/src/  App.jsx (điều hướng) · lib/ (api, theme, định dạng) · components/ (Header, Chat, UI)
             pages/ (khách, đặt lịch, nhân viên) · pages/admin/ (mỗi tab quản trị một file)
server/      routes/ (API theo nghiệp vụ) · middleware/ · scheduleResolver.js (lịch làm việc)
             migrate.js + migrations/ (CSDL) · tests/ (npm test)
```

## Cách 1 — Docker (khuyên dùng khi triển khai)

```bash
cp .env.docker.example .env      # điền DB_PASSWORD, JWT_SECRET (xem dưới), khóa payOS, tên miền
docker compose up -d --build     # chạy SQL Server + migrate CSDL + app
docker compose run --rm app node seed-admin.js   # tạo ADMIN, in mật khẩu ngẫu nhiên MỘT lần
```
Mở `http://localhost:5000`. Muốn có dữ liệu demo: `docker compose run --rm migrate node migrate.js --seed` (chạy **trước** khi dùng thật, chỉ dùng cho môi trường thử).

Tạo `JWT_SECRET`: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

## Cách 2 — Chạy trực tiếp (phát triển)

Yêu cầu: Node.js ≥ 20, SQL Server (bật SQL Server Authentication, có tài khoản tạo được database).

```bash
cd server
cp .env.example .env             # sửa DB_*, JWT_SECRET
npm install
npm run db:migrate               # tự tạo database + chạy mọi migration (thêm -- --seed để có dữ liệu demo)
npm run seed:admin               # tạo ADMIN
npm run dev                      # API  http://localhost:5000

cd ../client && npm install && npm run dev    # giao diện http://localhost:5173
```
Database đã có sẵn từ trước (đã chạy `schema.sql` bằng SSMS)? `npm run db:migrate` tự nhận diện và chỉ chạy phần còn thiếu — không cần chạy tay từng file `.sql`.

Production không dùng Docker: `cd client && npm run build`, rồi `cd server && NODE_ENV=production node index.js` — server phục vụ luôn giao diện ở cùng một cổng. Đặt sau Nginx/Caddy để có HTTPS.

## Thanh toán online (payOS)

Xem **[docs/PAYMENT.md](docs/PAYMENT.md)**. Tóm tắt: điền `PAYOS_CLIENT_ID/API_KEY/CHECKSUM_KEY`, đặt `PAYOS_WEBHOOK_URL` là URL **HTTPS công khai**, rồi đăng nhập ADMIN và gọi `POST /api/payments/admin/confirm-webhook` một lần. Khi chạy máy cá nhân dùng `cloudflared tunnel --url http://localhost:5000`.

## Quy tắc nghiệp vụ chính

- **Lịch làm việc** (ưu tiên từ cao xuống thấp): ngày ngoại lệ/nghỉ phép → lịch tuần mặc định → lịch cũ (chỉ khi nhân viên chưa có lịch tuần). Một nguồn dùng chung cho đặt lịch, cổng nhân viên, trang Admin, chatbot và đổi lịch.
- **Đặt lịch**: dịch vụ → nhân viên được phân công → ngày → giờ. Chặn trùng giờ trong transaction + chỉ mục duy nhất ở CSDL; chặn ngày/giờ đã qua; đặt trước tối thiểu `BOOKING_MIN_LEAD_MINUTES`, tối đa `BOOKING_MAX_ADVANCE_DAYS` ngày.
- **Thanh toán online**: lịch ở `PENDING` đến khi payOS xác nhận → `CONFIRMED`. Quá hạn (`PAYOS_PAYMENT_EXPIRE_MINUTES`) → hệ thống đối soát payOS lần cuối, nếu chưa trả thì hủy lịch, nhả khung giờ. Số tiền luôn lấy từ `price_at_booking` phía server.
- **Doanh thu**: lịch `COMPLETED` theo `completed_at` và `price_at_booking`; tiền đã thu theo `payments.paid_at`.
- **Khách hàng**: Admin khóa khách sẽ khóa luôn tài khoản đăng nhập (có hiệu lực ngay) và có thể kích hoạt lại; nhân viên chỉ xem được khách đã đặt với mình.
- **Đổi lịch**: dùng cùng quy tắc thời gian như đặt mới, kiểm tra lại trạng thái lịch và khung giờ ngay trong transaction khi duyệt.
- Múi giờ nghiệp vụ đặt bằng `APP_TIMEZONE` (mặc định `Asia/Ho_Chi_Minh`).

## Vận hành

| Việc | Lệnh |
|---|---|
| Kiểm tra sức khỏe | `GET /api/health` (kiểm tra cả kết nối CSDL) |
| Chạy test / kiểm tra mã | `cd server && npm test` · `cd client && npm run lint` |
| Đánh giá chatbot NLP | `cd server && npm run nlp:eval` |
| Đặt lại mật khẩu ADMIN | `ADMIN_PASSWORD=... npm run seed:admin` |
| Sao lưu | sao lưu database `henkheo` (hoặc volume `mssql_data`) hằng ngày |

Bảo mật đã bật: JWT kèm kiểm tra lại CSDL mỗi request (khóa tài khoản / đổi vai trò / đổi mật khẩu có hiệu lực ngay, token cũ bị vô hiệu), mật khẩu ≥ 8 ký tự gồm chữ và số, bcrypt (cost 12), API công khai không lộ SĐT/email nhân viên và che tên khách trong đánh giá, helmet + CSP, rate limit đăng nhập/chat/API, CORS theo `CORS_ORIGIN`, kiểm tra cấu hình khi khởi động (production từ chối chạy nếu `JWT_SECRET` yếu).

## Cập nhật V4 — nghiệp vụ gần với hệ thống đặt lịch thực tế
- **Tạo lịch hộ khách** (khách đến quầy / gọi điện) cho Admin và Staff; **"Bất kỳ nhân viên"** tự phân công khi khách đặt.
- **Chính sách hủy/đổi** theo mốc giờ, **hoàn tiền có mã đối soát**, chống chiếm giờ ảo (giới hạn lịch chờ, khóa khách hay không đến, tự hủy lịch tại cơ sở chưa xác nhận).
- **Email** xác nhận / nhắc lịch / **quên mật khẩu** (SMTP tùy chọn), **nhân viên xin nghỉ → Admin duyệt**, **lịch tuần** cho Admin/Staff, thời gian đệm giữa các lịch.
- Chi tiết: [`docs/BUSINESS_RULES.md`](docs/BUSINESS_RULES.md) · [`docs/ERD.md`](docs/ERD.md) · [`docs/API.md`](docs/API.md) · [`docs/TEST_CASES.md`](docs/TEST_CASES.md).
- Sau khi cập nhật code, **bắt buộc** chạy `cd server && npm install && npm run db:migrate` (áp dụng migration `007_business_rules.sql`).
- Kiểm thử: `npm test` (unit, không cần CSDL) · `npm run test:integration` (cần server + CSDL đã seed; xem đầu file `server/tests/integration/api.integration.test.js`).

## Cập nhật V4.1
Sửa các lỗ hổng nghiệp vụ quanh thanh toán/slot, thêm chuyển lịch, báo cáo + CSV, tải .ics, xóa tài khoản, tài khoản CSDL ít quyền, HTTPS qua Caddy, CI. Xem [`CHANGELOG.md`](CHANGELOG.md), [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Lệnh mới: `cd server && npm run lint` · `node scripts/gen-api-doc.js` (sinh lại `docs/API.md`).
