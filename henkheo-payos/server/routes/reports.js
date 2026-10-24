/*
 * Báo cáo theo khoảng ngày tùy chọn (ADMIN):
 *   GET /api/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD   -> tổng quan, theo ngày, theo dịch vụ, theo nhân viên
 *   GET /api/reports/export.csv?from=...&to=...              -> danh sách lịch hẹn (mở được bằng Excel, UTF-8 BOM)
 * Quy ước doanh thu giống trang tổng quan: tính theo lịch COMPLETED (giá chốt lúc đặt) theo ngày hoàn thành;
 * "đã thu" tính theo khoản thanh toán PAID theo ngày thu tiền.
 */
import { Router } from "express";
import { poolPromise, sql } from "../db.js";
import { authenticateToken, requireAdmin } from "../middleware/authMiddleware.js";
import { isValidISODate, addDaysISO } from "../scheduleResolver.js";
import { logger } from "../logger.js";

const router = Router();
const MAX_DAYS = 366;
const today = () => new Date().toLocaleDateString("en-CA");

export function parseRange(query) {
  const to = query.to ? String(query.to) : today();
  const from = query.from ? String(query.from) : addDaysISO(to, -29);
  if (!isValidISODate(from) || !isValidISODate(to)) return { error: "Khoảng ngày không hợp lệ (định dạng YYYY-MM-DD)." };
  if (from > to) return { error: "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc." };
  let n = 0;
  for (let d = from; d <= to && n <= MAX_DAYS + 1; d = addDaysISO(d, 1)) n += 1;
  if (n > MAX_DAYS) return { error: `Chỉ xem tối đa ${MAX_DAYS} ngày mỗi lần.` };
  return { from, to, days: n };
}

/** Chuẩn hóa một ô CSV: bọc nháy kép, chống "CSV injection" (ô bắt đầu bằng = + - @ bị Excel hiểu là công thức). */
export function csvCell(value) {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

export function toCsv(rows, columns) {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(","));
  return `\uFEFF${[head, ...body].join("\r\n")}\r\n`;
}

router.get("/summary", authenticateToken, requireAdmin, async (req, res) => {
  const range = parseRange(req.query);
  if (range.error) return res.status(400).json({ message: range.error });
  try {
    const pool = await poolPromise;
    const rq = () => pool.request().input("from", sql.Date, range.from).input("to", sql.Date, range.to);
    // Mốc thời gian dạng [from, to+1) để dùng được chỉ mục
    const winSql = (col) => `${col} >= @from AND ${col} < DATEADD(DAY,1,@to)`;
    const [totals, daily, byService, byStaff] = await Promise.all([
      rq().query(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
               SUM(CASE WHEN status='CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
               SUM(CASE WHEN status='NO_SHOW' THEN 1 ELSE 0 END) AS no_show,
               SUM(CASE WHEN status IN ('PENDING','CONFIRMED') THEN 1 ELSE 0 END) AS open_count,
               COUNT(DISTINCT customer_id) AS customers
        FROM dbo.appointments WHERE appointment_date BETWEEN @from AND @to`),
      rq().query(`
        SELECT d.day,
               COALESCE(c.completed,0) AS completed, COALESCE(c.revenue,0) AS revenue, COALESCE(p.collected,0) AS collected
        FROM (SELECT CAST(DATEADD(DAY, n.n, @from) AS DATE) AS day
              FROM (SELECT TOP (DATEDIFF(DAY,@from,@to)+1) ROW_NUMBER() OVER (ORDER BY (SELECT NULL))-1 AS n FROM sys.all_objects) n) d
        LEFT JOIN (SELECT CAST(completed_at AS DATE) AS day, COUNT(*) AS completed, SUM(price_at_booking) AS revenue
                   FROM dbo.appointments WHERE status='COMPLETED' AND ${winSql("completed_at")} GROUP BY CAST(completed_at AS DATE)) c ON c.day=d.day
        LEFT JOIN (SELECT CAST(paid_at AS DATE) AS day, SUM(amount) AS collected
                   FROM dbo.payments WHERE payment_status='PAID' AND ${winSql("paid_at")} GROUP BY CAST(paid_at AS DATE)) p ON p.day=d.day
        ORDER BY d.day`),
      rq().query(`
        SELECT s.id, s.name, COUNT(*) AS bookings,
               SUM(CASE WHEN a.status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
               SUM(CASE WHEN a.status='COMPLETED' THEN a.price_at_booking ELSE 0 END) AS revenue
        FROM dbo.appointments a INNER JOIN dbo.services s ON s.id=a.service_id
        WHERE a.appointment_date BETWEEN @from AND @to
        GROUP BY s.id, s.name ORDER BY revenue DESC, bookings DESC`),
      rq().query(`
        SELECT st.id, st.full_name AS name, COUNT(*) AS bookings,
               SUM(CASE WHEN a.status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
               SUM(CASE WHEN a.status='NO_SHOW' THEN 1 ELSE 0 END) AS no_show,
               SUM(CASE WHEN a.status='COMPLETED' THEN a.price_at_booking ELSE 0 END) AS revenue
        FROM dbo.appointments a INNER JOIN dbo.staff st ON st.id=a.staff_id
        WHERE a.appointment_date BETWEEN @from AND @to
        GROUP BY st.id, st.full_name ORDER BY revenue DESC, bookings DESC`),
    ]);
    const t = totals.recordset[0] || {};
    const total = Number(t.total || 0);
    const pct = (n) => (total ? Math.round((Number(n || 0) / total) * 1000) / 10 : 0);
    const num = (r) => ({ ...r, bookings: Number(r.bookings || 0), completed: Number(r.completed || 0), no_show: Number(r.no_show || 0), revenue: Number(r.revenue || 0) });
    res.json({
      from: range.from, to: range.to, days: range.days,
      totals: {
        total, completed: Number(t.completed || 0), cancelled: Number(t.cancelled || 0), no_show: Number(t.no_show || 0),
        open: Number(t.open_count || 0), customers: Number(t.customers || 0),
        cancel_rate: pct(t.cancelled), no_show_rate: pct(t.no_show), completion_rate: pct(t.completed),
        revenue: daily.recordset.reduce((s, r) => s + Number(r.revenue), 0),
        collected: daily.recordset.reduce((s, r) => s + Number(r.collected), 0),
      },
      daily: daily.recordset.map((r) => ({ date: new Date(r.day).toISOString().slice(0, 10), completed: Number(r.completed), revenue: Number(r.revenue), collected: Number(r.collected) })),
      by_service: byService.recordset.map(num),
      by_staff: byStaff.recordset.map(num),
    });
  } catch (error) {
    logger.error("GET reports/summary", { err: error });
    res.status(500).json({ message: "Không thể tạo báo cáo." });
  }
});

router.get("/export.csv", authenticateToken, requireAdmin, async (req, res) => {
  const range = parseRange(req.query);
  if (range.error) return res.status(400).json({ message: range.error });
  try {
    const pool = await poolPromise;
    const r = await pool.request().input("from", sql.Date, range.from).input("to", sql.Date, range.to).query(`
      SELECT TOP 50000 a.appointment_code, CONVERT(VARCHAR(10),a.appointment_date,23) AS d, CONVERT(VARCHAR(5),a.start_time,108) AS t,
             c.full_name AS customer, c.phone, s.name AS service, st.full_name AS staff, a.status, a.price_at_booking,
             p.payment_method, p.payment_status, CONVERT(VARCHAR(19),p.paid_at,120) AS paid_at
      FROM dbo.appointments a
      INNER JOIN dbo.customers c ON c.id=a.customer_id
      INNER JOIN dbo.services s ON s.id=a.service_id
      LEFT JOIN dbo.staff st ON st.id=a.staff_id
      LEFT JOIN dbo.payments p ON p.appointment_id=a.id
      WHERE a.appointment_date BETWEEN @from AND @to
      ORDER BY a.appointment_date, a.start_time`);
    const csv = toCsv(r.recordset, [
      { header: "Mã lịch", value: (x) => x.appointment_code }, { header: "Ngày", value: (x) => x.d }, { header: "Giờ", value: (x) => x.t },
      { header: "Khách hàng", value: (x) => x.customer }, { header: "SĐT", value: (x) => x.phone }, { header: "Dịch vụ", value: (x) => x.service },
      { header: "Nhân viên", value: (x) => x.staff }, { header: "Trạng thái", value: (x) => x.status }, { header: "Giá chốt", value: (x) => x.price_at_booking },
      { header: "Hình thức thanh toán", value: (x) => x.payment_method }, { header: "Trạng thái thanh toán", value: (x) => x.payment_status }, { header: "Thời điểm thu", value: (x) => x.paid_at },
    ]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="lich-hen_${range.from}_${range.to}.csv"`);
    res.send(csv);
  } catch (error) {
    logger.error("GET reports/export.csv", { err: error });
    res.status(500).json({ message: "Không thể xuất báo cáo." });
  }
});

export default router;
