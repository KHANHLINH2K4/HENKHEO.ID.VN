import { Router } from "express";
import { poolPromise, sql } from "../db.js";
import { authenticateToken, requireAdmin } from "../middleware/authMiddleware.js";
import { writeAudit } from "../utils_audit.js";
import { getEffectiveScheduleRange, isValidISODate, addDaysISO } from "../scheduleResolver.js";

const router = Router();

function mapTime(v) {
  if (v == null) return "";
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
  }
  const s = String(v);
  return /^\d{2}:\d{2}/.test(s) ? s.slice(0, 5) : "";
}

function validTime(t) {
  return /^\d{2}:\d{2}$/.test(t)
    && Number(t.slice(0, 2)) < 24
    && Number(t.slice(3, 5)) < 60;
}

export async function upsertException(pool, { staffId, workDate, isDayOff, start, end, reason, createdBy }) {
  await pool.request()
    .input("staffId", sql.Int, staffId)
    .input("workDate", sql.Date, workDate)
    .input("isDayOff", sql.Bit, isDayOff)
    .input("start", sql.VarChar, isDayOff ? null : start)
    .input("end", sql.VarChar, isDayOff ? null : end)
    .input("reason", sql.NVarChar, String(reason).slice(0, 500))
    .input("createdBy", sql.Int, Number(createdBy))
    .query(`
      UPDATE dbo.staff_schedule_exceptions
      SET is_day_off=@isDayOff,start_time=@start,end_time=@end,reason=@reason,created_by=@createdBy,updated_at=SYSDATETIME()
      WHERE staff_id=@staffId AND work_date=@workDate;
      IF @@ROWCOUNT=0
      BEGIN
        INSERT INTO dbo.staff_schedule_exceptions(staff_id,work_date,is_day_off,start_time,end_time,reason,created_by)
        VALUES(@staffId,@workDate,@isDayOff,@start,@end,@reason,@createdBy);
      END
    `);
}

/*
 * GET /api/staff-schedules?staffId=&from=&to=
 * Lịch làm VIỆC HIỆU LỰC từng ngày (ngoại lệ > lịch tuần > lịch cũ) — cùng nguồn dữ liệu
 * mà màn hình đặt lịch và cổng nhân viên đang dùng, để Admin thấy đúng điều khách sẽ thấy.
 */
router.get("/", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const staffId = Number(req.query.staffId);
    if (!Number.isInteger(staffId) || staffId <= 0) {
      return res.status(400).json({ message: "staffId không hợp lệ." });
    }
    const today = new Date().toLocaleDateString("en-CA");
    const from = isValidISODate(req.query.from) ? String(req.query.from) : today;
    let to = isValidISODate(req.query.to) ? String(req.query.to) : addDaysISO(from, 29);
    if (to < from) to = from;
    if (to > addDaysISO(from, 92)) to = addDaysISO(from, 92);

    const pool = await poolPromise;
    const days = await getEffectiveScheduleRange(pool, staffId, from, to);
    res.json(days.map((d) => ({
      work_date: d.date,
      weekday: d.weekday,
      is_available: d.is_working,
      day_type: d.is_working ? "WORK" : "OFF",
      shifts: d.shifts,
      start_time: d.shifts[0]?.start_time || "",
      end_time: d.shifts[d.shifts.length - 1]?.end_time || "",
      source: d.source,
      note: d.note,
    })));
  } catch (error) {
    console.error("GET admin schedules:", error);
    res.status(500).json({ message: "Không tải được lịch làm việc." });
  }
});

/*
 * PUT /api/staff-schedules  (giữ để tương thích API cũ)
 * Ghi vào bảng NGOẠI LỆ theo ngày, vì đó là tầng có ưu tiên cao nhất và là tầng mà
 * bộ xử lý lịch thực sự đọc. (Bảng staff_schedules cũ không còn được ghi nữa.)
 */
router.put("/", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const staffId = Number(req.body?.staffId);
    const workDate = String(req.body?.workDate || "").trim();
    const isDayOff = req.body?.isAllDayOff === true || req.body?.isAvailable !== true;
    const start = String(req.body?.startTime || "08:00").trim();
    const end = String(req.body?.endTime || "18:00").trim();
    const reason = String(req.body?.note || "").trim() || (isDayOff ? "Nghỉ cả ngày" : "Điều chỉnh ca làm");

    if (!Number.isInteger(staffId) || staffId <= 0 || !isValidISODate(workDate)) {
      return res.status(400).json({ message: "Thông tin ngày làm việc không hợp lệ." });
    }
    if (!isDayOff) {
      if (!validTime(start) || !validTime(end) || start >= end) {
        return res.status(400).json({ message: "Giờ kết thúc phải lớn hơn giờ bắt đầu." });
      }
      if (start < "08:00" || end > "18:00") {
        return res.status(400).json({ message: "Ca làm trong hệ thống hiện giới hạn từ 08:00 đến 18:00." });
      }
    }

    const pool = await poolPromise;
    const staffCheck = await pool.request()
      .input("staffId", sql.Int, staffId)
      .query("SELECT TOP 1 id FROM dbo.staff WHERE id=@staffId AND is_active=1");
    if (!staffCheck.recordset.length) {
      return res.status(404).json({ message: "Không tìm thấy nhân viên đang hoạt động." });
    }

    await upsertException(pool, { staffId, workDate, isDayOff, start, end, reason, createdBy: req.user.id });
    await writeAudit(pool, {
      userId: req.user.id,
      action: isDayOff ? "SET_STAFF_DAY_OFF" : "UPDATE_STAFF_SCHEDULE",
      entityType: "STAFF_SCHEDULE",
      entityId: staffId,
      description: isDayOff ? `${workDate}: nghỉ cả ngày - ${reason}` : `${workDate} ${start}-${end}`,
      req,
    });

    res.json({
      message: isDayOff ? "Đã đánh dấu nhân viên nghỉ cả ngày." : "Đã lưu ca làm việc.",
      staffId,
      workDate,
      isAvailable: !isDayOff,
      startTime: isDayOff ? null : start,
      endTime: isDayOff ? null : end,
    });
  } catch (error) {
    console.error("PUT admin schedule:", error);
    res.status(500).json({ message: "Không thể lưu lịch làm việc." });
  }
});

/* ============================================================
   WEEKLY TEMPLATES
   Monday=1 ... Sunday=7
   ============================================================ */
router.get("/templates", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const staffId = Number(req.query.staffId);
    if (!Number.isInteger(staffId) || staffId <= 0) return res.status(400).json({ message: "staffId không hợp lệ." });
    const pool = await poolPromise;
    const result = await pool.request()
      .input("staffId", sql.Int, staffId)
      .query(`
        SELECT id, staff_id, day_of_week, start_time, end_time, is_working, note
        FROM dbo.staff_schedule_templates
        WHERE staff_id=@staffId
        ORDER BY day_of_week, start_time
      `);
    res.json(result.recordset.map((r) => ({
      ...r,
      start_time: mapTime(r.start_time),
      end_time: mapTime(r.end_time),
      is_working: !!r.is_working,
    })));
  } catch (error) {
    console.error("GET schedule templates:", error);
    res.status(500).json({ message: "Không tải được lịch làm mặc định." });
  }
});

router.put("/templates", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const staffId = Number(req.body?.staffId);
    const dayOfWeek = Number(req.body?.dayOfWeek);
    const isWorking = req.body?.isWorking === true;
    const start = String(req.body?.startTime || "08:00").trim();
    const end = String(req.body?.endTime || "18:00").trim();
    const note = String(req.body?.note || "").trim() || null;

    if (!Number.isInteger(staffId) || staffId <= 0 || !Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
      return res.status(400).json({ message: "Nhân viên hoặc thứ trong tuần không hợp lệ." });
    }

    if (isWorking) {
      if (!validTime(start) || !validTime(end) || start >= end) return res.status(400).json({ message: "Giờ kết thúc phải lớn hơn giờ bắt đầu." });
      if (start < "08:00" || end > "18:00") return res.status(400).json({ message: "Giờ làm mặc định hiện giới hạn từ 08:00 đến 18:00." });
    }

    const pool = await poolPromise;
    const staffCheck = await pool.request().input("staffId", sql.Int, staffId).query("SELECT TOP 1 id FROM dbo.staff WHERE id=@staffId AND is_active=1");
    if (!staffCheck.recordset.length) return res.status(404).json({ message: "Không tìm thấy nhân viên đang hoạt động." });

    await pool.request()
      .input("staffId", sql.Int, staffId)
      .input("dayOfWeek", sql.TinyInt, dayOfWeek)
      .input("start", sql.VarChar, isWorking ? start : "08:00")
      .input("end", sql.VarChar, isWorking ? end : "18:00")
      .input("isWorking", sql.Bit, isWorking)
      .input("note", sql.NVarChar, note || (isWorking ? "Lịch làm mặc định" : "Nghỉ theo lịch tuần"))
      .query(`
        UPDATE dbo.staff_schedule_templates
        SET start_time=@start,end_time=@end,is_working=@isWorking,note=@note,updated_at=SYSDATETIME()
        WHERE staff_id=@staffId AND day_of_week=@dayOfWeek;

        IF @@ROWCOUNT=0
        BEGIN
          INSERT INTO dbo.staff_schedule_templates(staff_id,day_of_week,start_time,end_time,is_working,note)
          VALUES(@staffId,@dayOfWeek,@start,@end,@isWorking,@note);
        END
      `);

    await writeAudit(pool, {
      userId: req.user.id,
      action: isWorking ? "UPDATE_WEEKLY_SCHEDULE" : "SET_WEEKLY_DAY_OFF",
      entityType: "STAFF_SCHEDULE_TEMPLATE",
      entityId: staffId,
      description: `Thứ ${dayOfWeek}: ${isWorking ? `${start}-${end}` : "nghỉ"}.`,
      req,
    });

    res.json({ message: isWorking ? "Đã lưu lịch làm mặc định." : "Đã đặt ngày nghỉ cố định trong tuần." });
  } catch (error) {
    console.error("PUT schedule template:", error);
    res.status(500).json({ message: "Không thể lưu lịch làm mặc định." });
  }
});

/* ============================================================
   DATE EXCEPTIONS
   ============================================================ */
router.get("/exceptions", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const staffId = Number(req.query.staffId);
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    if (!Number.isInteger(staffId) || staffId <= 0) return res.status(400).json({ message: "staffId không hợp lệ." });

    const pool = await poolPromise;
    const result = await pool.request()
      .input("staffId", sql.Int, staffId)
      .input("fromDate", sql.Date, /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null)
      .input("toDate", sql.Date, /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : null)
      .query(`
        SELECT e.id,e.staff_id,e.work_date,e.is_day_off,e.start_time,e.end_time,e.reason,u.full_name AS created_by_name
        FROM dbo.staff_schedule_exceptions e
        LEFT JOIN dbo.users u ON u.id=e.created_by
        WHERE e.staff_id=@staffId
          AND (@fromDate IS NULL OR e.work_date>=@fromDate)
          AND (@toDate IS NULL OR e.work_date<=@toDate)
        ORDER BY e.work_date
      `);
    res.json(result.recordset.map((r) => ({
      ...r,
      work_date: new Date(r.work_date).toISOString().slice(0,10),
      is_day_off: !!r.is_day_off,
      start_time: r.start_time ? mapTime(r.start_time) : "",
      end_time: r.end_time ? mapTime(r.end_time) : "",
    })));
  } catch (error) {
    console.error("GET schedule exceptions:", error);
    res.status(500).json({ message: "Không tải được ngày ngoại lệ." });
  }
});

router.put("/exceptions", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const staffId = Number(req.body?.staffId);
    const workDate = String(req.body?.workDate || "").trim();
    const isDayOff = req.body?.isDayOff === true;
    const start = String(req.body?.startTime || "08:00").trim();
    const end = String(req.body?.endTime || "18:00").trim();
    const reason = String(req.body?.reason || "").trim() || (isDayOff ? "Nghỉ cả ngày" : "Điều chỉnh ca làm");

    if (!Number.isInteger(staffId) || staffId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return res.status(400).json({ message: "Thông tin ngày ngoại lệ không hợp lệ." });
    if (!isDayOff) {
      if (!validTime(start) || !validTime(end) || start >= end) return res.status(400).json({ message: "Giờ kết thúc phải lớn hơn giờ bắt đầu." });
      if (start < "08:00" || end > "18:00") return res.status(400).json({ message: "Giờ ngoại lệ hiện giới hạn từ 08:00 đến 18:00." });
    }

    const pool = await poolPromise;
    const staffCheck = await pool.request().input("staffId", sql.Int, staffId).query("SELECT TOP 1 id FROM dbo.staff WHERE id=@staffId AND is_active=1");
    if (!staffCheck.recordset.length) return res.status(404).json({ message: "Không tìm thấy nhân viên đang hoạt động." });

    // Không cho đặt nghỉ / thu hẹp ca khi nhân viên đã có lịch hẹn nằm ngoài ca mới (tránh "lịch ma").
    const booked = await pool.request().input("staffId", sql.Int, staffId).input("workDate", sql.Date, workDate).query(`
      SELECT start_time, end_time FROM dbo.appointments
      WHERE staff_id=@staffId AND appointment_date=@workDate AND status IN ('PENDING','CONFIRMED')
    `);
    const clash = booked.recordset.filter((a) => isDayOff || mapTime(a.start_time) < start || mapTime(a.end_time) > end);
    if (clash.length) {
      return res.status(409).json({ message: `Nhân viên đang có ${clash.length} lịch hẹn nằm ngoài ca mới của ngày ${workDate}. Hãy đổi hoặc hủy các lịch đó trước.` });
    }

    await upsertException(pool, { staffId, workDate, isDayOff, start, end, reason, createdBy: req.user.id });

    await writeAudit(pool, {
      userId: req.user.id,
      action: isDayOff ? "SET_STAFF_EXCEPTION_DAY_OFF" : "SET_STAFF_EXCEPTION_SCHEDULE",
      entityType: "STAFF_SCHEDULE_EXCEPTION",
      entityId: staffId,
      description: `${workDate}: ${isDayOff ? `nghỉ - ${reason}` : `${start}-${end} - ${reason}`}`,
      req,
    });

    res.json({ message: isDayOff ? "Đã ghi nhận ngày nghỉ ngoại lệ." : "Đã ghi nhận ca làm ngoại lệ." });
  } catch (error) {
    console.error("PUT schedule exception:", error);
    res.status(500).json({ message: "Không thể lưu ngày ngoại lệ." });
  }
});

router.delete("/exceptions/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "ID ngoại lệ không hợp lệ." });
    const pool = await poolPromise;
    const result = await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.staff_schedule_exceptions WHERE id=@id");
    if (!result.rowsAffected[0]) return res.status(404).json({ message: "Không tìm thấy ngày ngoại lệ." });
    await writeAudit(pool, { userId:req.user.id, action:"DELETE_STAFF_SCHEDULE_EXCEPTION", entityType:"STAFF_SCHEDULE_EXCEPTION", entityId:id, description:"Xóa ngày ngoại lệ để quay về lịch mặc định/concrete.", req });
    res.json({ message: "Đã xóa ngày ngoại lệ." });
  } catch (error) {
    console.error("DELETE schedule exception:", error);
    res.status(500).json({ message: "Không thể xóa ngày ngoại lệ." });
  }
});

export default router;
