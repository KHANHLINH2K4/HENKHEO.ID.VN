USE henkheo;
GO

/* ==============================================================
   HẸN KHÉO - PAYMENT MODULE / MIGRATION AN TOÀN
   - Chạy trên database hiện tại.
   - Không DROP bảng, không xóa users/staff/services/appointments.
   - Có thể chạy lại: các bước tạo bảng/index/constraint đều có kiểm tra.
   ============================================================== */

/* 1. Bảo đảm appointments có giá đã chốt */
IF COL_LENGTH('dbo.appointments', 'price_at_booking') IS NULL
BEGIN
    ALTER TABLE dbo.appointments ADD price_at_booking DECIMAL(12,2) NULL;
END;
GO

UPDATE a
SET price_at_booking = s.price
FROM dbo.appointments a
INNER JOIN dbo.services s ON s.id = a.service_id
WHERE a.price_at_booking IS NULL;
GO

IF COL_LENGTH('dbo.appointments', 'price_at_booking') IS NOT NULL
BEGIN
    ALTER TABLE dbo.appointments ALTER COLUMN price_at_booking DECIMAL(12,2) NOT NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.appointments')
      AND name = 'CK_appointments_price_at_booking'
)
BEGIN
    ALTER TABLE dbo.appointments
    ADD CONSTRAINT CK_appointments_price_at_booking
        CHECK (price_at_booking >= 0);
END;
GO

/* 2. Tạo bảng payments */
IF OBJECT_ID(N'dbo.payments', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.payments (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_payments PRIMARY KEY,
        appointment_id INT NOT NULL CONSTRAINT UQ_payments_appointment UNIQUE,
        payment_code VARCHAR(50) NOT NULL CONSTRAINT UQ_payments_code UNIQUE,
        amount DECIMAL(12,2) NOT NULL,
        payment_method VARCHAR(20) NOT NULL CONSTRAINT DF_payments_method DEFAULT 'AT_STORE',
        payment_status VARCHAR(20) NOT NULL CONSTRAINT DF_payments_status DEFAULT 'PENDING',
        transaction_code VARCHAR(100) NULL,
        paid_at DATETIME2(0) NULL,
        note NVARCHAR(500) NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_payments_created_at DEFAULT SYSDATETIME(),
        updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_payments_updated_at DEFAULT SYSDATETIME(),
        CONSTRAINT FK_payments_appointment FOREIGN KEY (appointment_id) REFERENCES dbo.appointments(id),
        CONSTRAINT CK_payments_amount CHECK (amount >= 0),
        CONSTRAINT CK_payments_method CHECK (payment_method IN ('AT_STORE','ONLINE')),
        CONSTRAINT CK_payments_status CHECK (payment_status IN ('PENDING','PAID','FAILED','CANCELLED','REFUNDED'))
    );
END;
GO

/* 3. Nếu bảng đã tồn tại nhưng thiếu cột thì bổ sung */
IF COL_LENGTH('dbo.payments', 'transaction_code') IS NULL
    ALTER TABLE dbo.payments ADD transaction_code VARCHAR(100) NULL;
GO

IF COL_LENGTH('dbo.payments', 'paid_at') IS NULL
    ALTER TABLE dbo.payments ADD paid_at DATETIME2(0) NULL;
GO

IF COL_LENGTH('dbo.payments', 'note') IS NULL
    ALTER TABLE dbo.payments ADD note NVARCHAR(500) NULL;
GO

IF COL_LENGTH('dbo.payments', 'created_at') IS NULL
    ALTER TABLE dbo.payments ADD created_at DATETIME2(0) NOT NULL CONSTRAINT DF_payments_created_at_runtime DEFAULT SYSDATETIME();
GO

IF COL_LENGTH('dbo.payments', 'updated_at') IS NULL
    ALTER TABLE dbo.payments ADD updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_payments_updated_at_runtime DEFAULT SYSDATETIME();
GO

/* 4. Tạo payment cho appointment hiện có nếu chưa có */
INSERT INTO dbo.payments
    (appointment_id, payment_code, amount, payment_method, payment_status, transaction_code, paid_at, note)
SELECT
    a.id,
    LEFT('HKPAY-' + a.appointment_code, 50),
    a.price_at_booking,
    'AT_STORE',
    CASE
        WHEN a.status = 'COMPLETED' THEN 'PAID'
        WHEN a.status IN ('CANCELLED','NO_SHOW') THEN 'CANCELLED'
        ELSE 'PENDING'
    END,
    CASE
        WHEN a.status = 'COMPLETED' THEN LEFT('HIST-' + a.appointment_code, 100)
        ELSE NULL
    END,
    CASE
        WHEN a.status = 'COMPLETED' THEN COALESCE(a.completed_at, a.updated_at)
        ELSE NULL
    END,
    N'Khởi tạo từ lịch hẹn hiện có khi tích hợp module thanh toán.'
FROM dbo.appointments a
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.payments p WHERE p.appointment_id = a.id
);
GO

/* 5. Index phục vụ báo cáo */
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_payments_status_paid_at'
      AND object_id = OBJECT_ID('dbo.payments')
)
BEGIN
    CREATE INDEX IX_payments_status_paid_at
        ON dbo.payments(payment_status, paid_at);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_payments_method_status'
      AND object_id = OBJECT_ID('dbo.payments')
)
BEGIN
    CREATE INDEX IX_payments_method_status
        ON dbo.payments(payment_method, payment_status);
END;
GO

PRINT N'✅ Migration payment: OK';
GO

SELECT
    payment_status,
    payment_method,
    COUNT(*) AS row_count,
    COALESCE(SUM(amount), 0) AS total_amount
FROM dbo.payments
GROUP BY payment_status, payment_method
ORDER BY payment_status, payment_method;
GO
