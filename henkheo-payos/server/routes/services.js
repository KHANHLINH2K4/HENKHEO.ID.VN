import { Router } from "express";
import { poolPromise, sql } from "../db.js";
import { authenticateToken, requireAdmin } from "../middleware/authMiddleware.js";
import { writeAudit } from "../utils_audit.js";

const router = Router();

const categoryToKey = (name = "") => {
  const n = name.toLowerCase();
  if (n.includes("tóc") || n.includes("toc")) return "toc";
  if (n.includes("da")) return "damat";
  if (n.includes("móng") || n.includes("mong")) return "mong";
  if (n.includes("massage")) return "massage";
  if (n.includes("spa")) return "spa";
  return n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_");
};

router.get("/", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT s.id, s.category_id, c.name AS category_name, s.name,
             s.duration_minutes, s.price, s.description, s.image_url, s.popular, s.is_active
      FROM dbo.services s
      INNER JOIN dbo.categories c ON c.id = s.category_id
      WHERE s.is_active = 1 AND c.is_active = 1
      ORDER BY s.popular DESC, s.id
    `);
    res.json(result.recordset.map((s) => ({
      ...s,
      category: categoryToKey(s.category_name),
      duration: Number(s.duration_minutes),
      price: Number(s.price),
    })));
  } catch (error) {
    console.error("GET services:", error);
    res.status(500).json({ message: "Không tải được danh sách dịch vụ." });
  }
});

router.get("/categories/list", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query("SELECT id, name, description FROM dbo.categories WHERE is_active=1 ORDER BY id");
    res.json(result.recordset.map((c) => ({ ...c, key: categoryToKey(c.name) })));
  } catch (error) {
    console.error("GET categories:", error);
    res.status(500).json({ message: "Không tải được danh mục." });
  }
});

router.post("/", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, category, duration, price, description } = req.body || {};
    if (!name?.trim() || !category || !duration || price === undefined || price === null) {
      return res.status(400).json({ message: "Thiếu thông tin dịch vụ." });
    }

    const pool = await poolPromise;
    const categoryResult = await pool.request()
      .input("key", sql.VarChar, category)
      .query(`
        SELECT TOP 1 id
        FROM dbo.categories
        WHERE is_active=1 AND (
          LOWER(name) LIKE CASE
            WHEN @key='toc' THEN N'%tóc%'
            WHEN @key='damat' THEN N'%da%'
            WHEN @key='mong' THEN N'%móng%'
            WHEN @key='massage' THEN N'%massage%'
            WHEN @key='spa' THEN N'%spa%'
            ELSE N'%' + @key + N'%'
          END
        )
      `);

    if (!categoryResult.recordset.length) return res.status(400).json({ message: "Danh mục dịch vụ không tồn tại." });

    const result = await pool.request()
      .input("categoryId", sql.Int, categoryResult.recordset[0].id)
      .input("name", sql.NVarChar, name.trim())
      .input("duration", sql.Int, Number(duration))
      .input("price", sql.Decimal(12, 2), Number(price))
      .input("description", sql.NVarChar, description?.trim() || null)
      .query(`
        INSERT INTO dbo.services (category_id, name, duration_minutes, price, description, popular, is_active)
        OUTPUT INSERTED.id
        VALUES (@categoryId, @name, @duration, @price, @description, 0, 1)
      `);

    const id = result.recordset[0].id;
    await writeAudit(pool, { userId: req.user.id, action: "CREATE_SERVICE", entityType: "SERVICE", entityId: id, description: `Tạo dịch vụ: ${name.trim()} - ${Number(price)}đ - ${Number(duration)} phút.`, req });
    res.status(201).json({ message: "Thêm dịch vụ thành công.", id });
  } catch (error) {
    console.error("POST services:", error);
    res.status(500).json({ message: "Không thể thêm dịch vụ." });
  }
});


router.patch("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID dịch vụ không hợp lệ." });
    }

    const { name, category, duration, price, description } = req.body || {};
    const durationNumber = Number(duration);
    const priceNumber = Number(price);

    if (!name?.trim() || !category) {
      return res.status(400).json({ message: "Thiếu tên hoặc danh mục dịch vụ." });
    }
    if (!Number.isInteger(durationNumber) || durationNumber <= 0) {
      return res.status(400).json({ message: "Thời lượng phải là số nguyên lớn hơn 0 phút." });
    }
    if (!Number.isFinite(priceNumber) || priceNumber < 0) {
      return res.status(400).json({ message: "Giá dịch vụ không được âm." });
    }

    const pool = await poolPromise;

    const existing = await pool.request()
      .input("id", sql.Int, id)
      .query(`SELECT id FROM dbo.services WHERE id=@id AND is_active=1`);

    if (!existing.recordset.length) {
      return res.status(404).json({ message: "Không tìm thấy dịch vụ đang hoạt động." });
    }

    const categoryResult = await pool.request()
      .input("key", sql.VarChar, category)
      .query(`
        SELECT TOP 1 id
        FROM dbo.categories
        WHERE is_active=1 AND (
          LOWER(name) LIKE CASE
            WHEN @key='toc' THEN N'%tóc%'
            WHEN @key='damat' THEN N'%da%'
            WHEN @key='mong' THEN N'%móng%'
            WHEN @key='massage' THEN N'%massage%'
            WHEN @key='spa' THEN N'%spa%'
            ELSE N'%' + @key + N'%'
          END
        )
      `);

    if (!categoryResult.recordset.length) {
      return res.status(400).json({ message: "Danh mục dịch vụ không tồn tại." });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("categoryId", sql.Int, categoryResult.recordset[0].id)
      .input("name", sql.NVarChar, name.trim())
      .input("duration", sql.Int, durationNumber)
      .input("price", sql.Decimal(12, 2), priceNumber)
      .input("description", sql.NVarChar, description?.trim() || null)
      .query(`
        UPDATE dbo.services
        SET category_id=@categoryId,
            name=@name,
            duration_minutes=@duration,
            price=@price,
            description=@description,
            updated_at=SYSDATETIME()
        WHERE id=@id
      `);

    await writeAudit(pool, { userId: req.user.id, action: "UPDATE_SERVICE", entityType: "SERVICE", entityId: id, description: `Cập nhật dịch vụ: ${name.trim()} - ${priceNumber}đ - ${durationNumber} phút.`, req });
    return res.json({ message: "Cập nhật dịch vụ thành công." });
  } catch (error) {
    console.error("PATCH services:", error);
    return res.status(500).json({ message: "Không thể cập nhật dịch vụ." });
  }
});

router.delete("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pool = await poolPromise;
    await pool.request()
      .input("id", sql.Int, Number(req.params.id))
      .query("UPDATE dbo.services SET is_active=0, updated_at=SYSDATETIME() WHERE id=@id");
    await writeAudit(pool, { userId: req.user.id, action: "DISABLE_SERVICE", entityType: "SERVICE", entityId: Number(req.params.id), description: "ADMIN ẩn dịch vụ.", req });
    res.json({ ok: true });
  } catch (error) {
    console.error("DELETE services:", error);
    res.status(500).json({ message: "Không thể xoá dịch vụ." });
  }
});

export default router;
