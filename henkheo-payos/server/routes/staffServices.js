import { Router } from "express";
import { poolPromise, sql } from "../db.js";
import { authenticateToken, requireAdmin } from "../middleware/authMiddleware.js";
import { writeAudit } from "../utils_audit.js";

const router = Router();

router.get("/", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT
        ss.id,
        ss.service_id,
        s.name AS service_name,
        ss.staff_id,
        st.full_name AS staff_name,
        st.position,
        ss.is_active
      FROM dbo.staff_services ss
      INNER JOIN dbo.services s ON s.id=ss.service_id
      INNER JOIN dbo.staff st ON st.id=ss.staff_id
      WHERE ss.is_active=1
        AND s.is_active=1
        AND st.is_active=1
      ORDER BY s.name, st.full_name
    `);
    res.json(result.recordset);
  } catch (error) {
    console.error("GET staff-services:", error);
    res.status(500).json({ message: "Không tải được phân công nhân viên - dịch vụ." });
  }
});

router.get("/service/:serviceId", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input("serviceId", sql.Int, Number(req.params.serviceId))
      .query(`
        SELECT staff_id
        FROM dbo.staff_services
        WHERE service_id=@serviceId AND is_active=1
        ORDER BY staff_id
      `);
    res.json(result.recordset.map((x) => x.staff_id));
  } catch (error) {
    console.error("GET service staff:", error);
    res.status(500).json({ message: "Không tải được nhân viên của dịch vụ." });
  }
});

router.put("/service/:serviceId", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const serviceId = Number(req.params.serviceId);
    const staffIds = Array.isArray(req.body?.staffIds)
      ? [...new Set(req.body.staffIds.map(Number).filter(Number.isInteger))]
      : [];

    if (!serviceId) {
      return res.status(400).json({ message: "Dịch vụ không hợp lệ." });
    }

    const pool = await poolPromise;

    const serviceCheck = await pool.request()
      .input("serviceId", sql.Int, serviceId)
      .query("SELECT TOP 1 id FROM dbo.services WHERE id=@serviceId AND is_active=1");
    if (!serviceCheck.recordset.length) {
      return res.status(404).json({ message: "Không tìm thấy dịch vụ." });
    }

    if (staffIds.length) {
      const validStaffResult = await pool.request().query("SELECT id FROM dbo.staff WHERE is_active=1");
      const validStaffIds = new Set(validStaffResult.recordset.map((x) => Number(x.id)));
      for (const id of staffIds) {
        if (!validStaffIds.has(id)) {
          return res.status(400).json({ message: `Nhân viên ID ${id} không hợp lệ.` });
        }
      }
    }

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx)
        .input("serviceId", sql.Int, serviceId)
        .query("UPDATE dbo.staff_services SET is_active=0, updated_at=SYSDATETIME() WHERE service_id=@serviceId");

      for (const staffId of staffIds) {
        await new sql.Request(tx)
          .input("serviceId", sql.Int, serviceId)
          .input("staffId", sql.Int, staffId)
          .query(`
            IF EXISTS (SELECT 1 FROM dbo.staff_services WHERE service_id=@serviceId AND staff_id=@staffId)
              UPDATE dbo.staff_services SET is_active=1, updated_at=SYSDATETIME() WHERE service_id=@serviceId AND staff_id=@staffId;
            ELSE
              INSERT INTO dbo.staff_services(service_id, staff_id, is_active) VALUES(@serviceId, @staffId, 1);
          `);
      }

      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }

    await writeAudit(pool, { userId: req.user.id, action: "UPDATE_STAFF_SERVICES", entityType: "SERVICE", entityId: serviceId, description: `Phân công ${staffIds.length} nhân viên cho dịch vụ ${serviceId}.`, req });
    res.json({ message: "Đã cập nhật phân công nhân viên cho dịch vụ.", staffIds });
  } catch (error) {
    console.error("PUT service staff:", error);
    res.status(500).json({ message: "Không thể cập nhật phân công nhân viên." });
  }
});

export default router;
