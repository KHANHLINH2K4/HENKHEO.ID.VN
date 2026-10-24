/*
 * Thông báo trong ứng dụng: lưu CSDL + đẩy realtime qua Socket.IO.
 * Một nơi duy nhất (trước đây bị sao chép ở 4 route).
 */
import { poolPromise, sql } from "./db.js";
import { emitToUser, emitToRole } from "./realtime.js";
import { logger } from "./logger.js";

export async function addNotification(pool, userId, title, message, type = "APPOINTMENT") {
  if (!userId) return;
  try {
    const result = await pool.request()
      .input("userId", sql.Int, Number(userId))
      .input("title", sql.NVarChar, String(title).slice(0, 200))
      .input("message", sql.NVarChar, String(message).slice(0, 1000))
      .input("type", sql.VarChar, String(type).slice(0, 30))
      .query(`
        INSERT INTO dbo.notifications(user_id,title,message,type)
        OUTPUT INSERTED.id, INSERTED.title, INSERTED.message, INSERTED.type, INSERTED.is_read, INSERTED.created_at
        VALUES(@userId,@title,@message,@type)
      `);
    emitToUser(Number(userId), "notification:new", result.recordset[0]);
  } catch (error) {
    logger.error("Lưu thông báo thất bại", { err: error, userId });
  }
}

/** Báo cho mọi ADMIN đang hoạt động; `event` là tên sự kiện realtime gửi tới role ADMIN. */
export async function notifyAdmins(pool, title, message, type = "APPOINTMENT", event = "admin:changed") {
  try {
    const result = await pool.request().query(`
      SELECT id FROM dbo.users
      WHERE is_active=1 AND role_id=(SELECT TOP 1 id FROM dbo.roles WHERE name='ADMIN')
    `);
    await Promise.all(result.recordset.map((x) => addNotification(pool, x.id, title, message, type)));
    emitToRole("ADMIN", event, { title, message, type });
  } catch (error) {
    logger.error("Báo admin thất bại", { err: error });
  }
}

/**
 * Chạy việc phụ (thông báo, email...) SAU khi đã phản hồi/commit, không chặn request
 * và không bao giờ làm hỏng luồng chính. Lỗi chỉ được ghi log.
 */
export function runBackground(label, fn) {
  Promise.resolve()
    .then(fn)
    .catch((err) => logger.error(`Việc nền thất bại: ${label}`, { err }));
}

export { poolPromise };
