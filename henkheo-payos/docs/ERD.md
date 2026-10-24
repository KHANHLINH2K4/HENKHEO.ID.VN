# Sơ đồ quan hệ thực thể (ERD)

```mermaid
erDiagram
  roles ||--o{ users : "có"
  users ||--o| customers : "hồ sơ khách (user_id có thể NULL = khách vãng lai)"
  users ||--o| staff : "tài khoản nhân viên"
  categories ||--o{ services : "gồm"
  services ||--o{ staff_services : ""
  staff ||--o{ staff_services : "được giao"
  staff ||--o{ staff_schedule_templates : "lịch tuần"
  staff ||--o{ staff_schedule_exceptions : "ngày nghỉ/ca đặc biệt"
  staff ||--o{ staff_time_off_requests : "xin nghỉ"
  customers ||--o{ appointments : "đặt"
  services ||--o{ appointments : ""
  staff ||--o{ appointments : "phục vụ"
  appointments ||--|| payments : "1 khoản thanh toán"
  appointments ||--o{ appointment_status_history : "lịch sử trạng thái"
  appointments ||--o{ appointment_reschedules : "đã đổi"
  appointments ||--o{ appointment_reschedule_requests : "yêu cầu đổi"
  appointments ||--o| reviews : "đánh giá"
  users ||--o{ notifications : ""
  users ||--o{ password_reset_tokens : "quên mật khẩu"
  users ||--o{ activity_logs : "audit"

  appointments {
    int id PK
    varchar appointment_code
    int customer_id FK
    int service_id FK
    int staff_id FK
    date appointment_date
    time start_time
    time end_time
    decimal price_at_booking "giá chốt"
    varchar status "PENDING|CONFIRMED|COMPLETED|CANCELLED|NO_SHOW"
    varchar source "ONLINE|CHAT|WALK_IN|PHONE"
    int created_by_user_id FK
    bit auto_assigned
    datetime reminder_sent_at
  }
  payments {
    int id PK
    int appointment_id FK
    varchar payment_method "AT_STORE|ONLINE"
    varchar payment_status "PENDING|PAID|FAILED|CANCELLED|REFUNDED|EXPIRED"
    varchar provider_order_code "payOS"
    datetime refund_requested_at
    nvarchar refund_reference
    datetime refunded_at
  }
```

## Vòng đời lịch hẹn
```mermaid
stateDiagram-v2
  [*] --> PENDING: khách đặt (online/chat)
  [*] --> CONFIRMED: Admin/Staff tạo hộ khách
  PENDING --> CONFIRMED: cơ sở xác nhận / payOS báo đã trả
  PENDING --> CANCELLED: khách hủy / quá hạn thanh toán / quá hạn chờ xác nhận
  CONFIRMED --> COMPLETED: hoàn thành
  CONFIRMED --> NO_SHOW: khách không đến
  CONFIRMED --> CANCELLED: hủy (khách: trước giờ hẹn ≥ N giờ)
  CANCELLED --> [*]
  COMPLETED --> [*]
  NO_SHOW --> [*]
```

## Luồng đặt lịch + thanh toán online
```mermaid
sequenceDiagram
  participant K as Khách
  participant W as Web (React)
  participant S as Server (Express)
  participant D as SQL Server
  participant P as payOS
  K->>W: chọn dịch vụ, nhân viên (hoặc "Bất kỳ"), ngày, giờ
  W->>S: GET /appointments/booking-options
  S->>D: lịch hiệu lực + lịch đã đặt
  S-->>W: khung giờ trống
  W->>S: POST /appointments
  S->>D: BEGIN SERIALIZABLE; kiểm tra chồng lấn; INSERT lịch + payment
  alt trùng giờ
    S-->>W: 409
  else thành công
    S-->>W: 201 (PENDING)
    opt thanh toán online
      W->>S: POST /payments/:id/payos
      S->>P: tạo link thanh toán
      P-->>S: webhook (chữ ký HMAC)
      S->>D: xác minh chữ ký + số tiền; PAID → lịch CONFIRMED
    end
  end
```
