/*
  Hẹn Khéo — Migration: trạng thái hội thoại đặt lịch qua Chatbot NLP.

  Bổ sung 2 cột cho dbo.chat_conversations để chatbot có thể thực hiện
  "slot-filling" nhiều lượt (multi-turn): thu thập dịch vụ -> ngày -> nhân
  viên -> giờ -> xác nhận, rồi gọi thẳng vào lõi nghiệp vụ đặt lịch
  (createAppointmentCore) giống hệt luồng đặt lịch qua giao diện.

  An toàn để chạy lại nhiều lần (idempotent).
*/
USE henkheo;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.chat_conversations') AND name = 'flow_state'
)
BEGIN
    ALTER TABLE dbo.chat_conversations ADD flow_state VARCHAR(30) NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.chat_conversations') AND name = 'draft_json'
)
BEGIN
    ALTER TABLE dbo.chat_conversations ADD draft_json NVARCHAR(1000) NULL;
END;
GO

PRINT N'✅ Hẹn Khéo — migration_chat_booking_flow: OK';
GO

SELECT
    COL_LENGTH('dbo.chat_conversations','flow_state') AS flow_state,
    COL_LENGTH('dbo.chat_conversations','draft_json') AS draft_json;
GO
