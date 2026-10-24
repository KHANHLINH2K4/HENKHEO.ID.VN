import { sql } from "./db.js";

export async function writeAudit(pool, { userId = null, action, entityType = null, entityId = null, description = null, req = null }) {
  try {
    await pool.request()
      .input("userId", sql.Int, userId == null ? null : Number(userId))
      .input("action", sql.VarChar, String(action || "UNKNOWN").slice(0, 50))
      .input("entityType", sql.VarChar, entityType ? String(entityType).slice(0, 50) : null)
      .input("entityId", sql.Int, entityId == null ? null : Number(entityId))
      .input("description", sql.NVarChar, description ? String(description).slice(0, 1000) : null)
      .input("ipAddress", sql.VarChar, req?.ip ? String(req.ip).slice(0, 45) : null)
      .input("userAgent", sql.NVarChar, req?.get?.("user-agent") ? String(req.get("user-agent")).slice(0, 500) : null)
      .query(`
        INSERT INTO dbo.activity_logs
          (user_id, action, entity_type, entity_id, description, ip_address, user_agent)
        VALUES
          (@userId, @action, @entityType, @entityId, @description, @ipAddress, @userAgent)
      `);
  } catch (error) {
    console.error("Audit log error:", error);
  }
}
