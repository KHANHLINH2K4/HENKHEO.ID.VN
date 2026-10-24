/* ============================================================
   007 — Quy tắc nghiệp vụ bổ sung (V4)
   1. Lịch tạo hộ khách (walk-in / điện thoại), tự phân công nhân viên, nhắc lịch
   2. Hoàn tiền có tham chiếu & người thực hiện
   3. Quên mật khẩu qua email (token băm, hết hạn, dùng một lần)
   4. Nhân viên xin nghỉ -> Admin duyệt -> tự tạo ngày ngoại lệ
   Chạy lại nhiều lần an toàn.
   ============================================================ */

/* ---------- 1. appointments ---------- */
IF COL_LENGTH('dbo.appointments','source') IS NULL
    ALTER TABLE dbo.appointments ADD source VARCHAR(20) NOT NULL CONSTRAINT DF_appointments_source DEFAULT 'ONLINE';
GO
IF COL_LENGTH('dbo.appointments','created_by_user_id') IS NULL
    ALTER TABLE dbo.appointments ADD created_by_user_id INT NULL;
GO
IF COL_LENGTH('dbo.appointments','auto_assigned') IS NULL
    ALTER TABLE dbo.appointments ADD auto_assigned BIT NOT NULL CONSTRAINT DF_appointments_auto_assigned DEFAULT 0;
GO
IF COL_LENGTH('dbo.appointments','reminder_sent_at') IS NULL
    ALTER TABLE dbo.appointments ADD reminder_sent_at DATETIME2(0) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CK_appointments_source' AND parent_object_id=OBJECT_ID('dbo.appointments'))
    ALTER TABLE dbo.appointments ADD CONSTRAINT CK_appointments_source CHECK (source IN ('ONLINE','CHAT','WALK_IN','PHONE'));
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_appointments_created_by' AND parent_object_id=OBJECT_ID('dbo.appointments'))
    ALTER TABLE dbo.appointments ADD CONSTRAINT FK_appointments_created_by FOREIGN KEY (created_by_user_id) REFERENCES dbo.users(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_appointments_status_created' AND object_id=OBJECT_ID('dbo.appointments'))
    CREATE INDEX IX_appointments_status_created ON dbo.appointments(status, created_at) INCLUDE (appointment_date, start_time, reminder_sent_at);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_customers_phone' AND object_id=OBJECT_ID('dbo.customers'))
    CREATE INDEX IX_customers_phone ON dbo.customers(phone);
GO

/* ---------- 2. payments: hoàn tiền ---------- */
IF COL_LENGTH('dbo.payments','refund_requested_at') IS NULL ALTER TABLE dbo.payments ADD refund_requested_at DATETIME2(0) NULL;
GO
IF COL_LENGTH('dbo.payments','refund_reference') IS NULL ALTER TABLE dbo.payments ADD refund_reference NVARCHAR(100) NULL;
GO
IF COL_LENGTH('dbo.payments','refunded_at') IS NULL ALTER TABLE dbo.payments ADD refunded_at DATETIME2(0) NULL;
GO
IF COL_LENGTH('dbo.payments','refunded_by') IS NULL ALTER TABLE dbo.payments ADD refunded_by INT NULL;
GO

/* ---------- 3. Quên mật khẩu ---------- */
IF OBJECT_ID(N'dbo.password_reset_tokens', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.password_reset_tokens (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_password_reset_tokens PRIMARY KEY,
        user_id INT NOT NULL,
        token_hash CHAR(64) NOT NULL CONSTRAINT UQ_password_reset_token_hash UNIQUE,
        expires_at DATETIME2(0) NOT NULL,          -- UTC
        used_at DATETIME2(0) NULL,                 -- UTC
        requested_ip VARCHAR(64) NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_password_reset_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_password_reset_user FOREIGN KEY (user_id) REFERENCES dbo.users(id)
    );
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_password_reset_user' AND object_id=OBJECT_ID('dbo.password_reset_tokens'))
    CREATE INDEX IX_password_reset_user ON dbo.password_reset_tokens(user_id, created_at DESC);
GO

/* ---------- 4. Nhân viên xin nghỉ ---------- */
IF OBJECT_ID(N'dbo.staff_time_off_requests', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.staff_time_off_requests (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_staff_time_off_requests PRIMARY KEY,
        staff_id INT NOT NULL,
        date_from DATE NOT NULL,
        date_to DATE NOT NULL,
        reason NVARCHAR(500) NULL,
        status VARCHAR(20) NOT NULL CONSTRAINT DF_time_off_status DEFAULT 'REQUESTED',
        reviewed_by INT NULL,
        reviewed_at DATETIME2(0) NULL,
        review_note NVARCHAR(500) NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_time_off_created DEFAULT SYSDATETIME(),
        updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_time_off_updated DEFAULT SYSDATETIME(),
        CONSTRAINT FK_time_off_staff FOREIGN KEY (staff_id) REFERENCES dbo.staff(id),
        CONSTRAINT FK_time_off_reviewer FOREIGN KEY (reviewed_by) REFERENCES dbo.users(id),
        CONSTRAINT CK_time_off_status CHECK (status IN ('REQUESTED','APPROVED','REJECTED','CANCELLED')),
        CONSTRAINT CK_time_off_range CHECK (date_to >= date_from)
    );
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_time_off_staff_status' AND object_id=OBJECT_ID('dbo.staff_time_off_requests'))
    CREATE INDEX IX_time_off_staff_status ON dbo.staff_time_off_requests(staff_id, status, date_from);
GO
