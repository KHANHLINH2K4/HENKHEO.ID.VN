import { Router } from "express";
import { poolPromise, sql } from "../db.js";
import {
  authenticateToken,
  requireAdmin,
  requireAdminOrStaff,
  requireCustomer,
} from "../middleware/authMiddleware.js";
import crypto from "node:crypto";
import { buildICS } from "../ics.js";
import { writeAudit } from "../utils_audit.js";
import { emitToUser, emitToRole } from "../realtime.js";
import { getEffectiveSchedules, getEffectiveSchedulesForStaff, isValidISODate, addDaysISO } from "../scheduleResolver.js";
import {
  policyConfig, checkCustomerChange, normalizeVNPhone, isValidEmail, rankStaffForAutoAssign, overlapsWithBuffer,
  canTransition, checkStatusChange, isRefundPending, makeAppointmentCode, minutesToHHMM,
} from "../policy.js";
import { sendMail, mailTemplates, isMailConfigured } from "../mailer.js";
import { addNotification, notifyAdmins, runBackground } from "../notify.js";
import { logger } from "../logger.js";
import { cancelPayOSLinkForAppointment } from "./payments.js";

// Giữ tương thích: các module khác từng import 2 hàm này từ appointments.js
export { addNotification, notifyAdmins };

const router = Router();

const parseTime = (value) => {
  if (value == null) return null;

  // mssql can return SQL Server TIME as a Date object.
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const hours = value.getUTCHours();
    const minutes = value.getUTCMinutes();
    return {
      hours,
      minutes,
      text: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
    };
  }

  const text = String(value).slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(text)) return null;
  const [hours, minutes] = text.split(":").map(Number);
  if (hours > 23 || minutes > 59) return null;

  return { hours, minutes, text };
};

export const timeToMin = (value) => {
  const parsed = parseTime(value);
  return parsed ? parsed.hours * 60 + parsed.minutes : 0;
};

/* ---------- Quy tắc thời gian đặt lịch (cấu hình bằng .env) ---------- */
const bookingRules = () => ({
  leadMinutes: Math.max(0, Number(process.env.BOOKING_MIN_LEAD_MINUTES ?? 30)),
  maxAdvanceDays: Math.max(1, Number(process.env.BOOKING_MAX_ADVANCE_DAYS ?? 60)),
});

export const localToday = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD theo TZ của server
const localNowMinutes = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };

/** Trả về thông báo lỗi nếu ngày/giờ nằm ngoài quy tắc đặt lịch, ngược lại null. */
export function validateBookingWindow(date, startMinutes, opts = {}) {
  const { maxAdvanceDays } = bookingRules();
  const leadMinutes = opts.leadMinutes ?? bookingRules().leadMinutes;
  if (!isValidISODate(date)) return "Ngày đặt lịch không hợp lệ.";
  const today = localToday();
  if (date < today) return "Không thể đặt lịch cho ngày đã qua.";
  if (date > addDaysISO(today, maxAdvanceDays)) return `Chỉ nhận đặt lịch trước tối đa ${maxAdvanceDays} ngày.`;
  if (date === today && startMinutes < localNowMinutes() + leadMinutes) {
    return `Cần đặt trước ít nhất ${leadMinutes} phút so với giờ hẹn.`;
  }
  return null;
}

/** Bỏ các khung giờ đã/đang qua của ngày hôm nay. */
export function dropPastSlots(date, slots, leadOverride) {
  const leadMinutes = leadOverride ?? bookingRules().leadMinutes;
  const today = localToday();
  if (date < today) return [];
  if (date !== today) return slots;
  const limit = localNowMinutes() + leadMinutes;
  return slots.filter((t) => timeToMin(t) >= limit);
}

export const toDate = (value) => value ? new Date(value).toISOString().slice(0, 10) : null;
export const toTime = (value) => parseTime(value)?.text || "";
const normalizeStatus = (value) => String(value || "PENDING").toUpperCase();

export async function getCustomerByUserId(pool, userId) {
  const result = await pool.request()
    .input("userId", sql.Int, userId)
    .query("SELECT TOP 1 * FROM dbo.customers WHERE user_id=@userId AND is_active=1 ORDER BY id");
  return result.recordset[0] || null;
}

export async function emitAppointmentsChanged() {
  emitToRole("ADMIN", "appointments:changed", { scope: "ADMIN" });
  emitToRole("STAFF", "appointments:changed", { scope: "STAFF" });
}

async function mapAppointments(result) {
  const now = new Date();
  return result.recordset.map((a) => {
    const base = { date: toDate(a.appointment_date), time: toTime(a.start_time), status: a.status, paid: String(a.payment_status || "").toUpperCase() === "PAID" };
    const cancelCheck = checkCustomerChange(base, "cancel", now);
    const rescheduleCheck = checkCustomerChange(base, "reschedule", now);
    const st = String(a.status || "").toUpperCase();
    return {
    id: a.id,
    appointment_code: a.appointment_code,
    customer_id: a.customer_id,
    customer_name: a.customer_name,
    customer_phone: a.customer_phone,
    email: a.customer_email,
    service_id: a.service_id,
    service_name: a.service_name,
    service_duration: Number(a.duration_minutes || 0),
    price: Number(a.price_at_booking ?? a.price ?? 0),
    staff_id: a.staff_id,
    staff_name: a.staff_name,
    date: toDate(a.appointment_date),
    time: toTime(a.start_time),
    end_time: toTime(a.end_time),
    note: a.note,
    status: String(a.status || "PENDING").toLowerCase(),
    has_pending_reschedule: !!a.has_pending_reschedule,
    source: a.source || "ONLINE",
    auto_assigned: !!a.auto_assigned,
    can_cancel: cancelCheck.ok,
    cancel_block_message: cancelCheck.ok ? "" : cancelCheck.message,
    can_reschedule: rescheduleCheck.ok,
    reschedule_block_message: rescheduleCheck.ok ? "" : rescheduleCheck.message,
    refund_pending: isRefundPending({ appointmentStatus: st, paymentStatus: a.payment_status, refundedAt: a.refunded_at, refundRequestedAt: a.refund_requested_at }),
    payment: a.payment_status ? {
      payment_code: a.payment_code,
      payment_method: a.payment_method,
      payment_status: a.payment_status,
      amount: Number(a.payment_amount || 0),
      transaction_code: a.transaction_code,
      paid_at: a.paid_at,
      qr_code_url: a.qr_code_url,
      qr_expires_at: a.qr_expires_at,
      customer_claimed_at: a.customer_claimed_at,
      refund_reference: a.refund_reference,
      refunded_at: a.refunded_at,
      refund_requested_at: a.refund_requested_at,
    } : null,
    };
  });
}

const baseSelect = `
  SELECT a.id, a.appointment_code,
         c.id AS customer_id, c.full_name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
         s.id AS service_id, s.name AS service_name, s.duration_minutes, s.price, a.price_at_booking,
         st.id AS staff_id, st.full_name AS staff_name,
         p.payment_code, p.payment_method, p.payment_status, p.amount AS payment_amount,
         p.transaction_code, p.paid_at, p.qr_code_url, p.qr_expires_at, p.customer_claimed_at,
         p.refund_reference, p.refunded_at, p.refund_requested_at, a.source, a.auto_assigned,
         a.appointment_date, a.start_time, a.end_time, a.note, a.status,
         CASE WHEN EXISTS (SELECT 1 FROM dbo.appointment_reschedule_requests rr WHERE rr.appointment_id=a.id AND rr.status='REQUESTED')
              THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS has_pending_reschedule
  FROM dbo.appointments a
  INNER JOIN dbo.customers c ON c.id=a.customer_id
  INNER JOIN dbo.services s ON s.id=a.service_id
  LEFT JOIN dbo.staff st ON st.id=a.staff_id
  LEFT JOIN dbo.payments p ON p.appointment_id=a.id
`;


export const staffSuitableForService = async (pool, staffId, serviceId) => {
  const result = await pool.request()
    .input("staffId", sql.Int, Number(staffId))
    .input("serviceId", sql.Int, Number(serviceId))
    .query(`
      SELECT TOP 1 1 AS ok
      FROM dbo.staff_services ss
      INNER JOIN dbo.staff st ON st.id = ss.staff_id AND st.is_active = 1
      INNER JOIN dbo.services sv ON sv.id = ss.service_id AND sv.is_active = 1
      WHERE ss.staff_id=@staffId AND ss.service_id=@serviceId AND ss.is_active=1
    `);
  return result.recordset.length > 0;
};

export const buildSlots = (scheduleRows, appointments, durationMinutes, bufferMinutes = policyConfig().slotBufferMinutes, stepMinutes = policyConfig().slotStepMinutes) => {
  const slots = [];
  const step = Math.max(5, Number(stepMinutes) || 30);
  const duration = Number(durationMinutes) || 30;

  const hasConflict = (start, end) => appointments.some((appointment) => {
    const otherStart = timeToMin(appointment.start_time);
    const otherEnd = appointment.end_time
      ? timeToMin(appointment.end_time)
      : otherStart + (Number(appointment.duration_minutes) || 30);
    return overlapsWithBuffer(start, end, otherStart, otherEnd, bufferMinutes);
  });

  for (const schedule of scheduleRows) {
    const workStart = timeToMin(schedule.start_time);
    const workEnd = timeToMin(schedule.end_time);
    for (let start = workStart; start + duration <= workEnd; start += step) {
      const end = start + duration;
      if (!hasConflict(start, end)) {
        slots.push(`${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`);
      }
    }
  }

  return [...new Set(slots)].sort();
};

/*
 * Luồng nghiệp vụ đặt lịch:
 * Dịch vụ -> nhân viên phù hợp -> có lịch làm ngày đã chọn ->
 * khung giờ nằm trong ca -> khung giờ không trùng lịch -> trả slot có thể đặt.
 */
/** Lịch (PENDING/CONFIRMED) của nhiều nhân viên trong một ngày — 1 truy vấn. Trả về Map<staffId, rows[]>. */
async function loadDayAppointments(pool, staffIds, date) {
  const ids = [...new Set(staffIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const out = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return out;
  const r = await pool.request().input("date", sql.Date, date).query(`
    SELECT a.staff_id, a.start_time, a.end_time, s.duration_minutes
    FROM dbo.appointments a INNER JOIN dbo.services s ON s.id=a.service_id
    WHERE a.staff_id IN (${ids.join(",")}) AND a.appointment_date=@date AND a.status IN ('PENDING','CONFIRMED')
    ORDER BY a.start_time
  `);
  for (const row of r.recordset) out.get(row.staff_id)?.push(row);
  return out;
}

/*
 * Tính khung giờ trống theo từng nhân viên phù hợp + khung giờ chung cho chế độ "Bất kỳ nhân viên".
 * Dùng cho khách (giờ quá khứ/sát giờ bị loại) và cho nhân viên tạo hộ (cho phép trễ tối đa 15 phút).
 */
export async function computeBookingOptions(pool, { serviceId, date, onlyStaffId = null, leadMinutes }) {
  const serviceResult = await pool.request()
    .input("serviceId", sql.Int, Number(serviceId))
    .query(`
      SELECT TOP 1 s.id, s.name, s.duration_minutes, c.name AS category_name
      FROM dbo.services s INNER JOIN dbo.categories c ON c.id=s.category_id
      WHERE s.id=@serviceId AND s.is_active=1 AND c.is_active=1
    `);
  const service = serviceResult.recordset[0];
  if (!service) return null;

  const staffRequest = pool.request().input("serviceId", sql.Int, Number(serviceId));
  let onlyClause = "";
  if (onlyStaffId) { staffRequest.input("onlyStaffId", sql.Int, Number(onlyStaffId)); onlyClause = "AND st.id=@onlyStaffId"; }
  const staffResult = await staffRequest.query(`
    SELECT DISTINCT st.id, st.full_name, st.phone, st.email, st.position, st.specialties
    FROM dbo.staff_services ss INNER JOIN dbo.staff st ON st.id = ss.staff_id
    WHERE ss.service_id=@serviceId AND ss.is_active=1 AND st.is_active=1 ${onlyClause}
    ORDER BY st.id
  `);

  const staffIdsAll = staffResult.recordset.map((x) => x.id);
  const [schedulesByStaff, apptsByStaff] = await Promise.all([
    getEffectiveSchedulesForStaff(pool, staffIdsAll, date),
    loadDayAppointments(pool, staffIdsAll, date),
  ]);
  const staffOptions = [];
  for (const staff of staffResult.recordset) {
    const effectiveSchedules = schedulesByStaff.get(staff.id) || [];
    const slots = dropPastSlots(date, buildSlots(effectiveSchedules, apptsByStaff.get(staff.id) || [], service.duration_minutes), leadMinutes);
    staffOptions.push({
      id: staff.id,
      name: staff.full_name,
      full_name: staff.full_name,
      position: staff.position,
      specialties: staff.specialties ? String(staff.specialties).split(/[,;|]/).map((x) => x.trim()).filter(Boolean) : [],
      working: effectiveSchedules.length > 0,
      working_hours: effectiveSchedules.map((row) => ({ start: toTime(row.start_time), end: toTime(row.end_time) })),
      slots,
      available: slots.length > 0,
    });
  }
  const anySlots = [...new Set(staffOptions.flatMap((x) => x.slots))].sort();
  return {
    service: { id: service.id, name: service.name, duration: Number(service.duration_minutes), category_name: service.category_name },
    date,
    staff: staffOptions,
    any: { available: anySlots.length > 0, slots: anySlots, staff_count: staffOptions.filter((x) => x.available).length },
  };
}

router.get("/booking-options", authenticateToken, requireCustomer, async (req, res) => {
  try {
    const { serviceId, date } = req.query;
    if (!serviceId || !date) return res.status(400).json({ message: "Thiếu serviceId hoặc date." });
    if (!isValidISODate(String(date))) return res.status(400).json({ message: "Ngày không hợp lệ." });
    const pool = await poolPromise;
    const data = await computeBookingOptions(pool, { serviceId: Number(serviceId), date: String(date) });
    if (!data) return res.status(404).json({ message: "Không tìm thấy dịch vụ." });
    return res.json(data);
  } catch (error) {
    console.error("GET booking options:", error);
    return res.status(500).json({ message: "Không tải được nhân viên và khung giờ có thể đặt." });
  }
});

router.get("/availability", async (req, res) => {
  try {
    const { staffId, date } = req.query;
    if (!staffId || !date) return res.status(400).json({ message: "Thiếu staffId hoặc date." });
    if (!Number.isInteger(Number(staffId)) || !isValidISODate(String(date))) {
      return res.status(400).json({ message: "staffId hoặc date không hợp lệ." });
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input("staffId", sql.Int, Number(staffId))
      .input("date", sql.Date, date)
      .query(`
        SELECT a.id, a.service_id, s.duration_minutes, a.start_time, a.end_time, a.status
        FROM dbo.appointments a
        INNER JOIN dbo.services s ON s.id=a.service_id
        WHERE a.staff_id=@staffId
          AND a.appointment_date=@date
          AND a.status IN ('PENDING','CONFIRMED')
        ORDER BY a.start_time
      `);

    // Công khai: chỉ trả khoảng thời gian đã bận (không lộ id lịch / dịch vụ của khách khác).
    res.json(result.recordset.map((a) => ({
      duration: Number(a.duration_minutes),
      time: toTime(a.start_time),
      end_time: toTime(a.end_time),
    })));
  } catch (error) {
    console.error("GET appointment availability:", error);
    res.status(500).json({ message: "Không tải được khung giờ đã đặt." });
  }
});

router.get("/my", authenticateToken, requireCustomer, async (req, res) => {
  try {
    const pool = await poolPromise;
    const customer = await getCustomerByUserId(pool, req.user.id);
    if (!customer) return res.status(404).json({ message: "Tài khoản chưa có hồ sơ khách hàng." });

    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const result = await pool.request()
      .input("customerId", sql.Int, customer.id)
      .input("limit", sql.Int, limit)
      .query(`SELECT TOP (@limit) * FROM (${baseSelect} WHERE a.customer_id=@customerId) q ORDER BY q.appointment_date DESC, q.start_time DESC`);

    res.json(await mapAppointments(result));
  } catch (error) {
    console.error("GET my appointments:", error);
    res.status(500).json({ message: "Không tải được lịch hẹn của bạn." });
  }
});

router.get("/", authenticateToken, requireAdminOrStaff, async (req, res) => {
  try {
    const pool = await poolPromise;
    const request = pool.request();
    const conds = [];
    if (req.user.role === "STAFF") {
      request.input("userId", sql.Int, Number(req.user.id));
      conds.push("st.user_id=@userId");
    }
    // Bộ lọc tùy chọn phía máy chủ: ?from=YYYY-MM-DD&to=YYYY-MM-DD&status=PENDING,CONFIRMED&limit=1000
    const { from, to } = req.query;
    if (from) { if (!isValidISODate(String(from))) return res.status(400).json({ message: "Tham số from không hợp lệ." }); request.input("from", sql.Date, String(from)); conds.push("a.appointment_date >= @from"); }
    if (to) { if (!isValidISODate(String(to))) return res.status(400).json({ message: "Tham số to không hợp lệ." }); request.input("to", sql.Date, String(to)); conds.push("a.appointment_date <= @to"); }
    if (req.query.status) {
      const statuses = String(req.query.status).toUpperCase().split(",").map((x) => x.trim()).filter((x) => ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"].includes(x));
      if (statuses.length) conds.push(`a.status IN (${statuses.map((x) => `'${x}'`).join(",")})`);
    }
    // Mặc định tối đa 3000 lịch gần nhất để một truy vấn không kéo cả bảng khi dữ liệu lớn.
    const limit = Math.min(Math.max(Number(req.query.limit) || 3000, 1), 10000);
    request.input("limit", sql.Int, limit);
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const result = await request
      .query(`SELECT TOP (@limit) * FROM (${baseSelect} ${where}) q ORDER BY q.appointment_date DESC, q.start_time DESC`);
    res.json(await mapAppointments(result));
  } catch (error) {
    console.error("GET appointments:", error);
    res.status(500).json({ message: "Không tải được danh sách lịch hẹn." });
  }
});

export async function customerBookingRuleError(db, customerId) {
  const cfg = policyConfig();
  const today = localToday();
  // db có thể là pool hoặc một transaction đang mở (để kiểm tra giới hạn NGUYÊN TỬ cùng lúc với INSERT).
  const r = await (db instanceof sql.Transaction ? new sql.Request(db) : db.request())
    .input("cid", sql.Int, Number(customerId))
    .input("today", sql.Date, today)
    .input("since", sql.Date, addDaysISO(today, -cfg.noShowWindowDays))
    .query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.appointments
          WHERE customer_id=@cid AND status IN ('PENDING','CONFIRMED') AND appointment_date >= @today) AS active_count,
        (SELECT COUNT(*) FROM dbo.appointments
          WHERE customer_id=@cid AND status='NO_SHOW' AND appointment_date >= @since) AS no_show_count
    `);
  const { active_count: active, no_show_count: noShow } = r.recordset[0];
  if (noShow >= cfg.noShowBlockCount) {
    return { status: 403, message: `Tài khoản tạm thời không thể đặt lịch online vì có ${noShow} lần không đến trong ${cfg.noShowWindowDays} ngày gần đây. Vui lòng liên hệ cửa hàng để được hỗ trợ.` };
  }
  if (active >= cfg.maxActiveBookings) {
    return { status: 409, message: `Bạn đang có ${active} lịch chờ/sắp tới (tối đa ${cfg.maxActiveBookings}). Hãy hoàn thành hoặc hủy bớt lịch cũ trước khi đặt thêm.` };
  }
  return null;
}

/** Tìm khách theo SĐT (đã chuẩn hóa) hoặc tạo hồ sơ khách vãng lai (không có tài khoản đăng nhập). */
export async function findOrCreateWalkInCustomer(pool, { fullName, phone, email }) {
  const found = await pool.request().input("phone", sql.VarChar, phone)
    .query("SELECT TOP 1 * FROM dbo.customers WHERE phone=@phone AND is_active=1 ORDER BY CASE WHEN user_id IS NULL THEN 1 ELSE 0 END, id");
  if (found.recordset[0]) return found.recordset[0];
  const created = await pool.request()
    .input("fullName", sql.NVarChar, String(fullName).trim().slice(0, 100))
    .input("phone", sql.VarChar, phone)
    .input("email", sql.VarChar, email ? String(email).trim() : null)
    .query(`INSERT INTO dbo.customers(user_id, full_name, phone, email, is_active)
            OUTPUT INSERTED.* VALUES(NULL, @fullName, @phone, @email, 1)`);
  return created.recordset[0];
}

/** Danh sách nhân viên phù hợp, xếp theo mức độ rảnh (ít lịch nhất trong ngày trước) và còn trống đúng khung giờ. */
async function rankFreeStaffForSlot(pool, { serviceId, date, start, end }) {
  const cfg = policyConfig();
  const staffRows = await pool.request().input("serviceId", sql.Int, Number(serviceId)).query(`
    SELECT DISTINCT st.id
    FROM dbo.staff_services ss INNER JOIN dbo.staff st ON st.id=ss.staff_id
    WHERE ss.service_id=@serviceId AND ss.is_active=1 AND st.is_active=1
  `);
  const ids = staffRows.recordset.map((x) => x.id);
  const [schedulesByStaff, apptsByStaff] = await Promise.all([
    getEffectiveSchedulesForStaff(pool, ids, date),
    loadDayAppointments(pool, ids, date),
  ]);
  const candidates = [];
  for (const id of ids) {
    const schedules = schedulesByStaff.get(id) || [];
    if (!schedules.some((sc) => start >= timeToMin(sc.start_time) && end <= timeToMin(sc.end_time))) continue;
    const appts = apptsByStaff.get(id) || [];
    const busy = appts.some((a) => overlapsWithBuffer(start, end, timeToMin(a.start_time), timeToMin(a.end_time), cfg.slotBufferMinutes));
    if (!busy) candidates.push({ staffId: id, load: appts.length });
  }
  return rankStaffForAutoAssign(candidates);
}

/*
 * Lõi nghiệp vụ đặt lịch, dùng chung cho:
 *  - REST route POST /api/appointments (khách đặt qua giao diện Đặt lịch)
 *  - Chatbot NLP (đặt lịch qua hội thoại, xem server/routes/chat.js)
 *  - Admin/Staff tạo lịch hộ khách (walk-in / điện thoại): truyền customerId + actorUserId + autoConfirm
 * Tách riêng để đảm bảo MỘT nguồn logic duy nhất (kiểm tra ca làm, chống trùng lịch,
 * giá chốt tại thời điểm đặt) — không có đường đi tắt.
 *  - staffId = "ANY": hệ thống tự chọn nhân viên rảnh (ít lịch nhất trong ngày).
 * Trả về { status, body } thay vì gọi res.* trực tiếp để tái sử dụng được ở nơi khác.
 */
export async function createAppointmentCore(pool, opts) {
  const {
    userId = null, customerId = null, serviceId, staffId, date, time, note, req = null,
    source = "ONLINE", actorUserId = null, autoConfirm = false, manual = false, _autoAssigned = false,
  } = opts;
  const paymentMethod = String(opts.paymentMethod || "AT_STORE").toUpperCase();
  const wantsAny = String(staffId ?? "").toUpperCase() === "ANY";
  if (!serviceId || !staffId || !date || !time) {
    return { status: 400, body: { message: "Vui lòng chọn dịch vụ, nhân viên, ngày và giờ." } };
  }
  if (!["AT_STORE", "ONLINE"].includes(paymentMethod)) {
    return { status: 400, body: { message: "Hình thức thanh toán không hợp lệ." } };
  }
  if (manual && paymentMethod !== "AT_STORE") {
    return { status: 400, body: { message: "Lịch tạo hộ khách chỉ hỗ trợ thanh toán tại cơ sở." } };
  }

  let customer = null;
  if (customerId) {
    const r = await pool.request().input("id", sql.Int, Number(customerId)).query("SELECT TOP 1 * FROM dbo.customers WHERE id=@id AND is_active=1");
    customer = r.recordset[0] || null;
  } else {
    customer = await getCustomerByUserId(pool, userId);
  }
  if (!customer) return { status: 404, body: { message: "Tài khoản chưa có hồ sơ khách hàng." } };

  // Giới hạn chống chiếm giờ ảo chỉ áp cho khách tự đặt; nhân viên tạo hộ thì không bị giới hạn.
  if (!manual) {
    const ruleError = await customerBookingRuleError(pool, customer.id);
    if (ruleError) return { status: ruleError.status, body: { message: ruleError.message } };
  }

  const serviceResult = await pool.request()
    .input("serviceId", sql.Int, Number(serviceId))
    .query(`
      SELECT TOP 1 s.id, s.name, s.duration_minutes, s.price, c.name AS category_name
      FROM dbo.services s
      INNER JOIN dbo.categories c ON c.id=s.category_id
      WHERE s.id=@serviceId AND s.is_active=1 AND c.is_active=1
    `);
  const service = serviceResult.recordset[0];
  if (!service) return { status: 400, body: { message: "Dịch vụ không tồn tại hoặc đã ngừng cung cấp." } };

  const start = timeToMin(time);
  const end = start + Number(service.duration_minutes);
  const cfgHours = policyConfig();
  if (start < cfgHours.openMinutes || end > cfgHours.closeMinutes) {
    return { status: 400, body: { message: `Giờ đặt phải nằm trong ${minutesToHHMM(cfgHours.openMinutes)}–${minutesToHHMM(cfgHours.closeMinutes)}.` } };
  }

  const windowError = validateBookingWindow(date, start, manual ? { leadMinutes: -15 } : undefined);
  if (windowError) return { status: 400, body: { message: windowError } };

  // Chế độ "Bất kỳ nhân viên": thử lần lượt từng người rảnh; chỉ chuyển người khác khi bị người khác đặt trước (409).
  if (wantsAny) {
    const ranked = await rankFreeStaffForSlot(pool, { serviceId, date, start, end });
    if (!ranked.length) return { status: 409, body: { message: "Không còn nhân viên nào trống vào khung giờ này. Vui lòng chọn giờ khác." } };
    let last = null;
    for (const id of ranked) {
      last = await createAppointmentCore(pool, { ...opts, staffId: id, _autoAssigned: true });
      if (last.status !== 409) return last;
    }
    return last;
  }

  const staffResult = await pool.request()
    .input("staffId", sql.Int, Number(staffId))
    .query(`SELECT TOP 1 id, full_name, specialties FROM dbo.staff WHERE id=@staffId AND is_active=1`);
  const staff = staffResult.recordset[0];
  if (!staff) return { status: 400, body: { message: "Nhân viên không tồn tại hoặc không hoạt động." } };

  const suitable = await staffSuitableForService(pool, staff.id, service.id);
  if (!suitable) {
    return { status: 400, body: { message: "Nhân viên bạn chọn chưa được phân công cho dịch vụ này." } };
  }

  const effectiveSchedules = await getEffectiveSchedules(pool, Number(staffId), date);
  const inSchedule = effectiveSchedules.some((s) => start >= timeToMin(s.start_time) && end <= timeToMin(s.end_time));
  if (!inSchedule) return { status: 400, body: { message: "Khung giờ bạn chọn nằm ngoài lịch làm việc của nhân viên." } };

  const buffer = policyConfig().slotBufferMinutes;
  const appointmentCode = makeAppointmentCode(date, crypto.randomBytes(4).toString("hex"));
  const startText = `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}:00`;
  const endText = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}:00`;
  const initialStatus = autoConfirm ? "CONFIRMED" : "PENDING";
  const actorId = actorUserId ?? userId ?? null;

  // Transaction + serializable lock: prevent two users from booking the same slot concurrently.
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    // Kiểm tra lại giới hạn lịch chờ / không đến NGAY TRONG transaction: đặt song song không thể vượt giới hạn.
    if (!manual) {
      const ruleErrorTx = await customerBookingRuleError(transaction, customer.id);
      if (ruleErrorTx) {
        await transaction.rollback();
        return { status: ruleErrorTx.status, body: { message: ruleErrorTx.message } };
      }
    }

    const conflicts = await new sql.Request(transaction)
      .input("staffId", sql.Int, Number(staffId))
      .input("date", sql.Date, date)
      .query(`
        SELECT a.id, a.start_time, a.end_time
        FROM dbo.appointments a WITH (UPDLOCK, HOLDLOCK)
        WHERE a.staff_id=@staffId AND a.appointment_date=@date AND a.status IN ('PENDING','CONFIRMED')
      `);

    for (const row of conflicts.recordset) {
      if (overlapsWithBuffer(start, end, timeToMin(row.start_time), timeToMin(row.end_time), buffer)) {
        await transaction.rollback();
        return { status: 409, body: { message: "Khung giờ này vừa được người khác đặt. Vui lòng chọn giờ khác." } };
      }
    }

    const insertResult = await new sql.Request(transaction)
      .input("code", sql.VarChar, appointmentCode)
      .input("customerId", sql.Int, customer.id)
      .input("serviceId", sql.Int, Number(serviceId))
      .input("staffId", sql.Int, Number(staffId))
      .input("date", sql.Date, date)
      .input("start", sql.VarChar, startText)
      .input("end", sql.VarChar, endText)
      .input("priceAtBooking", sql.Decimal(12, 2), Number(service.price))
      .input("note", sql.NVarChar, note?.trim() || null)
      .input("status", sql.VarChar, initialStatus)
      .input("source", sql.VarChar, source)
      .input("createdBy", sql.Int, actorUserId ?? null)
      .input("autoAssigned", sql.Bit, _autoAssigned ? 1 : 0)
      .query(`
        INSERT INTO dbo.appointments
          (appointment_code, customer_id, service_id, staff_id, appointment_date, start_time, end_time,
           price_at_booking, note, status, confirmed_at, source, created_by_user_id, auto_assigned)
        OUTPUT INSERTED.id, INSERTED.appointment_code
        VALUES (@code, @customerId, @serviceId, @staffId, @date, @start, @end,
                @priceAtBooking, @note, @status, CASE WHEN @status='CONFIRMED' THEN SYSDATETIME() END, @source, @createdBy, @autoAssigned)
      `);

    const inserted = insertResult.recordset[0];
    await new sql.Request(transaction)
      .input("appointmentId", sql.Int, inserted.id)
      .input("newStatus", sql.VarChar, initialStatus)
      .input("changedBy", sql.Int, actorUserId ?? null)
      .input("reason", sql.NVarChar, manual ? `Nhân viên tạo hộ khách (${source}).` : null)
      .query(`INSERT INTO dbo.appointment_status_history(appointment_id, old_status, new_status, changed_by, reason) VALUES(@appointmentId,NULL,@newStatus,@changedBy,@reason)`);

    const paymentCode = `HKPAY-${inserted.appointment_code}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`.slice(0, 50);
    await new sql.Request(transaction)
      .input("appointmentId", sql.Int, inserted.id)
      .input("paymentCode", sql.VarChar, paymentCode)
      .input("amount", sql.Decimal(12, 2), Number(service.price))
      .input("paymentMethod", sql.VarChar, paymentMethod)
      .query(`
        INSERT INTO dbo.payments (appointment_id, payment_code, amount, payment_method, payment_status)
        VALUES (@appointmentId, @paymentCode, @amount, @paymentMethod, 'PENDING')
      `);

    await transaction.commit();

    // Đồng bộ danh sách lịch hẹn ngay lập tức cho ADMIN/STAFF; CUSTOMER nhận cập nhật lịch của chính mình.
    await emitAppointmentsChanged();
    if (customer.user_id) emitToUser(Number(customer.user_id), "appointments:changed", { scope: "CUSTOMER" });

    // Thông báo / audit / email chạy NỀN sau khi đã commit: không làm chậm phản hồi và không thể làm hỏng việc đặt lịch.
    runBackground("sau khi đặt lịch", async () => {
      const when = `${String(time).slice(0, 5)} ngày ${date}`;
      await addNotification(pool, customer.user_id, "Đặt lịch thành công",
        autoConfirm ? `Lịch ${inserted.appointment_code} đã được cửa hàng tạo và xác nhận cho bạn.` : `Lịch ${inserted.appointment_code} đã được tạo và đang chờ xác nhận.`,
        "BOOKING_CREATED");
      const staffUserResult = await pool.request().input("staffId", sql.Int, Number(staffId)).query("SELECT TOP 1 user_id FROM dbo.staff WHERE id=@staffId");
      const staffUserId = staffUserResult.recordset[0]?.user_id;
      const bookingMessage = `${customer.full_name} đã đặt ${service.name} lúc ${when} với ${staff.full_name}${_autoAssigned ? " (hệ thống tự phân công)" : ""}. Giá chốt: ${Number(service.price).toLocaleString("vi-VN")}đ.`;
      await addNotification(pool, staffUserId, "Có lịch hẹn mới", bookingMessage, "NEW_APPOINTMENT");
      await notifyAdmins(pool, "Có lịch hẹn mới", bookingMessage, "NEW_APPOINTMENT");
      await writeAudit(pool, { userId: actorId, action: manual ? "CREATE_APPOINTMENT_MANUAL" : "CREATE_APPOINTMENT", entityType: "APPOINTMENT", entityId: inserted.id, description: `Tạo lịch ${inserted.appointment_code} (${source}), ${service.name}, ${date} ${time}, ${staff.full_name}. Giá chốt: ${Number(service.price).toLocaleString("vi-VN")}đ.`, req });

      if (customer.email) {
        const tpl = mailTemplates.bookingCreated({ name: customer.full_name, code: inserted.appointment_code, service: service.name, date, time: String(time).slice(0, 5), staff: staff.full_name, confirmed: autoConfirm });
        void sendMail({ to: customer.email, ...tpl });
      }
    });

    return {
      status: 201,
      body: {
        message: "Đặt lịch thành công.",
        id: inserted.id,
        appointment_code: inserted.appointment_code,
        status: initialStatus.toLowerCase(),
        payment_method: paymentMethod,
        payment_status: "pending",
        amount: Number(service.price),
        staff_id: staff.id,
        staff_name: staff.full_name,
        auto_assigned: !!_autoAssigned,
      },
      // Dữ liệu tiện dùng để chatbot soạn câu trả lời (không ảnh hưởng route REST vì client cũ chỉ đọc các field ở trên).
      meta: { service, staff, customer, date, time, start, end },
    };
  } catch (transactionError) {
    try { await transaction.rollback(); } catch { /* đã rollback */ }
    // Unique index ở CSDL chặn trùng giờ bắt đầu: coi như vừa bị người khác đặt.
    if ((transactionError?.number === 2601 || transactionError?.number === 2627) && /UX_appointments_staff_slot_active/.test(String(transactionError.message))) {
      return { status: 409, body: { message: "Khung giờ này vừa được người khác đặt. Vui lòng chọn giờ khác." } };
    }
    // Deadlock (1205) khi nhiều yêu cầu đặt lịch cùng lúc ở mức SERIALIZABLE: bảo khách thử lại thay vì lỗi 500.
    if (transactionError?.number === 1205) {
      logger.warn("Deadlock khi đặt lịch", { staffId, date, time });
      return { status: 409, body: { message: "Hệ thống đang bận xử lý nhiều yêu cầu cùng lúc. Vui lòng thử lại sau vài giây." } };
    }
    throw transactionError;
  }
}

router.post("/", authenticateToken, requireCustomer, async (req, res) => {
  try {
    const { serviceId, staffId, date, time, note, paymentMethod } = req.body || {};
    const pool = await poolPromise;
    const result = await createAppointmentCore(pool, { userId: req.user.id, serviceId, staffId, date, time, note, paymentMethod, req });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error("POST appointments:", error);
    res.status(500).json({ message: "Lỗi server khi đặt lịch." });
  }
});

router.post("/my/:id/cancel", authenticateToken, requireCustomer, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const reason = String(req.body?.reason || "").trim();
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "ID lịch hẹn không hợp lệ." });
    if (!reason) return res.status(400).json({ message: "Vui lòng nhập lý do hủy lịch." });

    const pool = await poolPromise;
    const customer = await getCustomerByUserId(pool, req.user.id);
    if (!customer) return res.status(404).json({ message: "Chưa có hồ sơ khách hàng." });
    const result = await pool.request().input("id", sql.Int, id).input("customerId", sql.Int, customer.id).query(`
      SELECT TOP 1 a.id,a.appointment_code,a.status,a.appointment_date,a.start_time,p.payment_status,
             st.user_id AS staff_user_id
      FROM dbo.appointments a LEFT JOIN dbo.staff st ON st.id=a.staff_id LEFT JOIN dbo.payments p ON p.appointment_id=a.id
      WHERE a.id=@id AND a.customer_id=@customerId
    `);
    const row = result.recordset[0];
    if (!row) return res.status(404).json({ message: "Không tìm thấy lịch hẹn của bạn." });
    const current = normalizeStatus(row.status);
    if (!["PENDING", "CONFIRMED"].includes(current)) return res.status(409).json({ message: "Chỉ được hủy lịch PENDING hoặc CONFIRMED." });

    // Chính sách hủy: lịch đã xác nhận/đã trả tiền phải hủy trước giờ hẹn tối thiểu N giờ.
    const policy = checkCustomerChange({ date: toDate(row.appointment_date), time: toTime(row.start_time), status: current, paid: String(row.payment_status || "").toUpperCase() === "PAID" }, "cancel");
    if (!policy.ok) return res.status(403).json({ message: policy.message, code: "CANCEL_WINDOW_CLOSED" });

    // Toàn bộ thay đổi nằm trong MỘT transaction: lỗi giữa chừng thì không để dữ liệu lệch.
    let refundNeeded = false;
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      const upd = await new sql.Request(tx).input("id", sql.Int, id).input("customerId", sql.Int, customer.id).input("reason", sql.NVarChar, reason).query(`
        UPDATE dbo.appointments SET status='CANCELLED', cancelled_at=SYSDATETIME(), cancellation_reason=@reason, updated_at=SYSDATETIME()
        WHERE id=@id AND customer_id=@customerId AND status IN ('PENDING','CONFIRMED')
      `);
      if (!upd.rowsAffected[0]) { await tx.rollback(); return res.status(409).json({ message: "Lịch hẹn vừa được cập nhật. Vui lòng tải lại trang." }); }
      await new sql.Request(tx).input("id", sql.Int, id).input("oldStatus", sql.VarChar, current).input("reason", sql.NVarChar, reason).input("by", sql.Int, req.user.id).query(`
        INSERT INTO dbo.appointment_status_history(appointment_id,old_status,new_status,changed_by,reason) VALUES(@id,@oldStatus,'CANCELLED',@by,@reason)
      `);
      // Khoản CHƯA thanh toán -> hủy; khoản ĐÃ thanh toán -> giữ nguyên và đánh dấu "cần hoàn tiền" cho Admin.
      await new sql.Request(tx).input("id", sql.Int, id).query(`UPDATE dbo.payments SET payment_status='CANCELLED', updated_at=SYSDATETIME() WHERE appointment_id=@id AND payment_status='PENDING'`);
      const flag = await new sql.Request(tx).input("id", sql.Int, id).query(`UPDATE dbo.payments SET refund_requested_at=COALESCE(refund_requested_at,SYSDATETIME()), updated_at=SYSDATETIME() WHERE appointment_id=@id AND payment_status='PAID'`);
      refundNeeded = flag.rowsAffected[0] > 0;
      await new sql.Request(tx).input("id", sql.Int, id).query(`UPDATE dbo.appointment_reschedule_requests SET status='CANCELLED',updated_at=SYSDATETIME() WHERE appointment_id=@id AND status='REQUESTED'`);
      await tx.commit();
    } catch (txError) {
      try { await tx.rollback(); } catch { /* đã rollback */ }
      throw txError;
    }

    await emitAppointmentsChanged();
    // Hủy link thanh toán payOS để QR cũ không còn dùng được (nếu khoản đó chưa thanh toán).
    if (!refundNeeded) void cancelPayOSLinkForAppointment(id, "Khách hủy lịch");
    const cancelMessage = `Lịch ${row.appointment_code} đã được khách hủy. Lý do: ${reason}`;
    await addNotification(pool, row.staff_user_id, "Khách hủy lịch", cancelMessage, "APPOINTMENT_CANCELLED");
    await notifyAdmins(pool, "Khách hủy lịch", cancelMessage, "APPOINTMENT_CANCELLED");
    if (refundNeeded) {
      await notifyAdmins(pool, "Cần hoàn tiền", `Lịch ${row.appointment_code} đã hủy sau khi khách thanh toán online. Hãy hoàn tiền cho khách rồi ghi nhận mã giao dịch hoàn.`, "REFUND_REQUIRED");
      await addNotification(pool, req.user.id, "Yêu cầu hoàn tiền đã được ghi nhận", `Cửa hàng sẽ hoàn tiền cho lịch ${row.appointment_code}. Bạn sẽ nhận thông báo khi hoàn tất.`, "REFUND_REQUESTED");
    }
    await writeAudit(pool, { userId: req.user.id, action: "CUSTOMER_CANCEL_APPOINTMENT", entityType: "APPOINTMENT", entityId: id, description: reason, req });
    if (customer.email) void sendMail({ to: customer.email, ...mailTemplates.statusChanged({ name: customer.full_name, code: row.appointment_code, statusText: "đã được hủy theo yêu cầu của bạn" }) });
    res.json({ message: refundNeeded ? "Hủy lịch thành công. Cửa hàng sẽ hoàn tiền cho bạn." : "Hủy lịch thành công.", refund_requested: refundNeeded });
  } catch (error) {
    console.error("POST customer cancel:", error);
    res.status(500).json({ message: "Không thể hủy lịch hẹn." });
  }
});

router.patch("/:id", authenticateToken, requireAdminOrStaff, async (req, res) => {
  try {
    const nextStatus = normalizeStatus(req.body?.status);
    const cancellationReason = String(req.body?.cancellationReason || "").trim() || null;
    const id = Number(req.params.id);

    if (!['PENDING','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW'].includes(nextStatus)) {
      return res.status(400).json({ message: "Trạng thái không hợp lệ." });
    }
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID lịch hẹn không hợp lệ." });
    }

    const pool = await poolPromise;
    const currentRequest = pool.request().input("id", sql.Int, id);
    let ownershipClause = "";
    if (req.user.role === "STAFF") {
      currentRequest.input("userId", sql.Int, Number(req.user.id));
      ownershipClause = "AND EXISTS (SELECT 1 FROM dbo.staff st WHERE st.id=a.staff_id AND st.user_id=@userId AND st.is_active=1)";
    }
    const currentResult = await currentRequest
      .query(`SELECT TOP 1 a.id, a.status, a.appointment_date, a.start_time,
                     p.payment_method, p.payment_status
              FROM dbo.appointments a
              LEFT JOIN dbo.payments p ON p.appointment_id=a.id
              WHERE a.id=@id ${ownershipClause}`);

    if (!currentResult.recordset.length) {
      return res.status(404).json({ message: "Không tìm thấy lịch hẹn." });
    }

    const currentStatus = normalizeStatus(currentResult.recordset[0].status);
    if (currentStatus === nextStatus) {
      return res.json({ ok: true, status: currentStatus.toLowerCase(), message: "Lịch hẹn đã ở trạng thái này." });
    }

    if (!canTransition(currentStatus, nextStatus)) {
      return res.status(409).json({ message: `Không thể chuyển trạng thái từ ${currentStatus} sang ${nextStatus}.` });
    }
    // Không hoàn thành / đánh dấu không đến trước giờ hẹn; lịch tại cơ sở phải thu tiền trước khi hoàn thành.
    const changeError = checkStatusChange({
      to: nextStatus,
      date: toDate(currentResult.recordset[0].appointment_date),
      time: toTime(currentResult.recordset[0].start_time),
      paymentMethod: currentResult.recordset[0].payment_method,
      paymentStatus: currentResult.recordset[0].payment_status,
    });
    if (changeError) return res.status(409).json({ message: changeError });
    // Lịch thanh toán ONLINE chỉ được xác nhận khi payOS đã báo PAID (tự động qua webhook).
    // Không cho Admin/Staff "xác nhận tay" để tránh giữ chỗ khi khách chưa trả tiền.
    if (nextStatus === 'CONFIRMED') {
      const pm = String(currentResult.recordset[0].payment_method || '').toUpperCase();
      const ps = String(currentResult.recordset[0].payment_status || '').toUpperCase();
      if (pm === 'ONLINE' && ps !== 'PAID') {
        return res.status(409).json({ message: "Lịch thanh toán online chỉ được xác nhận sau khi khách thanh toán thành công." });
      }
    }
    if (nextStatus === 'CANCELLED' && !cancellationReason) {
      return res.status(400).json({ message: "Vui lòng nhập lý do hủy lịch." });
    }

    const tx = new sql.Transaction(pool);
    try {
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

      const request = new sql.Request(tx);
      request.input("id", sql.Int, id);
      request.input("oldStatus", sql.VarChar, currentStatus);
      request.input("status", sql.VarChar, nextStatus);
      request.input("changedBy", sql.Int, req.user.id);
      request.input("reason", sql.NVarChar, cancellationReason);

      const updateResult = await request.query(`
        UPDATE dbo.appointments
        SET status=@status,
            confirmed_at=CASE WHEN @status='CONFIRMED' THEN COALESCE(confirmed_at,SYSDATETIME()) ELSE confirmed_at END,
            completed_at=CASE WHEN @status='COMPLETED' THEN COALESCE(completed_at,SYSDATETIME()) ELSE completed_at END,
            cancelled_at=CASE WHEN @status='CANCELLED' THEN COALESCE(cancelled_at,SYSDATETIME()) ELSE cancelled_at END,
            cancellation_reason=CASE WHEN @status='CANCELLED' THEN @reason ELSE cancellation_reason END,
            updated_at=SYSDATETIME()
        WHERE id=@id AND status=@oldStatus;

        INSERT INTO dbo.appointment_status_history
          (appointment_id, old_status, new_status, changed_by, reason)
        SELECT @id, @oldStatus, @status, @changedBy, @reason;
      `);

      if (!updateResult.rowsAffected[0]) {
        await tx.rollback();
        return res.status(409).json({ message: "Lịch hẹn vừa được cập nhật bởi người khác. Vui lòng tải lại trang." });
      }

      let refundFlagged = false;
      if (nextStatus === 'CANCELLED') {
        await new sql.Request(tx)
          .input("appointmentId", sql.Int, id)
          .query(`UPDATE dbo.payments SET payment_status='CANCELLED', updated_at=SYSDATETIME() WHERE appointment_id=@appointmentId AND payment_status='PENDING'`);
        const flag = await new sql.Request(tx)
          .input("appointmentId", sql.Int, id)
          .query(`UPDATE dbo.payments SET refund_requested_at=COALESCE(refund_requested_at,SYSDATETIME()), updated_at=SYSDATETIME() WHERE appointment_id=@appointmentId AND payment_status='PAID'`);
        refundFlagged = flag.rowsAffected[0] > 0;
      }

      await tx.commit();

      // Đồng bộ danh sách lịch hẹn sau khi đổi trạng thái.
      await emitAppointmentsChanged();
      if (nextStatus === 'CANCELLED' && !refundFlagged) void cancelPayOSLinkForAppointment(id, "Lịch bị hủy");

      const detail = await pool.request().input("id", sql.Int, id).query(`${baseSelect} WHERE a.id=@id`);
      const row = detail.recordset[0];
      const customerUser = await pool.request().input("customerId", sql.Int, row.customer_id).query("SELECT TOP 1 user_id FROM dbo.customers WHERE id=@customerId");
      const staffUser = row.staff_id ? await pool.request().input("staffId", sql.Int, row.staff_id).query("SELECT TOP 1 user_id FROM dbo.staff WHERE id=@staffId") : { recordset: [] };
      const customerUserId = customerUser.recordset[0]?.user_id;
      const staffUserId = staffUser.recordset[0]?.user_id;
      const statusText = nextStatus === "CONFIRMED" ? "đã được xác nhận" : nextStatus === "COMPLETED" ? "đã hoàn thành" : nextStatus === "CANCELLED" ? "đã bị hủy" : "được đánh dấu không đến";
      const statusMessage = `Lịch ${row.appointment_code} ${statusText}.`;
      await addNotification(pool, customerUserId, "Cập nhật lịch hẹn", statusMessage, "APPOINTMENT_STATUS");
      await addNotification(pool, staffUserId, "Cập nhật lịch hẹn", statusMessage, "APPOINTMENT_STATUS");
      if (req.user.role === "STAFF") await notifyAdmins(pool, "STAFF cập nhật lịch hẹn", `${statusMessage} Người thực hiện: ${req.user.username || req.user.id}.`, "APPOINTMENT_STATUS");
      await writeAudit(pool, { userId: req.user.id, action: "UPDATE_APPOINTMENT_STATUS", entityType: "APPOINTMENT", entityId: id, description: `${currentStatus} → ${nextStatus}${cancellationReason ? `: ${cancellationReason}` : ""}`, req });
      if (refundFlagged) await notifyAdmins(pool, "Cần hoàn tiền", `Lịch ${row.appointment_code} đã hủy sau khi khách thanh toán online. Hãy hoàn tiền cho khách rồi ghi nhận mã giao dịch hoàn.`, "REFUND_REQUIRED");
      if (["CONFIRMED", "CANCELLED"].includes(nextStatus) && row.customer_email) {
        void sendMail({ to: row.customer_email, ...mailTemplates.statusChanged({ name: row.customer_name, code: row.appointment_code, statusText }) });
      }
      return res.json({ ok: true, status: nextStatus.toLowerCase() });
    } catch (transactionError) {
      try { await tx.rollback(); } catch {}
      throw transactionError;
    }
  } catch (error) {
    console.error("PATCH appointments:", error);
    res.status(500).json({ message: "Không thể cập nhật trạng thái lịch hẹn." });
  }
});

// Tải file .ics để thêm lịch vào Google/Apple/Outlook Calendar. Khách chỉ tải được lịch của mình.
router.get("/:id/ics", authenticateToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "ID lịch hẹn không hợp lệ." });
    const pool = await poolPromise;
    const r = await pool.request().input("id", sql.Int, id).query(`
      SELECT TOP 1 a.appointment_code, a.appointment_date, a.start_time, a.end_time, a.status,
             s.name AS service_name, st.full_name AS staff_name, c.user_id AS customer_user_id, st.user_id AS staff_user_id
      FROM dbo.appointments a
      INNER JOIN dbo.services s ON s.id=a.service_id
      INNER JOIN dbo.customers c ON c.id=a.customer_id
      LEFT JOIN dbo.staff st ON st.id=a.staff_id
      WHERE a.id=@id`);
    const a = r.recordset[0];
    const uid = Number(req.user.id);
    const allowed = a && (req.user.role === "ADMIN" || Number(a.customer_user_id) === uid || (req.user.role === "STAFF" && Number(a.staff_user_id) === uid));
    if (!allowed) return res.status(404).json({ message: "Không tìm thấy lịch hẹn." });
    if (["CANCELLED", "NO_SHOW"].includes(normalizeStatus(a.status))) return res.status(409).json({ message: "Lịch này đã không còn hiệu lực." });
    const ics = buildICS({ code: a.appointment_code, service: a.service_name, staff: a.staff_name, date: toDate(a.appointment_date), startTime: toTime(a.start_time), endTime: toTime(a.end_time), location: process.env.STORE_ADDRESS || "" });
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${a.appointment_code}.ics"`);
    res.send(ics);
  } catch (error) {
    logger.error("GET appointment ics", { err: error });
    res.status(500).json({ message: "Không thể tạo file lịch." });
  }
});

/*
 * ADMIN chuyển lịch sang nhân viên khác và/hoặc giờ khác (vd: nhân viên nghỉ đột xuất, xin nghỉ phép cần dọn lịch).
 * Dùng lại đúng quy tắc đặt lịch: nhân viên phụ trách dịch vụ, nằm trong ca làm, không chồng lấn (kể cả thời gian đệm),
 * kiểm tra trong transaction SERIALIZABLE.
 */
router.patch("/:id/reassign", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "ID lịch hẹn không hợp lệ." });
    const newStaffId = Number(req.body?.staffId);
    if (!Number.isInteger(newStaffId) || newStaffId <= 0) return res.status(400).json({ message: "Vui lòng chọn nhân viên mới." });
    const reason = String(req.body?.reason || "").trim().slice(0, 300) || null;

    const pool = await poolPromise;
    const cur = await pool.request().input("id", sql.Int, id).query(`
      SELECT TOP 1 a.id, a.appointment_code, a.status, a.staff_id, a.service_id, a.appointment_date, a.start_time,
             s.duration_minutes, s.name AS service_name,
             c.user_id AS customer_user_id, c.full_name AS customer_name, c.email AS customer_email,
             ost.user_id AS old_staff_user_id, ost.full_name AS old_staff_name
      FROM dbo.appointments a
      INNER JOIN dbo.services s ON s.id=a.service_id
      INNER JOIN dbo.customers c ON c.id=a.customer_id
      LEFT JOIN dbo.staff ost ON ost.id=a.staff_id
      WHERE a.id=@id
    `);
    const appt = cur.recordset[0];
    if (!appt) return res.status(404).json({ message: "Không tìm thấy lịch hẹn." });
    if (!["PENDING", "CONFIRMED"].includes(normalizeStatus(appt.status))) {
      return res.status(409).json({ message: "Chỉ chuyển được lịch đang chờ hoặc đã xác nhận." });
    }

    const oldDate = toDate(appt.appointment_date);
    const oldTime = toTime(appt.start_time);
    const newDate = req.body?.date ? String(req.body.date) : oldDate;
    const newTime = req.body?.time ? String(req.body.time).slice(0, 5) : oldTime;
    const moved = newDate !== oldDate || newTime !== oldTime;
    const sameStaff = Number(appt.staff_id) === newStaffId;
    if (!moved && sameStaff) return res.status(400).json({ message: "Lịch không thay đổi nhân viên hoặc thời gian." });

    const start = timeToMin(newTime);
    const end = start + Number(appt.duration_minutes);
    const cfgHours = policyConfig();
    if (start < cfgHours.openMinutes || end > cfgHours.closeMinutes) {
      return res.status(400).json({ message: `Giờ hẹn phải nằm trong ${minutesToHHMM(cfgHours.openMinutes)}–${minutesToHHMM(cfgHours.closeMinutes)}.` });
    }
    if (moved) {
      const windowError = validateBookingWindow(newDate, start, { leadMinutes: -15 });
      if (windowError) return res.status(400).json({ message: windowError });
    }

    const newStaffRow = await pool.request().input("id", sql.Int, newStaffId).query("SELECT TOP 1 id, user_id, full_name FROM dbo.staff WHERE id=@id AND is_active=1");
    const newStaff = newStaffRow.recordset[0];
    if (!newStaff) return res.status(400).json({ message: "Nhân viên mới không tồn tại hoặc không hoạt động." });
    if (!(await staffSuitableForService(pool, newStaffId, appt.service_id))) {
      return res.status(400).json({ message: "Nhân viên mới chưa được phân công cho dịch vụ này." });
    }

    const tx = new sql.Transaction(pool);
    try {
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      const schedules = await getEffectiveSchedules(pool, newStaffId, newDate, tx);
      if (!schedules.some((sc) => start >= timeToMin(sc.start_time) && end <= timeToMin(sc.end_time))) {
        await tx.rollback();
        return res.status(409).json({ message: "Khung giờ nằm ngoài ca làm của nhân viên mới." });
      }
      const conflicts = await new sql.Request(tx)
        .input("staffId", sql.Int, newStaffId).input("date", sql.Date, newDate).input("id", sql.Int, id)
        .query(`SELECT a.start_time, a.end_time FROM dbo.appointments a WITH (UPDLOCK, HOLDLOCK)
                WHERE a.staff_id=@staffId AND a.appointment_date=@date AND a.status IN ('PENDING','CONFIRMED') AND a.id<>@id`);
      const buffer = policyConfig().slotBufferMinutes;
      if (conflicts.recordset.some((r) => overlapsWithBuffer(start, end, timeToMin(r.start_time), timeToMin(r.end_time), buffer))) {
        await tx.rollback();
        return res.status(409).json({ message: "Nhân viên mới đã có lịch trùng khung giờ này." });
      }
      const upd = await new sql.Request(tx)
        .input("id", sql.Int, id).input("staffId", sql.Int, newStaffId).input("date", sql.Date, newDate)
        .input("start", sql.VarChar, `${minutesToHHMM(start)}:00`).input("end", sql.VarChar, `${minutesToHHMM(end)}:00`)
        .input("oldStatus", sql.VarChar, normalizeStatus(appt.status))
        .query(`UPDATE dbo.appointments
                SET staff_id=@staffId, appointment_date=@date, start_time=@start, end_time=@end, auto_assigned=0,
                    reminder_sent_at=CASE WHEN @date<>appointment_date OR @start<>CONVERT(VARCHAR(8),start_time,108) THEN NULL ELSE reminder_sent_at END,
                    updated_at=SYSDATETIME()
                WHERE id=@id AND status=@oldStatus`);
      if (!upd.rowsAffected[0]) { await tx.rollback(); return res.status(409).json({ message: "Lịch hẹn vừa được cập nhật. Vui lòng tải lại trang." }); }
      const historyReason = `Admin chuyển lịch: ${appt.old_staff_name || "?"} ${oldDate} ${oldTime} → ${newStaff.full_name} ${newDate} ${newTime}${reason ? `. Lý do: ${reason}` : ""}`.slice(0, 400);
      await new sql.Request(tx).input("id", sql.Int, id).input("st", sql.VarChar, normalizeStatus(appt.status)).input("by", sql.Int, req.user.id).input("reason", sql.NVarChar, historyReason)
        .query("INSERT INTO dbo.appointment_status_history(appointment_id,old_status,new_status,changed_by,reason) VALUES(@id,@st,@st,@by,@reason)");
      await new sql.Request(tx).input("id", sql.Int, id)
        .query("UPDATE dbo.appointment_reschedule_requests SET status='CANCELLED', updated_at=SYSDATETIME() WHERE appointment_id=@id AND status='REQUESTED'");
      await tx.commit();
    } catch (txError) {
      try { await tx.rollback(); } catch { /* đã rollback */ }
      if ((txError?.number === 2601 || txError?.number === 2627) && /UX_appointments_staff_slot_active/.test(String(txError.message))) {
        return res.status(409).json({ message: "Nhân viên mới đã có lịch trùng giờ bắt đầu." });
      }
      if (txError?.number === 1205) return res.status(409).json({ message: "Hệ thống đang bận, vui lòng thử lại." });
      throw txError;
    }

    await emitAppointmentsChanged();
    if (appt.customer_user_id) emitToUser(Number(appt.customer_user_id), "appointments:changed", { scope: "CUSTOMER" });
    runBackground("sau khi chuyển lịch", async () => {
      const msg = `Lịch ${appt.appointment_code} (${appt.service_name}) đã được cửa hàng chuyển sang ${newStaff.full_name}, ${newTime} ngày ${newDate}.${reason ? ` Lý do: ${reason}` : ""}`;
      await addNotification(pool, appt.customer_user_id, "Lịch hẹn được điều chỉnh", msg, "APPOINTMENT_REASSIGNED");
      await addNotification(pool, newStaff.user_id, "Có lịch hẹn mới được chuyển cho bạn", msg, "APPOINTMENT_REASSIGNED");
      if (appt.old_staff_user_id && Number(appt.staff_id) !== newStaffId) {
        await addNotification(pool, appt.old_staff_user_id, "Lịch hẹn đã chuyển cho nhân viên khác", `Lịch ${appt.appointment_code} không còn thuộc lịch của bạn.`, "APPOINTMENT_REASSIGNED");
      }
      await writeAudit(pool, { userId: req.user.id, action: "REASSIGN_APPOINTMENT", entityType: "APPOINTMENT", entityId: id, description: msg, req });
      if (appt.customer_email) void sendMail({ to: appt.customer_email, ...mailTemplates.statusChanged({ name: appt.customer_name, code: appt.appointment_code, statusText: `được điều chỉnh: ${newStaff.full_name}, ${newTime} ngày ${newDate}` }) });
    });
    res.json({ ok: true, staff_id: newStaffId, staff_name: newStaff.full_name, date: newDate, time: newTime });
  } catch (error) {
    logger.error("PATCH reassign appointment", { err: error });
    res.status(500).json({ message: "Không thể chuyển lịch hẹn." });
  }
});

/* ---------- Chính sách công khai (giao diện dùng để hiển thị cho khách) ---------- */
router.get("/policy", (req, res) => {
  const cfg = policyConfig();
  res.json({
    cancel_min_hours: cfg.cancelMinHours,
    reschedule_min_hours: cfg.rescheduleMinHours,
    max_active_bookings: cfg.maxActiveBookings,
    store_pending_expire_minutes: cfg.storePendingExpireMinutes,
    slot_buffer_minutes: cfg.slotBufferMinutes,
    open_time: minutesToHHMM(cfg.openMinutes),
    close_time: minutesToHHMM(cfg.closeMinutes),
    slot_step_minutes: cfg.slotStepMinutes,
    reminder_hours: cfg.reminderHours,
    email_enabled: isMailConfigured(),
  });
});

/* ---------- Admin/Staff tạo lịch hộ khách (walk-in / điện thoại) ---------- */
async function resolveActorStaffId(pool, user) {
  if (user.role !== "STAFF") return null;
  const r = await pool.request().input("userId", sql.Int, Number(user.id))
    .query("SELECT TOP 1 id FROM dbo.staff WHERE user_id=@userId AND is_active=1");
  return r.recordset[0]?.id ?? null;
}

router.get("/manual/options", authenticateToken, requireAdminOrStaff, async (req, res) => {
  try {
    const serviceId = Number(req.query.serviceId);
    const date = String(req.query.date || "");
    if (!Number.isInteger(serviceId) || serviceId <= 0 || !isValidISODate(date)) {
      return res.status(400).json({ message: "Thiếu hoặc sai serviceId/date." });
    }
    const pool = await poolPromise;
    let onlyStaffId = null;
    if (req.user.role === "STAFF") {
      onlyStaffId = await resolveActorStaffId(pool, req.user);
      if (!onlyStaffId) return res.status(404).json({ message: "Tài khoản chưa liên kết hồ sơ nhân viên." });
    }
    const data = await computeBookingOptions(pool, { serviceId, date, onlyStaffId, leadMinutes: -15 });
    if (!data) return res.status(404).json({ message: "Không tìm thấy dịch vụ." });
    res.json(data);
  } catch (error) {
    console.error("GET manual options:", error);
    res.status(500).json({ message: "Không tải được khung giờ trống." });
  }
});

router.get("/manual/customers", authenticateToken, requireAdminOrStaff, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return res.json([]);
    const pool = await poolPromise;
    const request = pool.request();
    let where;
    if (req.user.role === "ADMIN") {
      request.input("like", sql.NVarChar, `%${q.replace(/[%_[]/g, "")}%`);
      where = "(c.phone LIKE @like OR c.full_name LIKE @like)";
    } else {
      // Nhân viên chỉ tra được khách khi nhập đúng SĐT (không duyệt toàn bộ danh bạ khách).
      const phone = normalizeVNPhone(q);
      if (!phone) return res.json([]);
      request.input("phone", sql.VarChar, phone);
      where = "c.phone=@phone";
    }
    const r = await request.query(`SELECT TOP 8 c.id, c.full_name, c.phone, c.email FROM dbo.customers c WHERE c.is_active=1 AND ${where} ORDER BY c.full_name`);
    res.json(r.recordset);
  } catch (error) {
    console.error("GET manual customers:", error);
    res.status(500).json({ message: "Không tìm được khách hàng." });
  }
});

router.post("/manual", authenticateToken, requireAdminOrStaff, async (req, res) => {
  try {
    const b = req.body || {};
    const source = ["WALK_IN", "PHONE"].includes(String(b.source).toUpperCase()) ? String(b.source).toUpperCase() : "WALK_IN";
    const pool = await poolPromise;

    let staffId = b.staffId;
    if (req.user.role === "STAFF") {
      staffId = await resolveActorStaffId(pool, req.user); // nhân viên chỉ được tạo lịch cho chính mình
      if (!staffId) return res.status(404).json({ message: "Tài khoản chưa liên kết hồ sơ nhân viên." });
    }

    let customer = null;
    if (req.user.role === "ADMIN" && b.customerId) {
      const r = await pool.request().input("id", sql.Int, Number(b.customerId)).query("SELECT TOP 1 * FROM dbo.customers WHERE id=@id AND is_active=1");
      customer = r.recordset[0] || null;
      if (!customer) return res.status(404).json({ message: "Không tìm thấy khách hàng." });
    } else {
      const phone = normalizeVNPhone(b.phone);
      if (!phone) return res.status(400).json({ message: "Số điện thoại khách không hợp lệ." });
      if (!String(b.fullName || "").trim()) return res.status(400).json({ message: "Vui lòng nhập họ tên khách." });
      if (b.email && !isValidEmail(b.email)) return res.status(400).json({ message: "Email khách không hợp lệ." });
      customer = await findOrCreateWalkInCustomer(pool, { fullName: b.fullName, phone, email: b.email });
    }

    const result = await createAppointmentCore(pool, {
      customerId: customer.id,
      serviceId: b.serviceId,
      staffId,
      date: b.date,
      time: b.time,
      note: b.note,
      paymentMethod: "AT_STORE",
      source,
      actorUserId: req.user.id,
      autoConfirm: true,
      manual: true,
      req,
    });
    return res.status(result.status).json({ ...result.body, customer: { id: customer.id, full_name: customer.full_name, phone: customer.phone } });
  } catch (error) {
    console.error("POST manual appointment:", error);
    res.status(500).json({ message: "Lỗi server khi tạo lịch hộ khách." });
  }
});

export default router;
