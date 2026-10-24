# Hẹn Khéo — Kiến trúc nghiệp vụ (V4.1)

```text
                    ┌──────────────┐
                    │     ADMIN    │
                    └──────┬───────┘
                           │ quản trị
                           ↓
 services ↔ staff_services ↔ staff ↔ schedules/exceptions
     │                         │
     └──────────────┬──────────┘
                    ↓
              APPOINTMENTS
                    │
          ┌─────────┼─────────┐
          ↓         ↓         ↓
      PAYMENT    RESCHEDULE  REVIEW
          │         │
          ↓         ↓
       REVENUE   APPROVAL

CUSTOMER → booking → QR/payment → notification → appointment lifecycle
STAFF → assigned appointments → confirm/complete → personal revenue
CHATBOT → NLP intent/entity → service/booking data → chat history
ALL IMPORTANT ACTIONS → activity_logs
```

## Quy tắc cốt lõi
- 1 dịch vụ ↔ nhiều nhân viên qua `staff_services`.
- Slot phải nằm trong ca làm hiệu lực của đúng nhân viên.
- Ngày nghỉ/ngoại lệ có ưu tiên cao hơn lịch mẫu tuần.
- Backend kiểm tra trùng lịch lại trong transaction.
- Đổi lịch là request, không sửa appointment trực tiếp.
- Giá doanh thu lấy từ `price_at_booking`.
- Payment amount phải lấy từ appointment, không tin amount do client gửi.
- Notification lưu DB; Socket.IO chỉ dùng để đẩy realtime.
- STAFF chỉ nhìn/thao tác lịch thuộc tài khoản của mình.
- ADMIN có quyền quản trị toàn hệ thống.
