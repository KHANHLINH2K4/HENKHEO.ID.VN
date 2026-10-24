USE henkheo;
GO

/* HẸN KHÉO - OPERATIONAL V2
   1) QR thanh toán VietQR + hạn QR + xác nhận nhận tiền
   2) Yêu cầu đổi lịch tách khỏi appointment hiện tại
   3) Index phục vụ truy vấn vận hành
*/

/* ============================================================
   1. PAYMENT QR FIELDS
   ============================================================ */
IF COL_LENGTH('dbo.payments', 'qr_code_url') IS NULL
    ALTER TABLE dbo.payments ADD qr_code_url NVARCHAR(1000) NULL;
GO

IF COL_LENGTH('dbo.payments', 'qr_expires_at') IS NULL
    ALTER TABLE dbo.payments ADD qr_expires_at DATETIME2(0) NULL;
GO

IF COL_LENGTH('dbo.payments', 'customer_claimed_at') IS NULL
    ALTER TABLE dbo.payments ADD customer_claimed_at DATETIME2(0) NULL;
GO

/* Cho phép QR hết hạn */
IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'CK_payments_status'
      AND parent_object_id = OBJECT_ID('dbo.payments')
)
BEGIN
    ALTER TABLE dbo.payments DROP CONSTRAINT CK_payments_status;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'CK_payments_status'
      AND parent_object_id = OBJECT_ID('dbo.payments')
)
BEGIN
    ALTER TABLE dbo.payments
      ADD CONSTRAINT CK_payments_status
      CHECK (payment_status IN ('PENDING','PAID','FAILED','CANCELLED','REFUNDED','EXPIRED'));
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_payments_status_expires'
      AND object_id = OBJECT_ID('dbo.payments')
)
BEGIN
    CREATE INDEX IX_payments_status_expires
      ON dbo.payments(payment_status, qr_expires_at);
END;
GO

/* ============================================================
   2. APPOINTMENT RESCHEDULE REQUESTS
   ============================================================ */
IF OBJECT_ID(N'dbo.appointment_reschedule_requests', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.appointment_reschedule_requests (
        id INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_appointment_reschedule_requests PRIMARY KEY,
        appointment_id INT NOT NULL,
        customer_id INT NOT NULL,
        current_staff_id INT NULL,
        requested_staff_id INT NOT NULL,
        [current_date] DATE NOT NULL,
        current_start_time TIME(0) NOT NULL,
        current_end_time TIME(0) NULL,
        requested_date DATE NOT NULL,
        requested_start_time TIME(0) NOT NULL,
        requested_end_time TIME(0) NULL,
        reason NVARCHAR(500) NULL,
        status VARCHAR(20) NOT NULL
            CONSTRAINT DF_reschedule_requests_status DEFAULT 'REQUESTED',
        reviewed_by INT NULL,
        reviewed_at DATETIME2(0) NULL,
        created_at DATETIME2(0) NOT NULL
            CONSTRAINT DF_reschedule_requests_created_at DEFAULT SYSDATETIME(),
        updated_at DATETIME2(0) NOT NULL
            CONSTRAINT DF_reschedule_requests_updated_at DEFAULT SYSDATETIME(),

        CONSTRAINT FK_reschedule_requests_appointment
            FOREIGN KEY (appointment_id) REFERENCES dbo.appointments(id),
        CONSTRAINT FK_reschedule_requests_customer
            FOREIGN KEY (customer_id) REFERENCES dbo.customers(id),
        CONSTRAINT FK_reschedule_requests_current_staff
            FOREIGN KEY (current_staff_id) REFERENCES dbo.staff(id),
        CONSTRAINT FK_reschedule_requests_requested_staff
            FOREIGN KEY (requested_staff_id) REFERENCES dbo.staff(id),
        CONSTRAINT FK_reschedule_requests_reviewer
            FOREIGN KEY (reviewed_by) REFERENCES dbo.users(id),
        CONSTRAINT CK_reschedule_requests_status
            CHECK (status IN ('REQUESTED','APPROVED','REJECTED','CANCELLED'))
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UX_reschedule_requests_one_pending'
      AND object_id = OBJECT_ID('dbo.appointment_reschedule_requests')
)
BEGIN
    CREATE UNIQUE INDEX UX_reschedule_requests_one_pending
      ON dbo.appointment_reschedule_requests(appointment_id)
      WHERE status = 'REQUESTED';
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_reschedule_requests_status_created'
      AND object_id = OBJECT_ID('dbo.appointment_reschedule_requests')
)
BEGIN
    CREATE INDEX IX_reschedule_requests_status_created
      ON dbo.appointment_reschedule_requests(status, created_at DESC);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_reschedule_requests_staff_status'
      AND object_id = OBJECT_ID('dbo.appointment_reschedule_requests')
)
BEGIN
    CREATE INDEX IX_reschedule_requests_staff_status
      ON dbo.appointment_reschedule_requests(requested_staff_id, status, created_at DESC);
END;
GO

PRINT N'✅ Operational V2 migration: OK';
GO

SELECT
    COL_LENGTH('dbo.payments', 'qr_code_url') AS qr_code_url,
    COL_LENGTH('dbo.payments', 'qr_expires_at') AS qr_expires_at,
    COL_LENGTH('dbo.payments', 'customer_claimed_at') AS customer_claimed_at,
    OBJECT_ID('dbo.appointment_reschedule_requests', 'U') AS appointment_reschedule_requests;
GO
