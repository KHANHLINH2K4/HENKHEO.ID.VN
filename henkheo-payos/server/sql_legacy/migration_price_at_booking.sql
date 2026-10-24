USE henkheo;
GO

/* HẸN KHÉO - MIGRATION GIÁ TẠI THỜI ĐIỂM ĐẶT LỊCH
   Chạy 1 lần trên database hiện tại. Không xoá appointments. */

IF COL_LENGTH('dbo.appointments', 'price_at_booking') IS NULL
BEGIN
    ALTER TABLE dbo.appointments
    ADD price_at_booking DECIMAL(12,2) NULL;
END;
GO

/* Lịch cũ: lấy giá hiện tại của dịch vụ để tạo dữ liệu lịch sử hợp lệ. */
UPDATE a
SET a.price_at_booking = s.price
FROM dbo.appointments a
INNER JOIN dbo.services s ON s.id = a.service_id
WHERE a.price_at_booking IS NULL;
GO

/* Lịch đã hoàn thành trước khi có cột mới: khôi phục thời điểm hoàn thành
   gần nhất có thể bằng updated_at/created_at để thống kê không bị mất. */
UPDATE dbo.appointments
SET completed_at = COALESCE(completed_at, updated_at, created_at)
WHERE status = 'COMPLETED'
  AND completed_at IS NULL;
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

/* Sau khi backfill thành công, khoá cột để mọi lịch mới bắt buộc có giá. */
IF EXISTS (SELECT 1 FROM dbo.appointments WHERE price_at_booking IS NULL)
BEGIN
    THROW 50001, 'Còn appointments chưa có price_at_booking. Kiểm tra dữ liệu trước khi tiếp tục.', 1;
END;
GO

ALTER TABLE dbo.appointments
ALTER COLUMN price_at_booking DECIMAL(12,2) NOT NULL;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_appointments_completed_at'
      AND object_id = OBJECT_ID('dbo.appointments')
)
BEGIN
    CREATE INDEX IX_appointments_completed_at
    ON dbo.appointments(completed_at, status);
END;
GO

/* Kiểm tra */
SELECT
    COUNT(*) AS total_appointments,
    SUM(CASE WHEN price_at_booking IS NULL THEN 1 ELSE 0 END) AS missing_price_at_booking,
    SUM(CASE WHEN status = 'COMPLETED' AND completed_at IS NULL THEN 1 ELSE 0 END) AS completed_missing_time
FROM dbo.appointments;
GO
