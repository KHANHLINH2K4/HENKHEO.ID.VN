import { Router } from "express";
import { poolPromise, sql } from "../db.js";
import { authenticateToken, requireStaff } from "../middleware/authMiddleware.js";
import { getEffectiveScheduleRange, isValidISODate, addDaysISO } from "../scheduleResolver.js";

const router = Router();

async function getStaffByUserId(pool, userId) {
  const result = await pool.request()
    .input("userId", sql.Int, Number(userId))
    .query(`
      SELECT TOP 1
        st.id,
        st.employee_code,
        st.full_name,
        st.phone,
        st.email,
        st.position,
        st.specialties,
        st.avatar_url,
        st.hire_date,
        st.is_active,
        u.username,
        u.full_name AS account_full_name
      FROM dbo.staff st
      INNER JOIN dbo.users u ON u.id=st.user_id
      WHERE st.user_id=@userId AND st.is_active=1 AND u.is_active=1
    `);
  return result.recordset[0] || null;
}

router.get("/me", authenticateToken, requireStaff, async (req, res) => {
  try {
    const pool = await poolPromise;
    const staff = await getStaffByUserId(pool, req.user.id);
    if (!staff) return res.status(404).json({ message: "Tài khoản STAFF chưa được liên kết với hồ sơ nhân viên." });
    res.json({
      ...staff,
      specialties: staff.specialties
        ? String(staff.specialties).split(/[,;|]/).map((x) => x.trim()).filter(Boolean)
        : [],
    });
  } catch (error) {
    console.error("GET staff portal me:", error);
    res.status(500).json({ message: "Không tải được hồ sơ nhân viên." });
  }
});

router.get("/services", authenticateToken, requireStaff, async (req, res) => {
  try {
    const pool = await poolPromise;
    const staff = await getStaffByUserId(pool, req.user.id);
    if (!staff) return res.status(404).json({ message: "Tài khoản STAFF chưa được liên kết với hồ sơ nhân viên." });

    const result = await pool.request()
      .input("staffId", sql.Int, staff.id)
      .query(`
        SELECT
          s.id,
          s.name,
          s.duration_minutes,
          s.price,
          s.description,
          s.popular,
          c.name AS category_name
        FROM dbo.staff_services ss
        INNER JOIN dbo.services s ON s.id=ss.service_id
        INNER JOIN dbo.categories c ON c.id=s.category_id
        WHERE ss.staff_id=@staffId
          AND ss.is_active=1
          AND s.is_active=1
          AND c.is_active=1
        ORDER BY c.name, s.name
      `);

    res.json(result.recordset.map((s) => ({
      ...s,
      duration: Number(s.duration_minutes),
      price: Number(s.price),
    })));
  } catch (error) {
    console.error("GET staff portal services:", error);
    res.status(500).json({ message: "Không tải được danh sách dịch vụ được phân công." });
  }
});

/*
 * Lịch làm việc của nhân viên đăng nhập: trả về TỪNG NGÀY trong khoảng [from, to]
 * theo đúng quy tắc ưu tiên của hệ thống đặt lịch (ngoại lệ > lịch tuần > lịch cũ),
 * kèm số lịch hẹn của ngày đó. Tối đa 62 ngày mỗi lần gọi.
 */
router.get("/schedule", authenticateToken, requireStaff, async (req, res) => {
  try {
    const pool = await poolPromise;
    const staff = await getStaffByUserId(pool, req.user.id);
    if (!staff) return res.status(404).json({ message: "Tài khoản STAFF chưa được liên kết với hồ sơ nhân viên." });

    const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD theo múi giờ server (TZ)
    const from = isValidISODate(req.query.from) ? String(req.query.from) : today;
    let to = isValidISODate(req.query.to) ? String(req.query.to) : addDaysISO(from, 13);
    if (to < from) to = from;
    if (to > addDaysISO(from, 61)) to = addDaysISO(from, 61);

    const days = await getEffectiveScheduleRange(pool, staff.id, from, to);

    const appts = await pool.request()
      .input("staffId", sql.Int, staff.id)
      .input("fromDate", sql.Date, from)
      .input("toDate", sql.Date, to)
      .query(`
        SELECT appointment_date, COUNT(*) AS total
        FROM dbo.appointments
        WHERE staff_id=@staffId
          AND appointment_date BETWEEN @fromDate AND @toDate
          AND status IN ('PENDING','CONFIRMED')
        GROUP BY appointment_date
      `);
    const countByDate = new Map(appts.recordset.map((r) => [new Date(r.appointment_date).toISOString().slice(0, 10), Number(r.total)]));

    res.json(days.map((d) => ({
      id: d.date,
      work_date: d.date,
      weekday: d.weekday,
      is_available: d.is_working,
      is_working: d.is_working,
      // Giữ start_time/end_time để giao diện cũ vẫn hiển thị được ca đầu tiên.
      start_time: d.shifts[0]?.start_time || "",
      end_time: d.shifts[d.shifts.length - 1]?.end_time || "",
      shifts: d.shifts,
      source: d.source,
      note: d.note || "",
      appointment_count: countByDate.get(d.date) || 0,
    })));
  } catch (error) {
    console.error("GET staff portal schedule:", error);
    res.status(500).json({ message: "Không tải được lịch làm việc." });
  }
});

router.get("/stats", authenticateToken, requireStaff, async (req, res) => {
  try {
    const requestedDate = String(req.query.date || "").trim();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
      ? requestedDate
      : new Date().toLocaleDateString("en-CA");

    const pool = await poolPromise;
    const staff = await getStaffByUserId(pool, req.user.id);
    if (!staff) return res.status(404).json({ message: "Tài khoản STAFF chưa được liên kết với hồ sơ nhân viên." });

    const result = await pool.request()
      .input("staffId", sql.Int, staff.id)
      .input("reportDate", sql.Date, date)
      .query(`
        DECLARE @monthStart DATE = DATEFROMPARTS(YEAR(@reportDate), MONTH(@reportDate), 1);
        DECLARE @nextMonthStart DATE = DATEADD(MONTH, 1, @monthStart);
        DECLARE @yearStart DATE = DATEFROMPARTS(YEAR(@reportDate), 1, 1);
        DECLARE @nextYearStart DATE = DATEADD(YEAR, 1, @yearStart);

        SELECT
          COALESCE(SUM(CASE WHEN a.completed_at >= @reportDate
                              AND a.completed_at < DATEADD(DAY, 1, @reportDate)
                              AND a.status='COMPLETED' THEN a.price_at_booking ELSE 0 END), 0) AS daily_revenue,
          COALESCE(SUM(CASE WHEN a.completed_at >= @monthStart
                              AND a.completed_at < @nextMonthStart
                              AND a.status='COMPLETED' THEN a.price_at_booking ELSE 0 END), 0) AS monthly_revenue,
          COALESCE(SUM(CASE WHEN a.completed_at >= @yearStart
                              AND a.completed_at < @nextYearStart
                              AND a.status='COMPLETED' THEN a.price_at_booking ELSE 0 END), 0) AS yearly_revenue,
          COALESCE(SUM(CASE WHEN a.completed_at >= @reportDate
                              AND a.completed_at < DATEADD(DAY, 1, @reportDate)
                              AND a.status='COMPLETED' THEN 1 ELSE 0 END), 0) AS daily_completed,
          COALESCE(SUM(CASE WHEN p.payment_status='PAID' AND p.paid_at >= @reportDate AND p.paid_at < DATEADD(DAY, 1, @reportDate) THEN p.amount ELSE 0 END), 0) AS daily_collected,
          COALESCE(SUM(CASE WHEN a.completed_at >= @monthStart
                              AND a.completed_at < @nextMonthStart
                              AND a.status='COMPLETED' THEN 1 ELSE 0 END), 0) AS monthly_completed,
          COALESCE(SUM(CASE WHEN a.completed_at >= @yearStart
                              AND a.completed_at < @nextYearStart
                              AND a.status='COMPLETED' THEN 1 ELSE 0 END), 0) AS yearly_completed,
          COALESCE(SUM(CASE WHEN p.payment_status='PAID' AND p.paid_at >= @monthStart AND p.paid_at < @nextMonthStart THEN p.amount ELSE 0 END), 0) AS monthly_collected,
          COALESCE(SUM(CASE WHEN p.payment_status='PAID' AND p.paid_at >= @yearStart AND p.paid_at < @nextYearStart THEN p.amount ELSE 0 END), 0) AS yearly_collected
        FROM dbo.appointments a
        LEFT JOIN dbo.payments p ON p.appointment_id=a.id
        WHERE a.staff_id=@staffId;
      `);

    const row = result.recordset[0] || {};
    res.json({
      report_date: date,
      daily_revenue: Number(row.daily_revenue || 0),
      monthly_revenue: Number(row.monthly_revenue || 0),
      yearly_revenue: Number(row.yearly_revenue || 0),
      daily_completed: Number(row.daily_completed || 0),
      daily_collected: Number(row.daily_collected || 0),
      monthly_completed: Number(row.monthly_completed || 0),
      yearly_completed: Number(row.yearly_completed || 0),
      monthly_collected: Number(row.monthly_collected || 0),
      yearly_collected: Number(row.yearly_collected || 0),
    });
  } catch (error) {
    console.error("GET staff portal stats:", error);
    res.status(500).json({ message: "Không tải được thống kê cá nhân." });
  }
});

router.patch("/profile", authenticateToken, requireStaff, async (req, res) => {
  try {
    const { phone, email, avatarUrl } = req.body || {};
    const pool = await poolPromise;
    const staff = await getStaffByUserId(pool, req.user.id);
    if (!staff) return res.status(404).json({ message: "Tài khoản STAFF chưa được liên kết với hồ sơ nhân viên." });

    await pool.request()
      .input("staffId", sql.Int, staff.id)
      .input("phone", sql.VarChar, String(phone || "").trim() || null)
      .input("email", sql.VarChar, String(email || "").trim() || null)
      .input("avatarUrl", sql.VarChar, String(avatarUrl || "").trim() || null)
      .query(`
        UPDATE dbo.staff
        SET phone=@phone,
            email=@email,
            avatar_url=@avatarUrl,
            updated_at=SYSDATETIME()
        WHERE id=@staffId AND is_active=1
      `);

    res.json({ message: "Cập nhật hồ sơ thành công." });
  } catch (error) {
    console.error("PATCH staff portal profile:", error);
    res.status(500).json({ message: "Không thể cập nhật hồ sơ nhân viên." });
  }
});

export default router;
