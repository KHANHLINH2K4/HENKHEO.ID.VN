import { Router } from "express";
import { poolPromise, sql } from "../db.js";
import { authenticateToken, requireAdmin } from "../middleware/authMiddleware.js";

const router = Router();

function localTodayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

router.get("/sales", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const requestedDate = String(req.query.date || "").trim();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
      ? requestedDate
      : localTodayISO();

    const pool = await poolPromise;

    const summaryResult = await pool.request()
      .input("reportDate", sql.Date, date)
      .query(`
        DECLARE @reportStart DATETIME2 = CAST(@reportDate AS DATETIME2);
        DECLARE @nextDay DATETIME2 = DATEADD(DAY, 1, @reportStart);
        DECLARE @monthStart DATETIME2 = DATEFROMPARTS(YEAR(@reportStart), MONTH(@reportStart), 1);
        DECLARE @nextMonthStart DATETIME2 = DATEADD(MONTH, 1, @monthStart);
        DECLARE @yearStart DATETIME2 = DATEFROMPARTS(YEAR(@reportStart), 1, 1);
        DECLARE @nextYearStart DATETIME2 = DATEADD(YEAR, 1, @yearStart);

        SELECT
          COALESCE(SUM(CASE WHEN a.completed_at >= @reportStart AND a.completed_at < @nextDay AND a.status='COMPLETED' THEN a.price_at_booking ELSE 0 END), 0) AS daily_revenue,
          COALESCE(SUM(CASE WHEN a.completed_at >= @monthStart AND a.completed_at < @nextMonthStart AND a.status='COMPLETED' THEN a.price_at_booking ELSE 0 END), 0) AS monthly_revenue,
          COALESCE(SUM(CASE WHEN a.completed_at >= @yearStart AND a.completed_at < @nextYearStart AND a.status='COMPLETED' THEN a.price_at_booking ELSE 0 END), 0) AS yearly_revenue,
          COALESCE(SUM(CASE WHEN a.completed_at >= @reportStart AND a.completed_at < @nextDay AND a.status='COMPLETED' THEN 1 ELSE 0 END), 0) AS daily_completed,
          COALESCE(SUM(CASE WHEN p.payment_status='PAID' AND p.paid_at >= @reportStart AND p.paid_at < @nextDay THEN p.amount ELSE 0 END), 0) AS daily_collected,
          COALESCE(SUM(CASE WHEN a.completed_at >= @monthStart AND a.completed_at < @nextMonthStart AND a.status='COMPLETED' THEN 1 ELSE 0 END), 0) AS monthly_completed,
          COALESCE(SUM(CASE WHEN a.completed_at >= @yearStart AND a.completed_at < @nextYearStart AND a.status='COMPLETED' THEN 1 ELSE 0 END), 0) AS yearly_completed,
          COALESCE(SUM(CASE WHEN p.payment_status='PAID' AND p.paid_at >= @monthStart AND p.paid_at < @nextMonthStart THEN p.amount ELSE 0 END), 0) AS monthly_collected,
          COALESCE(SUM(CASE WHEN p.payment_status='PAID' AND p.paid_at >= @yearStart AND p.paid_at < @nextYearStart THEN p.amount ELSE 0 END), 0) AS yearly_collected,
          COALESCE(SUM(CASE WHEN a.cancelled_at >= @reportStart AND a.cancelled_at < @nextDay AND a.status='CANCELLED' THEN 1 ELSE 0 END), 0) AS daily_cancelled,
          COALESCE(SUM(CASE WHEN a.cancelled_at >= @monthStart AND a.cancelled_at < @nextMonthStart AND a.status='CANCELLED' THEN 1 ELSE 0 END), 0) AS monthly_cancelled
        FROM dbo.appointments a
        LEFT JOIN dbo.payments p ON p.appointment_id=a.id;
      `);

    const staffResult = await pool.request()
      .input("reportDate", sql.Date, date)
      .query(`
        DECLARE @reportStart DATETIME2 = CAST(@reportDate AS DATETIME2);
        DECLARE @nextDay DATETIME2 = DATEADD(DAY, 1, @reportStart);
        DECLARE @monthStart DATETIME2 = DATEFROMPARTS(YEAR(@reportStart), MONTH(@reportStart), 1);
        DECLARE @nextMonthStart DATETIME2 = DATEADD(MONTH, 1, @monthStart);
        DECLARE @yearStart DATETIME2 = DATEFROMPARTS(YEAR(@reportStart), 1, 1);
        DECLARE @nextYearStart DATETIME2 = DATEADD(YEAR, 1, @yearStart);

        SELECT
          st.id AS staff_id,
          st.employee_code,
          st.full_name,
          COALESCE(SUM(CASE WHEN a.completed_at >= @reportStart AND a.completed_at < @nextDay AND a.status='COMPLETED' THEN a.price_at_booking ELSE 0 END), 0) AS daily_revenue,
          COALESCE(SUM(CASE WHEN a.completed_at >= @monthStart AND a.completed_at < @nextMonthStart AND a.status='COMPLETED' THEN a.price_at_booking ELSE 0 END), 0) AS monthly_revenue,
          COALESCE(SUM(CASE WHEN a.completed_at >= @yearStart AND a.completed_at < @nextYearStart AND a.status='COMPLETED' THEN a.price_at_booking ELSE 0 END), 0) AS yearly_revenue,
          COALESCE(SUM(CASE WHEN a.completed_at >= @reportStart AND a.completed_at < @nextDay AND a.status='COMPLETED' THEN 1 ELSE 0 END), 0) AS daily_completed,
          COALESCE(SUM(CASE WHEN p.payment_status='PAID' AND p.paid_at >= @reportStart AND p.paid_at < @nextDay THEN p.amount ELSE 0 END), 0) AS daily_collected,
          COALESCE(SUM(CASE WHEN a.completed_at >= @monthStart AND a.completed_at < @nextMonthStart AND a.status='COMPLETED' THEN 1 ELSE 0 END), 0) AS monthly_completed,
          COALESCE(SUM(CASE WHEN a.completed_at >= @yearStart AND a.completed_at < @nextYearStart AND a.status='COMPLETED' THEN 1 ELSE 0 END), 0) AS yearly_completed,
          COALESCE(SUM(CASE WHEN p.payment_status='PAID' AND p.paid_at >= @monthStart AND p.paid_at < @nextMonthStart THEN p.amount ELSE 0 END), 0) AS monthly_collected,
          COALESCE(SUM(CASE WHEN p.payment_status='PAID' AND p.paid_at >= @yearStart AND p.paid_at < @nextYearStart THEN p.amount ELSE 0 END), 0) AS yearly_collected
        FROM dbo.staff st
        LEFT JOIN dbo.appointments a ON a.staff_id = st.id
        LEFT JOIN dbo.payments p ON p.appointment_id=a.id
        WHERE st.is_active = 1
           OR EXISTS (SELECT 1 FROM dbo.appointments ax WHERE ax.staff_id = st.id AND ax.status = 'COMPLETED')
        GROUP BY st.id, st.employee_code, st.full_name
        ORDER BY yearly_revenue DESC, st.full_name;
      `);

    const serviceResult = await pool.request()
      .input("reportDate", sql.Date, date)
      .query(`
        DECLARE @yearStart DATETIME2 = DATEFROMPARTS(YEAR(CAST(@reportDate AS DATETIME2)), 1, 1);
        DECLARE @nextYearStart DATETIME2 = DATEADD(YEAR, 1, @yearStart);

        SELECT
          s.id AS service_id,
          s.name AS service_name,
          COUNT(CASE WHEN a.status='COMPLETED' AND a.completed_at >= @yearStart AND a.completed_at < @nextYearStart THEN 1 END) AS completed_count_year,
          COALESCE(SUM(CASE WHEN a.status='COMPLETED' AND a.completed_at >= @yearStart AND a.completed_at < @nextYearStart THEN a.price_at_booking ELSE 0 END), 0) AS yearly_revenue
        FROM dbo.services s
        LEFT JOIN dbo.appointments a ON a.service_id = s.id
        GROUP BY s.id, s.name
        ORDER BY yearly_revenue DESC, s.name;
      `);

    const customerMetricsResult = await pool.request()
      .input("reportDate", sql.Date, date)
      .query(`
        DECLARE @reportStart DATETIME2 = CAST(@reportDate AS DATETIME2);
        DECLARE @nextDay DATETIME2 = DATEADD(DAY, 1, @reportStart);
        DECLARE @thirtyDaysAgo DATETIME2 = DATEADD(DAY, -29, @nextDay);
        DECLARE @sixtyDaysAgo DATETIME2 = DATEADD(DAY, -59, @thirtyDaysAgo);

        SELECT
          (SELECT COUNT(*) FROM dbo.customers WHERE is_active = 1) AS active_customers,
          (SELECT COUNT(*) FROM dbo.customers WHERE created_at >= @thirtyDaysAgo AND created_at < @nextDay) AS new_customers_30_days,
          (SELECT COUNT(*) FROM dbo.customers c WHERE EXISTS (
              SELECT 1 FROM dbo.appointments a
              WHERE a.customer_id = c.id AND a.status='COMPLETED' AND a.completed_at >= @thirtyDaysAgo AND a.completed_at < @nextDay
          ) AND EXISTS (
              SELECT 1 FROM dbo.appointments a2
              WHERE a2.customer_id = c.id AND a2.status='COMPLETED' AND a2.completed_at < @thirtyDaysAgo
          )) AS returning_customers_30_days,
          (SELECT COUNT(*) FROM dbo.appointments WHERE status='COMPLETED' AND completed_at >= @reportStart AND completed_at < @nextDay) AS completed_appointments_day;
      `);

    const recentResult = await pool.request()
      .input("reportDate", sql.Date, date)
      .query(`
        SELECT
          CONVERT(varchar(10), CONVERT(date, d.report_date), 23) AS report_date,
          COALESCE(SUM(CASE WHEN a.status = 'COMPLETED' THEN a.price_at_booking ELSE 0 END), 0) AS revenue,
          COALESCE(SUM(CASE WHEN a.status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completed
        FROM (
          SELECT DATEADD(DAY, -v.n, CAST(@reportDate AS datetime2)) AS report_date
          FROM (VALUES (0),(1),(2),(3),(4),(5),(6)) v(n)
        ) d
        LEFT JOIN dbo.appointments a
          ON a.completed_at >= CAST(d.report_date AS datetime2)
         AND a.completed_at < DATEADD(DAY, 1, CAST(d.report_date AS datetime2))
        GROUP BY CONVERT(date, d.report_date)
        ORDER BY CONVERT(date, d.report_date);
      `);

    const summary = summaryResult.recordset[0] || {};
    const customerMetrics = customerMetricsResult.recordset[0] || {};

    res.json({
      report_date: date,
      definition: "Doanh số được ghi nhận theo thời điểm hoàn thành lịch hẹn, sử dụng giá đã chốt tại thời điểm khách đặt lịch.",
      summary: {
        daily_revenue: Number(summary.daily_revenue || 0),
        monthly_revenue: Number(summary.monthly_revenue || 0),
        yearly_revenue: Number(summary.yearly_revenue || 0),
        daily_completed: Number(summary.daily_completed || 0),
        daily_collected: Number(summary.daily_collected || 0),
        monthly_completed: Number(summary.monthly_completed || 0),
        yearly_completed: Number(summary.yearly_completed || 0),
        monthly_collected: Number(summary.monthly_collected || 0),
        yearly_collected: Number(summary.yearly_collected || 0),
        daily_cancelled: Number(summary.daily_cancelled || 0),
        monthly_cancelled: Number(summary.monthly_cancelled || 0),
      },
      staff: staffResult.recordset.map((row) => ({
        staff_id: row.staff_id,
        employee_code: row.employee_code,
        full_name: row.full_name,
        daily_revenue: Number(row.daily_revenue || 0),
        monthly_revenue: Number(row.monthly_revenue || 0),
        yearly_revenue: Number(row.yearly_revenue || 0),
        daily_completed: Number(row.daily_completed || 0),
        daily_collected: Number(row.daily_collected || 0),
        monthly_completed: Number(row.monthly_completed || 0),
        yearly_completed: Number(row.yearly_completed || 0),
        monthly_collected: Number(row.monthly_collected || 0),
        yearly_collected: Number(row.yearly_collected || 0),
      })),
      services: serviceResult.recordset.map((row) => ({
        service_id: row.service_id,
        service_name: row.service_name,
        completed_count_year: Number(row.completed_count_year || 0),
        yearly_revenue: Number(row.yearly_revenue || 0),
      })),
      customers: {
        active_customers: Number(customerMetrics.active_customers || 0),
        new_customers_30_days: Number(customerMetrics.new_customers_30_days || 0),
        returning_customers_30_days: Number(customerMetrics.returning_customers_30_days || 0),
        completed_appointments_day: Number(customerMetrics.completed_appointments_day || 0),
      },
      last_7_days: recentResult.recordset.map((row) => ({
        date: row.report_date,
        revenue: Number(row.revenue || 0),
        completed: Number(row.completed || 0),
      })),
    });
  } catch (error) {
    console.error("GET sales stats:", error);
    res.status(500).json({ message: "Không tải được thống kê doanh số." });
  }
});

export default router;
