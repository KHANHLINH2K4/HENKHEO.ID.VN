# HẸN KHÉO — BỘ TEST CASE CUỐI

## A. Authentication / Authorization
| ID | Test | Expected |
|---|---|---|
| AUTH-01 | ADMIN đăng nhập đúng | Token + role ADMIN |
| AUTH-02 | Sai mật khẩu | HTTP 401 |
| AUTH-03 | CUSTOMER đăng ký | Tạo users + customers, role CUSTOMER |
| AUTH-04 | CUSTOMER truy cập `/api/admin/stats/sales` | HTTP 403 |
| AUTH-05 | STAFF truy cập lịch ADMIN | HTTP 403 |
| AUTH-06 | Token hết hạn / sai | HTTP 401 |

## B. Booking nghiệp vụ
| ID | Test | Expected |
|---|---|---|
| BOOK-01 | Chọn dịch vụ | Hiện đúng duration/price |
| BOOK-02 | Dịch vụ có nhiều staff | Hiện tất cả staff được phân công |
| BOOK-03 | Chọn staff A | Chỉ hiện slot của A |
| BOOK-04 | Staff không có ca | Không cho chọn |
| BOOK-05 | Slot vượt 18:00 | Không hiển thị / Backend từ chối |
| BOOK-06 | Slot ngoài ca | Backend từ chối |
| BOOK-07 | Trùng PENDING | Từ chối |
| BOOK-08 | Trùng CONFIRMED | Từ chối |
| BOOK-09 | Hai request đồng thời cùng slot | Chỉ một request thành công |
| BOOK-10 | Giá dịch vụ đổi sau khi đặt | Lịch cũ giữ `price_at_booking` |
| BOOK-11 | CUSTOMER đặt lịch | Tạo status PENDING + history |
| BOOK-12 | Đặt lịch | Tạo notification cho khách/staff |

## C. Appointment lifecycle
| ID | Test | Expected |
|---|---|---|
| APT-01 | PENDING → CONFIRMED | Cho phép |
| APT-02 | PENDING → CANCELLED | Cho phép + lý do |
| APT-03 | CONFIRMED → COMPLETED | Cho phép + `completed_at` |
| APT-04 | CONFIRMED → CANCELLED | Cho phép + lý do |
| APT-05 | CONFIRMED → NO_SHOW | Cho phép |
| APT-06 | COMPLETED → PENDING | Từ chối |
| APT-07 | CANCELLED → CONFIRMED | Từ chối |
| APT-08 | CUSTOMER hủy lịch của người khác | HTTP 404/403 |
| APT-09 | CUSTOMER đổi lịch của người khác | HTTP 404/403 |
| APT-10 | Đổi lịch sang slot trùng | Từ chối |
| APT-11 | Đổi lịch | Ghi `appointment_reschedules` + status history |

## D. Staff / Admin
| ID | Test | Expected |
|---|---|---|
| STAFF-01 | ADMIN thêm staff | Tạo staff + ca 08:00–18:00 14 ngày |
| STAFF-02 | ADMIN sửa staff | Cập nhật dữ liệu |
| STAFF-03 | ADMIN khóa staff | `is_active=0` |
| STAFF-04 | ADMIN tạo tài khoản STAFF | Liên kết `staff.user_id` |
| STAFF-05 | STAFF đăng nhập | Vào Staff Portal |
| STAFF-06 | STAFF xem lịch | Chỉ lịch của mình |
| STAFF-07 | STAFF cập nhật lịch người khác | Bị từ chối |
| STAFF-08 | ADMIN phân công nhiều staff cho 1 service | Lưu nhiều dòng staff_services |

## E. Revenue / Reporting
| ID | Test | Expected |
|---|---|---|
| SALE-01 | PENDING | Không tính doanh số |
| SALE-02 | CONFIRMED | Không tính doanh số |
| SALE-03 | CANCELLED | Không tính doanh số |
| SALE-04 | COMPLETED | Tính `price_at_booking` |
| SALE-05 | Đổi giá service sau khi đặt | Lịch cũ không đổi doanh số |
| SALE-06 | Xem ngày | Đúng doanh số theo `completed_at` |
| SALE-07 | Xem tháng | Đúng doanh số theo tháng của `completed_at` |
| SALE-08 | Xem năm | Đúng doanh số theo năm của `completed_at` |
| SALE-09 | Doanh số staff | Chỉ cộng lịch COMPLETED của staff đó |
| SALE-10 | Theo dịch vụ | Cộng theo service của lịch COMPLETED |

## F. Customer / Review / Notification
| ID | Test | Expected |
|---|---|---|
| CRM-01 | CUSTOMER xem Lịch của tôi | Chỉ lịch của mình |
| CRM-02 | Đổi lịch | Chuyển về PENDING |
| CRM-03 | Hủy lịch | Status CANCELLED + lý do |
| CRM-04 | Review trước COMPLETED | Từ chối |
| CRM-05 | Review sau COMPLETED | Tạo 1 review |
| CRM-06 | Review lần 2 cùng appointment | Từ chối |
| CRM-07 | ADMIN ẩn review | `is_visible=0` |
| CRM-08 | Notification | Người nhận đúng user_id |
| CRM-09 | Đánh dấu đã đọc | Chỉ sửa notification của chính mình |

## G. Chatbot / NLP
| ID | Test | Expected |
|---|---|---|
| NLP-01 | “Xin chào” | GREETING |
| NLP-02 | “Có những dịch vụ nào?” | SERVICE_LIST |
| NLP-03 | “Giá cắt tóc nam?” | PRICE + service entity |
| NLP-04 | “Mất bao lâu?” + tên service | DURATION + service entity |
| NLP-05 | “Giờ làm việc?” | WORKING_HOURS |
| NLP-06 | “Tôi muốn đặt lịch cắt tóc ngày mai 14:00” | BOOKING + service/date/time entities |
| NLP-07 | “Hủy lịch” | CANCEL |
| NLP-08 | “Đổi lịch” | RESCHEDULE |
| NLP-09 | Câu ngoài phạm vi | UNKNOWN / phản hồi an toàn |
| NLP-10 | Chat history | Ghi user + assistant message |
| NLP-11 | Admin analytics | Có intent count + confidence |
| NLP-12 | Khách CHƯA đăng nhập gõ “tôi muốn đặt lịch” | Chatbot yêu cầu đăng nhập, action LOGIN_REQUIRED, không tạo appointment |
| NLP-13 | Khách đã đăng nhập, gõ “đặt lịch cắt tóc nam ngày mai 14h” | Chatbot trích đủ 3 thực thể trong 1 câu, hỏi xác nhận ngay (bỏ qua các bước hỏi lại) |
| NLP-14 | Khách chỉ gõ “tôi muốn đặt lịch” (không kèm thông tin) | Chatbot hỏi lần lượt: dịch vụ → ngày → giờ |
| NLP-15 | Tại bước xác nhận, khách gõ “có” | Gọi `createAppointmentCore`, tạo appointment PENDING thật, trả về `appointment_code` |
| NLP-16 | Tại bước xác nhận, khách gõ “không” | Huỷ luồng đặt lịch qua chat, không tạo appointment, `flow_state` về NULL |
| NLP-17 | Giờ khách chọn vừa bị người khác đặt mất (409) trước khi xác nhận xong | Chatbot báo không còn trống, hỏi lại giờ khác, không tạo appointment trùng |
| NLP-18 | Khách gõ “huỷ đặt lịch” giữa luồng đang thu thập thông tin | Thoát luồng đặt lịch qua chat ngay lập tức |
| NLP-19 | Câu có lỗi chính tả nhẹ: “dat lch cho minh” | Vẫn nhận diện đúng BOOKING nhờ khớp mờ Levenshtein |
| NLP-20 | Trích xuất “3 giờ chiều”, “9 giờ sáng”, “8 giờ tối” | Trả về đúng 15:00 / 09:00 / 20:00 |
| NLP-21 | Trích xuất “thứ 2 tuần sau” | Suy đúng ngày dương lịch của Thứ 2 tuần kế tiếp |

## J. Bảo mật bổ sung
| ID | Test | Expected |
|---|---|---|
| SEC-01 | Đăng nhập sai mật khẩu > 20 lần trong 15 phút | HTTP 429 (rate limit), chặn brute-force |
| SEC-02 | Gửi > 30 tin nhắn chat trong 1 phút | HTTP 429 |
| SEC-03 | CUSTOMER đổi mật khẩu với mật khẩu cũ sai | HTTP 401, không đổi |
| SEC-04 | CUSTOMER đổi mật khẩu hợp lệ | Đổi thành công, đăng nhập lại bằng mật khẩu mới hoạt động |
| SEC-05 | ADMIN đặt lại mật khẩu cho một tài khoản | Đổi thành công + ghi activity log `ADMIN_RESET_PASSWORD` |
| SEC-06 | STAFF/CUSTOMER gọi endpoint ADMIN reset password | HTTP 403 |


## H. Ghi nhận / Audit
| ID | Test | Expected |
|---|---|---|
| AUD-01 | ADMIN tạo service | Có activity log |
| AUD-02 | ADMIN sửa staff | Có activity log |
| AUD-03 | CUSTOMER đặt lịch | Có activity log |
| AUD-04 | STAFF đổi status | Có activity log |
| AUD-05 | ADMIN xem activity logs | Có dữ liệu, chỉ ADMIN |

## I. Payment / Thanh toán
| ID | Test | Expected |
|---|---|---|
| PAY-01 | Chọn thanh toán tại cơ sở khi đặt lịch | Tạo payment PENDING + AT_STORE |
| PAY-02 | Chọn thanh toán online khi đặt lịch | Tạo payment PENDING + ONLINE |
| PAY-03 | CUSTOMER thanh toán online | Payment PAID + transaction_code + paid_at; appointment PENDING → CONFIRMED |
| PAY-04 | Bấm thanh toán online lần 2 | Không thu lần 2 |
| PAY-05 | ADMIN thu tiền tại cơ sở | Payment PAID + mã CASH-* |
| PAY-06 | STAFF thu tiền lịch của mình | Thành công |
| PAY-07 | STAFF thu tiền lịch của người khác | HTTP 404/403 |
| PAY-08 | CUSTOMER thanh toán lịch của người khác | HTTP 404/403 |
| PAY-09 | Hủy appointment có payment PENDING | Payment → CANCELLED |
| PAY-10 | Hủy appointment có payment PAID | Payment vẫn PAID để chờ refund |
| PAY-11 | ADMIN refund appointment CANCELLED + PAID | Payment → REFUNDED |
| PAY-12 | Refund payment PENDING | Từ chối |
| PAY-13 | Sửa giá service sau khi đặt | `price_at_booking` và `payment.amount` của lịch cũ không đổi |
| PAY-14 | Client gửi amount giả | Backend vẫn dùng `price_at_booking` |
| PAY-15 | Báo cáo tiền đã thu | Chỉ tính payment PAID theo `paid_at`; REFUNDED không còn là PAID |
| PAY-16 | Refresh trang sau thanh toán | Trạng thái payment vẫn được lấy từ SQL Server |

---

## Bổ sung v3 — kiểm thử thủ công sau khi triển khai

| # | Kịch bản | Kết quả mong đợi |
|---|---|---|
| A1 | Admin khóa một khách đang đăng nhập | Request kế tiếp của khách trả 403, giao diện tự về trang đăng nhập (tối đa ~10 giây) |
| A2 | Admin bấm "Kích hoạt lại" ở khách đã khóa | Khách đăng nhập và đặt lịch lại bình thường |
| A3 | Khách đổi mật khẩu ở thiết bị 1 | Thiết bị 1 vẫn dùng tiếp; thiết bị 2 bị đăng xuất |
| A4 | Đăng ký với mật khẩu `123456` | Bị từ chối: tối thiểu 8 ký tự, gồm chữ và số |
| A5 | Gọi `GET /api/staff` khi chưa đăng nhập | Không có `phone`, `email`, `user_id` |
| A6 | Xem đánh giá công khai | Tên khách dạng "Nguyễn A." |
| A7 | Nhân viên mở danh sách khách hàng | Chỉ thấy khách đã từng đặt với mình |
| B1 | Khách yêu cầu đổi lịch sang ngày đã qua / sát giờ | Bị từ chối với thông báo rõ ràng |
| B2 | Admin duyệt yêu cầu đổi lịch mà khung giờ đã trôi qua | Bị chặn, gợi ý từ chối |
| B3 | Duyệt đổi lịch sang nhân viên khác | Khách, nhân viên mới và nhân viên cũ đều nhận thông báo |
| C1 | Nhân viên mới tạo xong, khách đặt lịch tuần sau | Có khung giờ T2–T7, Chủ nhật nghỉ |
| C2 | Admin đặt ngày nghỉ ngoại lệ | Khách không còn thấy khung giờ ngày đó; nhân viên thấy "Nghỉ · Điều chỉnh riêng" |
| C3 | Nhân viên mở tab "Lịch làm việc" | Thấy đủ 14 ngày kèm số lịch hẹn mỗi ngày |

---

# BỔ SUNG V4 — Quy tắc nghiệp vụ mới & trạng thái tự động hóa

Chú thích cột **Tự động**: ✅ unit test (`npm test`, không cần CSDL) · 🔗 test tích hợp (`npm run test:integration`, cần server + SQL Server đã migrate/seed) · ✋ kiểm thử tay.

## L. Chính sách hủy / đổi / hoàn tiền
| ID | Test | Expected | Tự động |
|---|---|---|---|
| POL-01 | Khách hủy lịch CONFIRMED khi còn < 2 giờ | 403, nêu rõ mốc 2 giờ | ✅ `policy.test.js` |
| POL-02 | Khách hủy lịch CONFIRMED khi còn đúng 2 giờ | Cho phép | ✅ |
| POL-03 | Khách hủy lịch PENDING chưa trả tiền sát giờ | Luôn cho phép | ✅ 🔗 |
| POL-04 | Khách hủy lịch PENDING đã trả tiền sát giờ | 403 | ✅ |
| POL-05 | Đổi lịch dùng ngưỡng `RESCHEDULE_MIN_HOURS` riêng | Chặn đúng ngưỡng | ✅ |
| POL-06 | Hủy lịch COMPLETED/CANCELLED/NO_SHOW | Không cho phép | ✅ |
| POL-07 | Hủy lịch đã thanh toán online | Giữ PAID, đặt `refund_requested_at`, báo Admin + khách | ✋ |
| POL-08 | Ghi nhận hoàn tiền không có mã tham chiếu | 400 | 🔗 |
| POL-09 | Ghi nhận hoàn tiền có mã | `REFUNDED`, lưu `refund_reference`, `transaction_code` gốc giữ nguyên | ✋ |
| POL-10 | Lỗi giữa chừng khi khách hủy lịch | Rollback toàn bộ (cùng transaction) | ✋ |

## M. Chống chiếm giờ ảo & tài khoản
| ID | Test | Expected | Tự động |
|---|---|---|---|
| ABU-01 | Khách đã có 3 lịch chờ/sắp tới đặt thêm | 409 | ✅ `rules.test.js` 🔗 |
| ABU-02 | Khách có ≥ 3 lần NO_SHOW trong 90 ngày đặt online | 403 | ✅ |
| ABU-03 | Lịch tại cơ sở PENDING quá 12 giờ | Tự hủy + báo khách | ✅ (quyết định) ✋ (job) |
| ABU-04 | Lịch tại cơ sở PENDING đã qua giờ hẹn | Tự hủy | ✅ |
| ABU-05 | Đăng ký trùng SĐT | 409 | 🔗 |
| ABU-06 | SĐT sai đầu số / thiếu số | 400 | ✅ |
| ABU-07 | `+84 912 345 678` | Chuẩn hóa `0912345678` | ✅ |

## N. Đặt lịch nâng cao
| ID | Test | Expected | Tự động |
|---|---|---|---|
| ADV-01 | Chọn "Bất kỳ nhân viên" | Chọn người rảnh, ít lịch nhất, hòa thì id nhỏ | ✅ (xếp hạng) 🔗 |
| ADV-02 | Người được chọn tự động vừa bị đặt mất | Thử người kế tiếp; hết người → 409 | ✋ |
| ADV-03 | Thời gian đệm 15 phút | Khung giờ sát lịch đã có bị loại | ✅ `rules.test.js` |
| ADV-04 | Hai khách đặt cùng slot đồng thời (= BOOK-09) | 1 × 201, 1 × 409 | 🔗 |
| ADV-05 | Admin tạo lịch hộ khách (walk-in) | CONFIRMED ngay, `source=WALK_IN` | 🔗 |
| ADV-06 | Staff tạo lịch hộ cho nhân viên khác | Không thể (luôn là chính mình) | ✋ |
| ADV-07 | Customer gọi `/appointments/manual` | 403 | 🔗 |
| ADV-08 | Khách vãng lai đăng ký sau bằng cùng SĐT | Gắn vào hồ sơ cũ, giữ lịch sử | ✋ |

## O. Email, nhắc lịch, quên mật khẩu
| ID | Test | Expected | Tự động |
|---|---|---|---|
| MAIL-01 | Chưa cấu hình SMTP | Không lỗi, trả false | ✅ `mailer.test.js` |
| MAIL-02 | SMTP lỗi | Nuốt lỗi, luồng đặt lịch không hỏng | ✅ |
| MAIL-03 | Nhắc lịch: CONFIRMED, chưa nhắc, trong 24h | Gửi 1 lần duy nhất | ✅ (điều kiện) ✋ (job) |
| PWD-01 | Quên mật khẩu với tài khoản tồn tại / không tồn tại | Cùng một thông báo | 🔗 |
| PWD-02 | Token sai / hết hạn / đã dùng | 400 | 🔗 (token sai) ✋ |
| PWD-03 | Đặt lại thành công | Mật khẩu mới dùng được; token cũ + phiên cũ vô hiệu | ✋ |

## P. Xin nghỉ & lịch làm việc
| ID | Test | Expected | Tự động |
|---|---|---|---|
| OFF-01 | Đơn nghỉ ngày quá khứ / đảo ngược / > 30 ngày / sai định dạng | 400 | ✅ `timeoff.test.js` |
| OFF-02 | Duyệt đơn khi nhân viên còn lịch trong khoảng nghỉ | 409 | ✋ |
| OFF-03 | Duyệt đơn hợp lệ | Tạo ngày nghỉ ngoại lệ; khách không đặt được nhân viên | ✋ |
| OFF-04 | Admin đặt ngày nghỉ đã có lịch hẹn | 409 | ✋ |

> Các case ✋ và 🔗 chưa được chạy tự động trong môi trường phát triển của tác giả bản vá này (không có SQL Server). Cần chạy `npm run db:migrate` rồi `npm run test:integration` trên máy có CSDL trước khi bảo vệ.
