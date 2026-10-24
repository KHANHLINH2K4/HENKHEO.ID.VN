import { Router } from "express";
import { poolPromise, sql } from "../db.js";
import { authenticateToken } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/", authenticateToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().input("userId", sql.Int, req.user.id).query(`
      SELECT TOP 50 id,title,message,type,is_read,created_at
      FROM dbo.notifications WHERE user_id=@userId ORDER BY created_at DESC,id DESC
    `);
    res.json(result.recordset);
  } catch (error) {
    console.error("GET notifications:", error);
    res.status(500).json({ message: "Không tải được thông báo." });
  }
});

router.patch("/read-all", authenticateToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    await pool
      .request()
      .input("userId", sql.Int, req.user.id)
      .query("UPDATE dbo.notifications SET is_read=1 WHERE user_id=@userId AND is_read=0");
    res.json({ message: "Đã đánh dấu tất cả thông báo đã đọc." });
  } catch (error) {
    console.error("PATCH notifications read-all:", error);
    res.status(500).json({ message: "Không thể cập nhật thông báo." });
  }
});

router.patch("/:id/read", authenticateToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "ID thông báo không hợp lệ." });
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("userId", sql.Int, req.user.id)
      .query("UPDATE dbo.notifications SET is_read=1 WHERE id=@id AND user_id=@userId");
    if (!result.rowsAffected[0]) return res.status(404).json({ message: "Không tìm thấy thông báo." });
    res.json({ message: "Đã đánh dấu đã đọc." });
  } catch (error) {
    console.error("PATCH notification:", error);
    res.status(500).json({ message: "Không thể cập nhật thông báo." });
  }
});

export default router;
