USE henkheo;
GO

/* ==============================================================
   HẸN KHÉO - OPERATIONAL V3 COMPLETE
   Mục tiêu:
   1. Đảm bảo price_at_booking + completed_at lịch cũ.
   2. Đảm bảo payment + QR fields + EXPIRED.
   3. Yêu cầu đổi lịch có approval workflow.
   4. Lịch làm mặc định theo tuần.
   5. Ngày nghỉ/ca ngoại lệ theo từng nhân viên.
   6. Index phục vụ notification/audit/chat/revenue.

   Script có thể chạy lại. Không DROP dữ liệu nghiệp vụ chính.
   ============================================================= */

/* ---------- 1. Giá chốt lịch ---------- */
IF COL_LENGTH('dbo.appointments','price_at_booking') IS NULL
BEGIN
    ALTER TABLE dbo.appointments ADD price_at_booking DECIMAL(12,2) NULL;
END;
GO

UPDATE a
SET price_at_booking=s.price
FROM dbo.appointments a
JOIN dbo.services s ON s.id=a.service_id
WHERE a.price_at_booking IS NULL;
GO

UPDATE dbo.appointments
SET completed_at=COALESCE(completed_at,updated_at,created_at)
WHERE status='COMPLETED' AND completed_at IS NULL;
GO

IF EXISTS (SELECT 1 FROM dbo.appointments WHERE price_at_booking IS NULL)
    THROW 50001, 'Còn lịch hẹn chưa có price_at_booking. Kiểm tra dữ liệu trước khi tiếp tục.', 1;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id=OBJECT_ID('dbo.appointments')
      AND name='CK_appointments_price_at_booking'
)
BEGIN
    ALTER TABLE dbo.appointments
      ADD CONSTRAINT CK_appointments_price_at_booking CHECK(price_at_booking>=0);
END;
GO

ALTER TABLE dbo.appointments ALTER COLUMN price_at_booking DECIMAL(12,2) NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_appointments_completed_at' AND object_id=OBJECT_ID('dbo.appointments'))
    CREATE INDEX IX_appointments_completed_at ON dbo.appointments(completed_at,status);
GO

/* ---------- 2. Payments ---------- */
IF OBJECT_ID(N'dbo.payments',N'U') IS NULL
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
        qr_code_url NVARCHAR(1000) NULL,
        qr_expires_at DATETIME2(0) NULL,
        customer_claimed_at DATETIME2(0) NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_payments_created_at DEFAULT SYSDATETIME(),
        updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_payments_updated_at DEFAULT SYSDATETIME(),
        CONSTRAINT FK_payments_appointment FOREIGN KEY(appointment_id) REFERENCES dbo.appointments(id),
        CONSTRAINT CK_payments_amount CHECK(amount>=0),
        CONSTRAINT CK_payments_method CHECK(payment_method IN ('AT_STORE','ONLINE')),
        CONSTRAINT CK_payments_status CHECK(payment_status IN ('PENDING','PAID','FAILED','CANCELLED','REFUNDED','EXPIRED'))
    );
END;
GO

IF COL_LENGTH('dbo.payments','qr_code_url') IS NULL ALTER TABLE dbo.payments ADD qr_code_url NVARCHAR(1000) NULL;
GO
IF COL_LENGTH('dbo.payments','qr_expires_at') IS NULL ALTER TABLE dbo.payments ADD qr_expires_at DATETIME2(0) NULL;
GO
IF COL_LENGTH('dbo.payments','customer_claimed_at') IS NULL ALTER TABLE dbo.payments ADD customer_claimed_at DATETIME2(0) NULL;
GO
IF COL_LENGTH('dbo.payments','transaction_code') IS NULL ALTER TABLE dbo.payments ADD transaction_code VARCHAR(100) NULL;
GO
IF COL_LENGTH('dbo.payments','paid_at') IS NULL ALTER TABLE dbo.payments ADD paid_at DATETIME2(0) NULL;
GO
IF COL_LENGTH('dbo.payments','note') IS NULL ALTER TABLE dbo.payments ADD note NVARCHAR(500) NULL;
GO
IF COL_LENGTH('dbo.payments','created_at') IS NULL ALTER TABLE dbo.payments ADD created_at DATETIME2(0) NOT NULL CONSTRAINT DF_payments_created_at_v3 DEFAULT SYSDATETIME();
GO
IF COL_LENGTH('dbo.payments','updated_at') IS NULL ALTER TABLE dbo.payments ADD updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_payments_updated_at_v3 DEFAULT SYSDATETIME();
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.payments') AND name='CK_payments_status')
    ALTER TABLE dbo.payments DROP CONSTRAINT CK_payments_status;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.payments') AND name='CK_payments_status')
BEGIN
    ALTER TABLE dbo.payments ADD CONSTRAINT CK_payments_status CHECK(payment_status IN ('PENDING','PAID','FAILED','CANCELLED','REFUNDED','EXPIRED'));
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_payments_status_expires' AND object_id=OBJECT_ID('dbo.payments'))
    CREATE INDEX IX_payments_status_expires ON dbo.payments(payment_status,qr_expires_at);
GO

/* Tạo payment còn thiếu cho appointment hiện có. */
INSERT INTO dbo.payments(appointment_id,payment_code,amount,payment_method,payment_status,transaction_code,paid_at,note)
SELECT a.id,LEFT('HKPAY-'+a.appointment_code,50),a.price_at_booking,'AT_STORE',
       CASE WHEN a.status='COMPLETED' THEN 'PAID' WHEN a.status IN('CANCELLED','NO_SHOW') THEN 'CANCELLED' ELSE 'PENDING' END,
       CASE WHEN a.status='COMPLETED' THEN LEFT('HIST-'+a.appointment_code,100) ELSE NULL END,
       CASE WHEN a.status='COMPLETED' THEN COALESCE(a.completed_at,a.updated_at) ELSE NULL END,
       N'Khởi tạo từ lịch hẹn trước khi bật module thanh toán.'
FROM dbo.appointments a
WHERE NOT EXISTS(SELECT 1 FROM dbo.payments p WHERE p.appointment_id=a.id);
GO

/* ---------- 2B. Chatbot history ---------- */
IF OBJECT_ID(N'dbo.chat_conversations',N'U') IS NULL
BEGIN
    CREATE TABLE dbo.chat_conversations (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_chat_conversations PRIMARY KEY,
        user_id INT NULL,
        title NVARCHAR(200) NULL,
        status VARCHAR(20) NOT NULL CONSTRAINT DF_chat_conversations_status DEFAULT 'OPEN',
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_chat_conversations_created_at DEFAULT SYSDATETIME(),
        updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_chat_conversations_updated_at DEFAULT SYSDATETIME(),
        CONSTRAINT FK_chat_conversations_user FOREIGN KEY(user_id) REFERENCES dbo.users(id),
        CONSTRAINT CK_chat_conversations_status CHECK(status IN('OPEN','CLOSED'))
    );
END;
GO

IF OBJECT_ID(N'dbo.chat_messages',N'U') IS NULL
BEGIN
    CREATE TABLE dbo.chat_messages (
        id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_chat_messages PRIMARY KEY,
        conversation_id INT NOT NULL,
        role VARCHAR(20) NOT NULL,
        message NVARCHAR(4000) NOT NULL,
        intent VARCHAR(50) NULL,
        confidence DECIMAL(5,4) NULL,
        entities_json NVARCHAR(2000) NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_chat_messages_created_at DEFAULT SYSDATETIME(),
        CONSTRAINT FK_chat_messages_conversation FOREIGN KEY(conversation_id) REFERENCES dbo.chat_conversations(id),
        CONSTRAINT CK_chat_messages_role CHECK(role IN('user','assistant'))
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_chat_messages_conversation_created' AND object_id=OBJECT_ID('dbo.chat_messages'))
    CREATE INDEX IX_chat_messages_conversation_created ON dbo.chat_messages(conversation_id,created_at);
GO

/* ---------- 3. Reschedule ---------- */
IF OBJECT_ID(N'dbo.appointment_reschedules',N'U') IS NULL
BEGIN
    CREATE TABLE dbo.appointment_reschedules (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_appointment_reschedules PRIMARY KEY,
        appointment_id INT NOT NULL,
        old_date DATE NOT NULL,
        old_start_time TIME(0) NOT NULL,
        old_end_time TIME(0) NULL,
        new_date DATE NOT NULL,
        new_start_time TIME(0) NOT NULL,
        new_end_time TIME(0) NULL,
        changed_by INT NULL,
        reason NVARCHAR(500) NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_appointment_reschedules_created_at DEFAULT SYSDATETIME(),
        CONSTRAINT FK_appointment_reschedules_appointment FOREIGN KEY(appointment_id) REFERENCES dbo.appointments(id),
        CONSTRAINT FK_appointment_reschedules_user FOREIGN KEY(changed_by) REFERENCES dbo.users(id)
    );
END;
GO

IF OBJECT_ID(N'dbo.appointment_reschedule_requests',N'U') IS NULL
BEGIN
    CREATE TABLE dbo.appointment_reschedule_requests (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_appointment_reschedule_requests PRIMARY KEY,
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
        status VARCHAR(20) NOT NULL CONSTRAINT DF_reschedule_requests_status DEFAULT 'REQUESTED',
        reviewed_by INT NULL,
        reviewed_at DATETIME2(0) NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_reschedule_requests_created_at DEFAULT SYSDATETIME(),
        updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_reschedule_requests_updated_at DEFAULT SYSDATETIME(),
        CONSTRAINT FK_reschedule_requests_appointment FOREIGN KEY(appointment_id) REFERENCES dbo.appointments(id),
        CONSTRAINT FK_reschedule_requests_customer FOREIGN KEY(customer_id) REFERENCES dbo.customers(id),
        CONSTRAINT FK_reschedule_requests_current_staff FOREIGN KEY(current_staff_id) REFERENCES dbo.staff(id),
        CONSTRAINT FK_reschedule_requests_requested_staff FOREIGN KEY(requested_staff_id) REFERENCES dbo.staff(id),
        CONSTRAINT FK_reschedule_requests_reviewer FOREIGN KEY(reviewed_by) REFERENCES dbo.users(id),
        CONSTRAINT CK_reschedule_requests_status CHECK(status IN('REQUESTED','APPROVED','REJECTED','CANCELLED'))
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_reschedule_requests_one_pending' AND object_id=OBJECT_ID('dbo.appointment_reschedule_requests'))
    CREATE UNIQUE INDEX UX_reschedule_requests_one_pending ON dbo.appointment_reschedule_requests(appointment_id) WHERE status='REQUESTED';
GO

/* ---------- 4. Lịch mặc định theo tuần ---------- */
IF OBJECT_ID(N'dbo.staff_schedule_templates',N'U') IS NULL
BEGIN
    CREATE TABLE dbo.staff_schedule_templates (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_staff_schedule_templates PRIMARY KEY,
        staff_id INT NOT NULL,
        day_of_week TINYINT NOT NULL,
        start_time TIME(0) NOT NULL,
        end_time TIME(0) NOT NULL,
        is_working BIT NOT NULL CONSTRAINT DF_staff_schedule_templates_is_working DEFAULT 1,
        note NVARCHAR(255) NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_staff_schedule_templates_created_at DEFAULT SYSDATETIME(),
        updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_staff_schedule_templates_updated_at DEFAULT SYSDATETIME(),
        CONSTRAINT FK_staff_schedule_templates_staff FOREIGN KEY(staff_id) REFERENCES dbo.staff(id),
        CONSTRAINT CK_staff_schedule_templates_day CHECK(day_of_week BETWEEN 1 AND 7),
        CONSTRAINT CK_staff_schedule_templates_time CHECK(end_time>start_time)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_staff_schedule_templates_staff_day' AND object_id=OBJECT_ID('dbo.staff_schedule_templates'))
    CREATE UNIQUE INDEX UX_staff_schedule_templates_staff_day ON dbo.staff_schedule_templates(staff_id,day_of_week);
GO

/* ---------- 5. Ngày ngoại lệ / nghỉ ---------- */
IF OBJECT_ID(N'dbo.staff_schedule_exceptions',N'U') IS NULL
BEGIN
    CREATE TABLE dbo.staff_schedule_exceptions (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_staff_schedule_exceptions PRIMARY KEY,
        staff_id INT NOT NULL,
        work_date DATE NOT NULL,
        is_day_off BIT NOT NULL CONSTRAINT DF_staff_schedule_exceptions_day_off DEFAULT 1,
        start_time TIME(0) NULL,
        end_time TIME(0) NULL,
        reason NVARCHAR(500) NULL,
        created_by INT NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_staff_schedule_exceptions_created_at DEFAULT SYSDATETIME(),
        updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_staff_schedule_exceptions_updated_at DEFAULT SYSDATETIME(),
        CONSTRAINT FK_staff_schedule_exceptions_staff FOREIGN KEY(staff_id) REFERENCES dbo.staff(id),
        CONSTRAINT FK_staff_schedule_exceptions_user FOREIGN KEY(created_by) REFERENCES dbo.users(id),
        CONSTRAINT CK_staff_schedule_exceptions_time CHECK(
            (is_day_off=1 AND start_time IS NULL AND end_time IS NULL)
            OR
            (is_day_off=0 AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time>start_time)
        )
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_staff_schedule_exceptions_staff_date' AND object_id=OBJECT_ID('dbo.staff_schedule_exceptions'))
    CREATE UNIQUE INDEX UX_staff_schedule_exceptions_staff_date ON dbo.staff_schedule_exceptions(staff_id,work_date);
GO

/* ---------- 6. Seed lịch tuần mặc định cho nhân viên hiện có ---------- */
DECLARE @staffId INT;
DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT id FROM dbo.staff WHERE is_active=1;
OPEN c; FETCH NEXT FROM c INTO @staffId;
WHILE @@FETCH_STATUS=0
BEGIN
    DECLARE @day TINYINT=1;
    WHILE @day<=7
    BEGIN
        IF NOT EXISTS(SELECT 1 FROM dbo.staff_schedule_templates WHERE staff_id=@staffId AND day_of_week=@day)
        BEGIN
            INSERT INTO dbo.staff_schedule_templates(staff_id,day_of_week,start_time,end_time,is_working,note)
            VALUES(@staffId,@day,'08:00','18:00',CASE WHEN @day=7 THEN 0 ELSE 1 END,CASE WHEN @day=7 THEN N'Nghỉ Chủ nhật' ELSE N'Lịch mặc định 08:00-18:00' END);
        END;
        SET @day=@day+1;
    END;
    FETCH NEXT FROM c INTO @staffId;
END;
CLOSE c; DEALLOCATE c;
GO

/* ---------- 7. Index vận hành ---------- */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_notifications_user_read_created' AND object_id=OBJECT_ID('dbo.notifications'))
    CREATE INDEX IX_notifications_user_read_created ON dbo.notifications(user_id,is_read,created_at DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_activity_logs_created' AND object_id=OBJECT_ID('dbo.activity_logs'))
    CREATE INDEX IX_activity_logs_created ON dbo.activity_logs(created_at DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_reviews_customer_created' AND object_id=OBJECT_ID('dbo.reviews'))
    CREATE INDEX IX_reviews_customer_created ON dbo.reviews(customer_id,created_at DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_chat_messages_conversation_created' AND object_id=OBJECT_ID('dbo.chat_messages'))
    CREATE INDEX IX_chat_messages_conversation_created ON dbo.chat_messages(conversation_id,created_at);
GO

PRINT N'✅ Hẹn Khéo Operational V3 Complete: OK';
GO

SELECT
    COL_LENGTH('dbo.appointments','price_at_booking') AS price_at_booking,
    OBJECT_ID('dbo.payments','U') AS payments,
    OBJECT_ID('dbo.appointment_reschedule_requests','U') AS appointment_reschedule_requests,
    OBJECT_ID('dbo.staff_schedule_templates','U') AS staff_schedule_templates,
    OBJECT_ID('dbo.staff_schedule_exceptions','U') AS staff_schedule_exceptions,
    OBJECT_ID('dbo.chat_conversations','U') AS chat_conversations,
    OBJECT_ID('dbo.chat_messages','U') AS chat_messages;
GO
