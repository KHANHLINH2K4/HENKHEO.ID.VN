USE henkheo;
GO

/* HẸN KHÉO - OPERATIONAL V3
   Mục tiêu:
   - Lịch làm mặc định theo tuần.
   - Ngày nghỉ/ngày ngoại lệ theo từng nhân viên.
   - Không phá dữ liệu staff_schedules hiện có.
   - Có thể chạy lại an toàn.
*/

IF OBJECT_ID(N'dbo.staff_schedule_templates', N'U') IS NULL
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
        CONSTRAINT FK_staff_schedule_templates_staff FOREIGN KEY (staff_id) REFERENCES dbo.staff(id),
        CONSTRAINT CK_staff_schedule_templates_day CHECK (day_of_week BETWEEN 1 AND 7),
        CONSTRAINT CK_staff_schedule_templates_time CHECK (end_time > start_time)
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name='UX_staff_schedule_templates_staff_day'
      AND object_id=OBJECT_ID('dbo.staff_schedule_templates')
)
BEGIN
    CREATE UNIQUE INDEX UX_staff_schedule_templates_staff_day
      ON dbo.staff_schedule_templates(staff_id, day_of_week, start_time, end_time);
END;
GO

IF OBJECT_ID(N'dbo.staff_schedule_exceptions', N'U') IS NULL
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
        CONSTRAINT FK_staff_schedule_exceptions_staff FOREIGN KEY (staff_id) REFERENCES dbo.staff(id),
        CONSTRAINT FK_staff_schedule_exceptions_user FOREIGN KEY (created_by) REFERENCES dbo.users(id),
        CONSTRAINT CK_staff_schedule_exceptions_time CHECK (
            (is_day_off=1 AND start_time IS NULL AND end_time IS NULL)
            OR
            (is_day_off=0 AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
        )
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name='UX_staff_schedule_exceptions_staff_date'
      AND object_id=OBJECT_ID('dbo.staff_schedule_exceptions')
)
BEGIN
    CREATE UNIQUE INDEX UX_staff_schedule_exceptions_staff_date
      ON dbo.staff_schedule_exceptions(staff_id, work_date);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name='IX_staff_schedule_exceptions_date'
      AND object_id=OBJECT_ID('dbo.staff_schedule_exceptions')
)
BEGIN
    CREATE INDEX IX_staff_schedule_exceptions_date
      ON dbo.staff_schedule_exceptions(work_date, staff_id);
END;
GO

/* Seed lịch mặc định cho tất cả nhân viên đang hoạt động:
   T2-T7 08:00-18:00; CN nghỉ.
   Nếu template đã có thì không chèn trùng.
*/
DECLARE @staffId INT;
DECLARE staff_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT id FROM dbo.staff WHERE is_active=1;
OPEN staff_cursor;
FETCH NEXT FROM staff_cursor INTO @staffId;

WHILE @@FETCH_STATUS=0
BEGIN
    DECLARE @day TINYINT=1;
    WHILE @day<=7
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM dbo.staff_schedule_templates
            WHERE staff_id=@staffId AND day_of_week=@day
        )
        BEGIN
            IF @day=7
                INSERT INTO dbo.staff_schedule_templates(staff_id,day_of_week,start_time,end_time,is_working,note)
                VALUES(@staffId,@day,'08:00','18:00',0,N'Nghỉ Chủ nhật');
            ELSE
                INSERT INTO dbo.staff_schedule_templates(staff_id,day_of_week,start_time,end_time,is_working,note)
                VALUES(@staffId,@day,'08:00','18:00',1,N'Lịch làm mặc định 08:00-18:00');
        END;
        SET @day=@day+1;
    END;
    FETCH NEXT FROM staff_cursor INTO @staffId;
END;
CLOSE staff_cursor;
DEALLOCATE staff_cursor;
GO

PRINT N'✅ Operational V3 migration: OK';
GO

SELECT
    (SELECT COUNT(*) FROM dbo.staff_schedule_templates) AS staff_schedule_templates,
    (SELECT COUNT(*) FROM dbo.staff_schedule_exceptions) AS staff_schedule_exceptions;
GO
