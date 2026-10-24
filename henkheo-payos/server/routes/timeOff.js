/*
 * Nhân viên xin nghỉ -> Admin duyệt -> hệ thống tự tạo "ngày nghỉ ngoại lệ" (staff_schedule_exceptions),
 * nên lịch trống của khách, chatbot và đổi lịch đều tự cập nhật theo.
 *  - Không duyệt được khi nhân viên còn lịch hẹn (PENDING/CONFIRMED) trong khoảng nghỉ:
 *    Admin phải đổi/hủy các lịch đó trước hoặc từ chối đơn.
 */
import { Router } from "express";
import { poolPromise, sql } from "../db.js";
import { authenticateToken, requireAdmin, requireStaff } from "../middleware/authMiddleware.js";
import { writeAudit } from "../utils_audit.js";
import { isValidISODate, addDaysISO } from "../scheduleResolver.js";
import { addNotification, notifyAdmins } from "../notify.js";
import { upsertException } from "./staffSchedules.js";

const router = Router();
const MAX_RANGE_DAYS = 30;
const MAX_ADVANCE_DAYS = 180;
const today = () => new Date().toLocaleDateString("en-CA");
const iso = (v) => new Date(v).toISOString().slice(0, 10);

export function daysBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDaysISO(d, 1)) out.push(d);
  return out;
}

export function validateTimeOffRange(dateFrom, dateTo, now = today()) {
  if (!isValidISODate(dateFrom) || !isValidISODate(dateTo)) return "Ngày nghỉ không hợp lệ.";
  if (dateTo < dateFrom) return "Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.";
  if (dateFrom < now) return "Không thể xin nghỉ cho ngày đã qua.";
  if (daysBetween(dateFrom, dateTo).length > MAX_RANGE_DAYS) return `Mỗi đơn nghỉ tối đa ${MAX_RANGE_DAYS} ngày liên tiếp.`;
  if (dateFrom > addDaysISO(now, MAX_ADVANCE_DAYS)) return `Chỉ nhận đơn nghỉ trước tối đa ${MAX_ADVANCE_DAYS} ngày.`;
  return null;
}

async function staffOf(pool, userId) {
  const r = await pool.request().input("userId", sql.Int, Number(userId))
    .query("SELECT TOP 1 id, full_name, user_id FROM dbo.staff WHERE user_id=@userId AND is_active=1");
  return r.recordset[0] || null;
}

const mapRow = (r) => ({
  id: r.id, staff_id: r.staff_id, staff_name: r.staff_name,
  date_from: iso(r.date_from), date_to: iso(r.date_to), reason: r.reason || "",
  status: String(r.status).toLowerCase(), review_note: r.review_note || "",
  reviewed_at: r.reviewed_at, created_at: r.created_at,
  active_appointments: Number(r.active_appointments || 0),
});

const SELECT = `
  SELECT t.*, st.full_name AS staff_name,
         (SELECT COUNT(*) FROM dbo.appointments a
           WHERE a.staff_id=t.staff_id AND a.status IN ('PENDING','CONFIRMED')
             AND a.appointment_date BETWEEN t.date_from AND t.date_to) AS active_appointments
  FROM dbo.staff_time_off_requests t INNER JOIN dbo.staff st ON st.id=t.staff_id
`;

/* ----- Nhân viên ----- */
router.post("/", authenticateToken, requireStaff, async (req, res) => {
  try {
    const dateFrom = String(req.body?.dateFrom || "").trim();
    const dateTo = String(req.body?.dateTo || dateFrom).trim();
    const reason = String(req.body?.reason || "").trim().slice(0, 500);
    const problem = validateTimeOffRange(dateFrom, dateTo);
    if (problem) return res.status(400).json({ message: problem });
    if (!reason) return res.status(400).json({ message: "Vui lòng nhập lý do xin nghỉ." });

    const pool = await poolPromise;
    const staff = await staffOf(pool, req.user.id);
    if (!staff) return res.status(404).json({ message: "Tài khoản chưa liên kết hồ sơ nhân viên." });

    const overlap = await pool.request().input("sid", sql.Int, staff.id).input("f", sql.Date, dateFrom).input("t", sql.Date, dateTo).query(`
      SELECT TOP 1 id FROM dbo.staff_time_off_requests
      WHERE staff_id=@sid AND status IN ('REQUESTED','APPROVED') AND date_from<=@t AND date_to>=@f
    `);
    if (overlap.recordset.length) return res.status(409).json({ message: "Khoảng ngày này trùng với một đơn nghỉ khác đang chờ hoặc đã được duyệt." });

    const ins = await pool.request().input("sid", sql.Int, staff.id).input("f", sql.Date, dateFrom).input("t", sql.Date, dateTo).input("reason", sql.NVarChar, reason)
      .query("INSERT INTO dbo.staff_time_off_requests(staff_id,date_from,date_to,reason) OUTPUT INSERTED.id VALUES(@sid,@f,@t,@reason)");
    const id = ins.recordset[0].id;
    await notifyAdmins(pool, "Nhân viên xin nghỉ", `${staff.full_name} xin nghỉ ${dateFrom}${dateTo !== dateFrom ? ` → ${dateTo}` : ""}. Lý do: ${reason}`, "TIME_OFF_REQUESTED");
    await writeAudit(pool, { userId: req.user.id, action: "REQUEST_TIME_OFF", entityType: "TIME_OFF", entityId: id, description: `${dateFrom} → ${dateTo}: ${reason}`, req });
    res.status(201).json({ message: "Đã gửi đơn xin nghỉ. Vui lòng chờ quản trị viên duyệt.", id });
  } catch (error) {
    console.error("POST time-off:", error);
    res.status(500).json({ message: "Không thể gửi đơn xin nghỉ." });
  }
});

router.get("/my", authenticateToken, requireStaff, async (req, res) => {
  try {
    const pool = await poolPromise;
    const staff = await staffOf(pool, req.user.id);
    if (!staff) return res.status(404).json({ message: "Tài khoản chưa liên kết hồ sơ nhân viên." });
    const r = await pool.request().input("sid", sql.Int, staff.id).query(`${SELECT} WHERE t.staff_id=@sid ORDER BY t.created_at DESC`);
    res.json(r.recordset.map(mapRow));
  } catch (error) {
    console.error("GET my time-off:", error);
    res.status(500).json({ message: "Không tải được đơn xin nghỉ." });
  }
});

router.patch("/my/:id/cancel", authenticateToken, requireStaff, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const pool = await poolPromise;
    const staff = await staffOf(pool, req.user.id);
    if (!staff) return res.status(404).json({ message: "Tài khoản chưa liên kết hồ sơ nhân viên." });
    const r = await pool.request().input("id", sql.Int, id).input("sid", sql.Int, staff.id)
      .query("UPDATE dbo.staff_time_off_requests SET status='CANCELLED', updated_at=SYSDATETIME() WHERE id=@id AND staff_id=@sid AND status='REQUESTED'");
    if (!r.rowsAffected[0]) return res.status(409).json({ message: "Chỉ hủy được đơn đang chờ duyệt." });
    res.json({ message: "Đã hủy đơn xin nghỉ." });
  } catch (error) {
    console.error("PATCH cancel time-off:", error);
    res.status(500).json({ message: "Không thể hủy đơn." });
  }
});

/* ----- Admin ----- */
router.get("/", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const status = String(req.query.status || "").toUpperCase();
    const pool = await poolPromise;
    const request = pool.request();
    let where = "";
    if (["REQUESTED", "APPROVED", "REJECTED", "CANCELLED"].includes(status)) { request.input("status", sql.VarChar, status); where = "WHERE t.status=@status"; }
    const r = await request.query(`${SELECT} ${where} ORDER BY CASE WHEN t.status='REQUESTED' THEN 0 ELSE 1 END, t.date_from DESC`);
    res.json(r.recordset.map(mapRow));
  } catch (error) {
    console.error("GET time-off:", error);
    res.status(500).json({ message: "Không tải được danh sách đơn nghỉ." });
  }
});

router.patch("/:id/approve", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const pool = await poolPromise;
    const r = await pool.request().input("id", sql.Int, id).query(`${SELECT} WHERE t.id=@id`);
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ message: "Không tìm thấy đơn nghỉ." });
    if (row.status !== "REQUESTED") return res.status(409).json({ message: "Đơn này không còn ở trạng thái chờ duyệt." });
    if (Number(row.active_appointments) > 0) {
      return res.status(409).json({ message: `Nhân viên còn ${row.active_appointments} lịch hẹn trong khoảng nghỉ. Hãy đổi/hủy các lịch đó trước, hoặc từ chối đơn.` });
    }
    const from = iso(row.date_from); const to = iso(row.date_to);
    for (const d of daysBetween(from, to)) {
      await upsertException(pool, { staffId: row.staff_id, workDate: d, isDayOff: true, reason: `Nghỉ phép: ${row.reason || ""}`.trim(), createdBy: req.user.id });
    }
    const upd = await pool.request().input("id", sql.Int, id).input("by", sql.Int, req.user.id).input("note", sql.NVarChar, String(req.body?.note || "").trim().slice(0, 500) || null)
      .query("UPDATE dbo.staff_time_off_requests SET status='APPROVED', reviewed_by=@by, reviewed_at=SYSDATETIME(), review_note=@note, updated_at=SYSDATETIME() WHERE id=@id AND status='REQUESTED'");
    if (!upd.rowsAffected[0]) return res.status(409).json({ message: "Đơn vừa được xử lý. Vui lòng tải lại." });
    const staffUser = await pool.request().input("sid", sql.Int, row.staff_id).query("SELECT user_id FROM dbo.staff WHERE id=@sid");
    await addNotification(pool, staffUser.recordset[0]?.user_id, "Đơn xin nghỉ đã được duyệt", `Đơn nghỉ ${from}${to !== from ? ` → ${to}` : ""} đã được duyệt.`, "TIME_OFF_APPROVED");
    await writeAudit(pool, { userId: req.user.id, action: "APPROVE_TIME_OFF", entityType: "TIME_OFF", entityId: id, description: `${row.staff_name}: ${from} → ${to}`, req });
    res.json({ message: "Đã duyệt đơn nghỉ và cập nhật lịch làm việc." });
  } catch (error) {
    console.error("PATCH approve time-off:", error);
    res.status(500).json({ message: "Không thể duyệt đơn nghỉ." });
  }
});

router.patch("/:id/reject", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const note = String(req.body?.note || "").trim().slice(0, 500);
    if (!note) return res.status(400).json({ message: "Vui lòng nhập lý do từ chối." });
    const pool = await poolPromise;
    const r = await pool.request().input("id", sql.Int, id).query(`${SELECT} WHERE t.id=@id`);
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ message: "Không tìm thấy đơn nghỉ." });
    const upd = await pool.request().input("id", sql.Int, id).input("by", sql.Int, req.user.id).input("note", sql.NVarChar, note)
      .query("UPDATE dbo.staff_time_off_requests SET status='REJECTED', reviewed_by=@by, reviewed_at=SYSDATETIME(), review_note=@note, updated_at=SYSDATETIME() WHERE id=@id AND status='REQUESTED'");
    if (!upd.rowsAffected[0]) return res.status(409).json({ message: "Đơn không còn ở trạng thái chờ duyệt." });
    const staffUser = await pool.request().input("sid", sql.Int, row.staff_id).query("SELECT user_id FROM dbo.staff WHERE id=@sid");
    await addNotification(pool, staffUser.recordset[0]?.user_id, "Đơn xin nghỉ bị từ chối", `Đơn nghỉ ${iso(row.date_from)} bị từ chối. Lý do: ${note}`, "TIME_OFF_REJECTED");
    await writeAudit(pool, { userId: req.user.id, action: "REJECT_TIME_OFF", entityType: "TIME_OFF", entityId: id, description: `${row.staff_name}: ${note}`, req });
    res.json({ message: "Đã từ chối đơn nghỉ." });
  } catch (error) {
    console.error("PATCH reject time-off:", error);
    res.status(500).json({ message: "Không thể từ chối đơn nghỉ." });
  }
});

export default router;
