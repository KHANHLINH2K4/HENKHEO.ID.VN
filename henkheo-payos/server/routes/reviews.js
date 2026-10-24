import { Router } from "express";
import { poolPromise, sql } from "../db.js";
import { authenticateToken, requireAdmin, requireCustomer } from "../middleware/authMiddleware.js";
import { writeAudit } from "../utils_audit.js";

const router = Router();

async function getCustomer(pool, userId) {
  const r = await pool
    .request()
    .input("userId", sql.Int, userId)
    .query("SELECT TOP 1 id,full_name FROM dbo.customers WHERE user_id=@userId AND is_active=1 ORDER BY id");
  return r.recordset[0] || null;
}

router.get("/my", authenticateToken, requireCustomer, async (req, res) => {
  try {
    const pool = await poolPromise;
    const customer = await getCustomer(pool, req.user.id);
    if (!customer) return res.status(404).json({ message: "Chưa có hồ sơ khách hàng." });
    const r = await pool.request().input("customerId", sql.Int, customer.id).query(`
      SELECT r.id,r.appointment_id,r.rating,r.comment,r.is_visible,r.created_at,s.name AS service_name,st.full_name AS staff_name
      FROM dbo.reviews r JOIN dbo.appointments a ON a.id=r.appointment_id JOIN dbo.services s ON s.id=a.service_id LEFT JOIN dbo.staff st ON st.id=a.staff_id
      WHERE r.customer_id=@customerId ORDER BY r.created_at DESC
    `);
    res.json(r.recordset);
  } catch (error) {
    console.error("GET reviews/my:", error);
    res.status(500).json({ message: "Không tải được đánh giá." });
  }
});

router.post("/", authenticateToken, requireCustomer, async (req, res) => {
  try {
    const appointmentId = Number(req.body?.appointmentId);
    const rating = Number(req.body?.rating);
    const comment = String(req.body?.comment || "").trim() || null;
    if (!Number.isInteger(appointmentId) || appointmentId <= 0)
      return res.status(400).json({ message: "Lịch hẹn không hợp lệ." });
    if (!Number.isInteger(rating) || rating < 1 || rating > 5)
      return res.status(400).json({ message: "Điểm đánh giá phải từ 1 đến 5." });
    const pool = await poolPromise;
    const customer = await getCustomer(pool, req.user.id);
    if (!customer) return res.status(404).json({ message: "Chưa có hồ sơ khách hàng." });
    const appointment = await pool
      .request()
      .input("appointmentId", sql.Int, appointmentId)
      .input("customerId", sql.Int, customer.id)
      .query(`SELECT TOP 1 id,status FROM dbo.appointments WHERE id=@appointmentId AND customer_id=@customerId`);
    if (!appointment.recordset.length) return res.status(404).json({ message: "Không tìm thấy lịch hẹn của bạn." });
    if (String(appointment.recordset[0].status).toUpperCase() !== "COMPLETED")
      return res.status(400).json({ message: "Chỉ được đánh giá sau khi lịch hẹn hoàn thành." });
    const exists = await pool
      .request()
      .input("appointmentId", sql.Int, appointmentId)
      .query("SELECT TOP 1 id FROM dbo.reviews WHERE appointment_id=@appointmentId");
    if (exists.recordset.length) return res.status(409).json({ message: "Lịch hẹn này đã được đánh giá." });
    const inserted = await pool
      .request()
      .input("appointmentId", sql.Int, appointmentId)
      .input("customerId", sql.Int, customer.id)
      .input("rating", sql.TinyInt, rating)
      .input("comment", sql.NVarChar, comment)
      .query(
        `INSERT INTO dbo.reviews(appointment_id,customer_id,rating,comment,is_visible) OUTPUT INSERTED.id VALUES(@appointmentId,@customerId,@rating,@comment,1)`,
      );
    await writeAudit(pool, {
      userId: req.user.id,
      action: "CREATE_REVIEW",
      entityType: "REVIEW",
      entityId: inserted.recordset[0].id,
      description: `Đánh giá ${rating}/5 cho lịch ${appointmentId}.`,
      req,
    });
    res.status(201).json({ message: "Gửi đánh giá thành công.", id: inserted.recordset[0].id });
  } catch (error) {
    console.error("POST review:", error);
    res.status(500).json({ message: "Không thể gửi đánh giá." });
  }
});

/* "Nguyễn Văn An" -> "Nguyễn A." : không công khai họ tên đầy đủ của khách. */
function maskName(full) {
  const parts = String(full || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "Khách hàng";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

router.get("/public", async (req, res) => {
  try {
    const pool = await poolPromise;
    const r = await pool.request().query(`
      SELECT TOP 50 r.id,r.rating,r.comment,r.created_at,c.full_name AS customer_name,s.name AS service_name,st.full_name AS staff_name
      FROM dbo.reviews r JOIN dbo.customers c ON c.id=r.customer_id JOIN dbo.appointments a ON a.id=r.appointment_id JOIN dbo.services s ON s.id=a.service_id LEFT JOIN dbo.staff st ON st.id=a.staff_id
      WHERE r.is_visible=1 ORDER BY r.created_at DESC
    `);
    res.json(r.recordset.map((x) => ({ ...x, customer_name: maskName(x.customer_name) })));
  } catch (error) {
    console.error("GET public reviews:", error);
    res.status(500).json({ message: "Không tải được đánh giá công khai." });
  }
});

router.get("/admin", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pool = await poolPromise;
    const r = await pool
      .request()
      .query(
        `SELECT TOP 200 r.id,r.rating,r.comment,r.is_visible,r.created_at,c.full_name AS customer_name,s.name AS service_name,st.full_name AS staff_name FROM dbo.reviews r JOIN dbo.customers c ON c.id=r.customer_id JOIN dbo.appointments a ON a.id=r.appointment_id JOIN dbo.services s ON s.id=a.service_id LEFT JOIN dbo.staff st ON st.id=a.staff_id ORDER BY r.created_at DESC`,
      );
    res.json(r.recordset);
  } catch (error) {
    console.error("GET admin reviews:", error);
    res.status(500).json({ message: "Không tải được đánh giá." });
  }
});

router.patch("/:id/visibility", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const visible = req.body?.isVisible === true;
    const pool = await poolPromise;
    const r = await pool
      .request()
      .input("id", sql.Int, id)
      .input("visible", sql.Bit, visible)
      .query("UPDATE dbo.reviews SET is_visible=@visible WHERE id=@id");
    if (!r.rowsAffected[0]) return res.status(404).json({ message: "Không tìm thấy đánh giá." });
    await writeAudit(pool, {
      userId: req.user.id,
      action: "UPDATE_REVIEW_VISIBILITY",
      entityType: "REVIEW",
      entityId: id,
      description: `Hiển thị=${visible}`,
      req,
    });
    res.json({ message: "Đã cập nhật hiển thị đánh giá." });
  } catch (error) {
    console.error("PATCH review:", error);
    res.status(500).json({ message: "Không thể cập nhật đánh giá." });
  }
});

export default router;
