/* Hẹn Khéo — 006: tăng cường cho môi trường thật. Chạy lại an toàn. */

/* 1. Index phục vụ truy vấn đặt lịch / lịch nhân viên / thống kê */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_appointments_staff_date_status' AND object_id=OBJECT_ID('dbo.appointments'))
    CREATE INDEX IX_appointments_staff_date_status ON dbo.appointments(staff_id, appointment_date, status) INCLUDE (start_time, end_time);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_appointments_customer_date' AND object_id=OBJECT_ID('dbo.appointments'))
    CREATE INDEX IX_appointments_customer_date ON dbo.appointments(customer_id, appointment_date DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_payments_online_pending' AND object_id=OBJECT_ID('dbo.payments'))
    CREATE INDEX IX_payments_online_pending ON dbo.payments(payment_method, payment_status, qr_expires_at);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_appointments_completed_at' AND object_id=OBJECT_ID('dbo.appointments'))
    CREATE INDEX IX_appointments_completed_at ON dbo.appointments(completed_at) INCLUDE (staff_id, service_id, price_at_booking) WHERE status='COMPLETED';
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_payments_paid_at' AND object_id=OBJECT_ID('dbo.payments'))
    CREATE INDEX IX_payments_paid_at ON dbo.payments(paid_at) INCLUDE (appointment_id, amount) WHERE payment_status='PAID';
GO

/* 2. Chốt chặn ở tầng CSDL chống trùng giờ bắt đầu (ngoài kiểm tra chồng lấn trong transaction của backend).
      Chỉ tạo khi dữ liệu hiện có chưa bị trùng, tránh làm migration thất bại. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_appointments_staff_slot_active' AND object_id=OBJECT_ID('dbo.appointments'))
BEGIN
    IF EXISTS (
        SELECT 1 FROM dbo.appointments
        WHERE status IN ('PENDING','CONFIRMED')
        GROUP BY staff_id, appointment_date, start_time
        HAVING COUNT(*) > 1
    )
        PRINT N'⚠ Bỏ qua UX_appointments_staff_slot_active: dữ liệu hiện có đang có lịch trùng giờ, hãy xử lý rồi chạy lại.';
    ELSE
        CREATE UNIQUE INDEX UX_appointments_staff_slot_active
            ON dbo.appointments(staff_id, appointment_date, start_time)
            WHERE status IN ('PENDING','CONFIRMED');
END;
GO

/* 3. Mỗi lịch chỉ có tối đa 1 khoản thanh toán (đã có UNIQUE theo appointment_id); đảm bảo orderCode payOS không trùng */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_payments_provider_order_code' AND object_id=OBJECT_ID('dbo.payments'))
    CREATE UNIQUE INDEX UX_payments_provider_order_code ON dbo.payments(provider_order_code) WHERE provider_order_code IS NOT NULL;
GO

PRINT N'✅ 006_production_hardening: OK';
GO

/* 4. Vô hiệu token cũ khi đổi/đặt lại mật khẩu (lưu UTC) */
IF COL_LENGTH('dbo.users','password_changed_at') IS NULL
    ALTER TABLE dbo.users ADD password_changed_at DATETIME2(0) NULL;
GO
