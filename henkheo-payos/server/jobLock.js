/*
 * Khóa việc nền ở mức CSDL (sp_getapplock) để khi chạy nhiều instance, mỗi việc chỉ chạy ở MỘT nơi tại một thời điểm.
 * Dùng khóa theo transaction: tự nhả khi commit/rollback, kể cả khi tiến trình chết giữa chừng.
 */
import { poolPromise, sql } from "./db.js";
import { logger } from "./logger.js";

export async function withJobLock(name, fn) {
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const r = await new sql.Request(tx).input("res", sql.NVarChar, `henkheo:${name}`).query(`
      DECLARE @rc INT;
      EXEC @rc = sp_getapplock @Resource=@res, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=0;
      SELECT @rc AS rc;
    `);
    if (r.recordset[0].rc < 0) {
      await tx.rollback();
      return { skipped: true };
    }
    const value = await fn();
    await tx.commit();
    return { skipped: false, value };
  } catch (error) {
    try { await tx.rollback(); } catch { /* đã rollback */ }
    logger.error(`Việc nền "${name}" lỗi`, { err: error });
    return { skipped: false, error };
  }
}
