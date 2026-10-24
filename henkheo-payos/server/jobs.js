/*
 * Việc nền định kỳ (chạy trong tiến trình server, có khóa chống chạy trùng giữa nhiều instance).
 *  - Hủy lịch "thanh toán tại cơ sở" chưa được xác nhận quá hạn
 *  - Gửi nhắc lịch (trong ứng dụng + email)
 *  - Dọn dữ liệu cũ (chat, token đặt lại mật khẩu, thông báo đã đọc) theo thời hạn lưu trữ
 */
import { poolPromise, sql } from "./db.js";
import { policyConfig, isStorePendingExpired, shouldSendReminder } from "./policy.js";
import { addDaysISO } from "./scheduleResolver.js";
import { sendMail, mailTemplates } from "./mailer.js";
import { addNotification } from "./notify.js";
import { logger } from "./logger.js";
import { toDate, toTime, localToday, emitAppointmentsChanged } from "./routes/appointments.js";


/** Tự hủy lịch "thanh toán tại cơ sở" chưa được xác nhận quá hạn / đã qua giờ hẹn để nhả khung giờ. */
export async function expireUnconfirmedStoreAppointments() {
  try {
    const pool = await poolPromise;
    const rows = await pool.request().query(`
      SELECT a.id, a.appointment_code, a.appointment_date, a.start_time,
             DATEDIFF(MINUTE, a.created_at, SYSDATETIME()) AS minutes_since_created,
             c.user_id AS customer_user_id, c.full_name AS customer_name, c.email AS customer_email,
             st.user_id AS staff_user_id
      FROM dbo.appointments a
      INNER JOIN dbo.payments p ON p.appointment_id=a.id AND p.payment_method='AT_STORE'
      INNER JOIN dbo.customers c ON c.id=a.customer_id
      LEFT JOIN dbo.staff st ON st.id=a.staff_id
      WHERE a.status='PENDING' AND a.source IN ('ONLINE','CHAT')
    `);
    let cancelled = 0;
    for (const row of rows.recordset) {
      const reason = isStorePendingExpired({ minutesSinceCreated: row.minutes_since_created, date: toDate(row.appointment_date), time: toTime(row.start_time) });
      if (!reason) continue;
      const tx = new sql.Transaction(pool);
      try {
        await tx.begin();
        const upd = await new sql.Request(tx).input("id", sql.Int, row.id).input("reason", sql.NVarChar, `Tự động hủy: ${reason}`).query(`
          UPDATE dbo.appointments SET status='CANCELLED', cancelled_at=SYSDATETIME(), cancellation_reason=@reason, updated_at=SYSDATETIME()
          WHERE id=@id AND status='PENDING'
        `);
        if (!upd.rowsAffected[0]) { await tx.rollback(); continue; }
        await new sql.Request(tx).input("id", sql.Int, row.id).input("reason", sql.NVarChar, `Tự động hủy: ${reason}`).query(`
          INSERT INTO dbo.appointment_status_history(appointment_id, old_status, new_status, changed_by, reason) VALUES(@id,'PENDING','CANCELLED',NULL,@reason);
          UPDATE dbo.payments SET payment_status='CANCELLED', updated_at=SYSDATETIME() WHERE appointment_id=@id AND payment_status='PENDING';
        `);
        await tx.commit();
      } catch (e) {
        try { await tx.rollback(); } catch { /* bỏ qua */ }
        console.warn("Hủy lịch quá hạn lỗi:", e?.message || e);
        continue;
      }
      cancelled += 1;
      const message = `Lịch ${row.appointment_code} đã tự động hủy vì chưa được cơ sở xác nhận kịp thời. Bạn có thể đặt lại khung giờ khác.`;
      await addNotification(pool, row.customer_user_id, "Lịch hẹn đã tự động hủy", message, "APPOINTMENT_CANCELLED");
      await addNotification(pool, row.staff_user_id, "Lịch chờ đã tự động hủy", `Lịch ${row.appointment_code} quá hạn xác nhận nên đã được hủy.`, "APPOINTMENT_CANCELLED");
      void sendMail({ to: row.customer_email, ...mailTemplates.statusChanged({ name: row.customer_name, code: row.appointment_code, statusText: "đã tự động hủy do chưa được xác nhận kịp thời" }) });
    }
    if (cancelled) await emitAppointmentsChanged();
    return cancelled;
  } catch (error) {
    console.error("expireUnconfirmedStoreAppointments:", error);
    return 0;
  }
}

/** Gửi nhắc lịch (thông báo trong ứng dụng + email) cho lịch đã xác nhận sắp diễn ra. */
export async function sendAppointmentReminders() {
  try {
    const pool = await poolPromise;
    const cfg = policyConfig();
    const today = localToday();
    const rows = await pool.request()
      .input("from", sql.Date, today)
      .input("to", sql.Date, addDaysISO(today, Math.ceil(cfg.reminderHours / 24) + 1))
      .query(`
        SELECT a.id, a.appointment_code, a.appointment_date, a.start_time, a.status, a.reminder_sent_at,
               c.user_id AS customer_user_id, c.full_name AS customer_name, c.email AS customer_email,
               s.name AS service_name, st.full_name AS staff_name
        FROM dbo.appointments a
        INNER JOIN dbo.customers c ON c.id=a.customer_id
        INNER JOIN dbo.services s ON s.id=a.service_id
        LEFT JOIN dbo.staff st ON st.id=a.staff_id
        WHERE a.status='CONFIRMED' AND a.reminder_sent_at IS NULL AND a.appointment_date BETWEEN @from AND @to
      `);
    let sent = 0;
    for (const row of rows.recordset) {
      const date = toDate(row.appointment_date);
      const time = toTime(row.start_time);
      if (!shouldSendReminder({ date, time, status: row.status, reminderSentAt: row.reminder_sent_at })) continue;
      const claim = await pool.request().input("id", sql.Int, row.id)
        .query("UPDATE dbo.appointments SET reminder_sent_at=SYSDATETIME() WHERE id=@id AND reminder_sent_at IS NULL");
      if (!claim.rowsAffected[0]) continue; // tiến trình khác đã nhắc
      sent += 1;
      await addNotification(pool, row.customer_user_id, "Nhắc lịch hẹn", `Bạn có lịch ${row.service_name} lúc ${time} ngày ${date} với ${row.staff_name || "nhân viên"}.`, "APPOINTMENT_REMINDER");
      void sendMail({ to: row.customer_email, ...mailTemplates.reminder({ name: row.customer_name, code: row.appointment_code, service: row.service_name, date, time, staff: row.staff_name || "—" }) });
    }
    return sent;
  } catch (error) {
    console.error("sendAppointmentReminders:", error);
    return 0;
  }
}


const days = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

/** Xóa dữ liệu quá thời hạn lưu trữ (cấu hình bằng .env, đặt 0 hoặc để mặc định để dùng giá trị mặc định). */
export async function purgeOldData() {
  try {
    const pool = await poolPromise;
    const chatDays = days(process.env.CHAT_RETENTION_DAYS, 180);
    const notifDays = days(process.env.NOTIFICATION_RETENTION_DAYS, 180);
    const r = await pool.request()
      .input("chatDays", sql.Int, chatDays)
      .input("notifDays", sql.Int, notifDays)
      .query(`
        DELETE m FROM dbo.chat_messages m
          INNER JOIN dbo.chat_conversations c ON c.id=m.conversation_id
          WHERE c.updated_at < DATEADD(DAY, -@chatDays, SYSDATETIME());
        DELETE FROM dbo.chat_conversations WHERE updated_at < DATEADD(DAY, -@chatDays, SYSDATETIME())
          AND NOT EXISTS (SELECT 1 FROM dbo.chat_messages m WHERE m.conversation_id=dbo.chat_conversations.id);
        DELETE FROM dbo.password_reset_tokens WHERE expires_at < DATEADD(DAY, -7, SYSUTCDATETIME());
        DELETE FROM dbo.notifications WHERE is_read=1 AND created_at < DATEADD(DAY, -@notifDays, SYSDATETIME());
      `);
    logger.info("Dọn dữ liệu cũ xong", { rowsAffected: r.rowsAffected });
  } catch (error) {
    logger.error("purgeOldData", { err: error });
  }
}
