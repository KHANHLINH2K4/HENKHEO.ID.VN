USE henkheo;
GO

/* ==============================================================
   HẸN KHÉO - MIGRATION HOÀN THIỆN CHỨC NĂNG
   Chạy 1 lần trên database hiện tại.
   Không xóa dữ liệu appointments, users, staff, services.
   ============================================================= */

IF COL_LENGTH('dbo.appointments','price_at_booking') IS NULL
BEGIN
    ALTER TABLE dbo.appointments ADD price_at_booking DECIMAL(12,2) NULL;
END;
GO

UPDATE a
SET price_at_booking = s.price
FROM dbo.appointments a
INNER JOIN dbo.services s ON s.id=a.service_id
WHERE a.price_at_booking IS NULL;
GO

IF COL_LENGTH('dbo.appointments','price_at_booking') IS NOT NULL
BEGIN
    ALTER TABLE dbo.appointments ALTER COLUMN price_at_booking DECIMAL(12,2) NOT NULL;
END;
GO

IF COL_LENGTH('dbo.appointments','price_at_booking') IS NOT NULL
AND NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints cc
    WHERE cc.parent_object_id=OBJECT_ID('dbo.appointments')
      AND cc.name='CK_appointments_price_at_booking'
)
BEGIN
    ALTER TABLE dbo.appointments
    ADD CONSTRAINT CK_appointments_price_at_booking CHECK (price_at_booking >= 0);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name='IX_appointments_completed_at'
      AND object_id=OBJECT_ID('dbo.appointments')
)
BEGIN
    CREATE INDEX IX_appointments_completed_at ON dbo.appointments(completed_at, status);
END;
GO

IF OBJECT_ID(N'dbo.appointment_reschedules', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.appointment_reschedules (
        id INT IDENTITY(1,1) PRIMARY KEY,
        appointment_id INT NOT NULL,
        old_date DATE NOT NULL,
        old_start_time TIME(0) NOT NULL,
        old_end_time TIME(0) NULL,
        new_date DATE NOT NULL,
        new_start_time TIME(0) NOT NULL,
        new_end_time TIME(0) NULL,
        changed_by INT NULL,
        reason NVARCHAR(500) NULL,
        created_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT FK_appointment_reschedules_appointment FOREIGN KEY (appointment_id) REFERENCES dbo.appointments(id),
        CONSTRAINT FK_appointment_reschedules_user FOREIGN KEY (changed_by) REFERENCES dbo.users(id)
    );
END;
GO

IF OBJECT_ID(N'dbo.chat_conversations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.chat_conversations (
        id INT IDENTITY(1,1) PRIMARY KEY,
        user_id INT NULL,
        title NVARCHAR(200) NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
        created_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME(),
        updated_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT FK_chat_conversations_user FOREIGN KEY (user_id) REFERENCES dbo.users(id),
        CONSTRAINT CK_chat_conversations_status CHECK (status IN ('OPEN','CLOSED'))
    );
END;
GO

IF OBJECT_ID(N'dbo.chat_messages', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.chat_messages (
        id BIGINT IDENTITY(1,1) PRIMARY KEY,
        conversation_id INT NOT NULL,
        role VARCHAR(20) NOT NULL,
        message NVARCHAR(4000) NOT NULL,
        intent VARCHAR(50) NULL,
        confidence DECIMAL(5,4) NULL,
        entities_json NVARCHAR(2000) NULL,
        created_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT FK_chat_messages_conversation FOREIGN KEY (conversation_id) REFERENCES dbo.chat_conversations(id),
        CONSTRAINT CK_chat_messages_role CHECK (role IN ('user','assistant'))
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_chat_messages_conversation_created' AND object_id=OBJECT_ID('dbo.chat_messages'))
BEGIN
    CREATE INDEX IX_chat_messages_conversation_created ON dbo.chat_messages(conversation_id, created_at);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_notifications_user_read_created' AND object_id=OBJECT_ID('dbo.notifications'))
BEGIN
    CREATE INDEX IX_notifications_user_read_created ON dbo.notifications(user_id, is_read, created_at DESC);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_activity_logs_created' AND object_id=OBJECT_ID('dbo.activity_logs'))
BEGIN
    CREATE INDEX IX_activity_logs_created ON dbo.activity_logs(created_at DESC);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_reviews_customer_created' AND object_id=OBJECT_ID('dbo.reviews'))
BEGIN
    CREATE INDEX IX_reviews_customer_created ON dbo.reviews(customer_id, created_at DESC);
END;
GO

PRINT N'✅ Migration hoàn thiện chức năng đã chạy xong.';
GO
