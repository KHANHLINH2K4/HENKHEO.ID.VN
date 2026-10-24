import { Router } from "express";
import { poolPromise, sql } from "../db.js";
import { authenticateToken, requireAdmin } from "../middleware/authMiddleware.js";
const router = Router();
router.get("/", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const pool = await poolPromise;
    const r = await pool
      .request()
      .input("limit", sql.Int, limit)
      .query(
        `SELECT TOP (@limit) l.id,l.action,l.entity_type,l.entity_id,l.description,l.ip_address,l.created_at,u.username,u.full_name FROM dbo.activity_logs l LEFT JOIN dbo.users u ON u.id=l.user_id ORDER BY l.created_at DESC,l.id DESC`,
      );
    res.json(r.recordset);
  } catch (error) {
    console.error("GET activity logs:", error);
    res.status(500).json({ message: "Không tải được nhật ký hoạt động." });
  }
});
export default router;
