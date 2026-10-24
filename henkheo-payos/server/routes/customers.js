import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { poolPromise, sql } from "../db.js";
import { authenticateToken, requireAdminOrStaff, requireAdmin, requireCustomer, invalidateUserCache } from "../middleware/authMiddleware.js";
import { writeAudit } from "../utils_audit.js";
import { normalizeVNPhone, isValidEmail } from "../policy.js";

const router = Router();

async function getCustomerByUserId(pool, userId) {
  const result = await pool.request()
    .input("userId", sql.Int, Number(userId))
    .query(`
      SELECT TOP 1
        c.id, c.user_id, c.full_name, c.phone, c.email, c.gender,
        c.date_of_birth, c.address, c.note, c.is_active, c.created_at, c.updated_at
      FROM dbo.customers c
      WHERE c.user_id=@userId
      ORDER BY c.id
    `);
  return result.recordset[0] || null;
}

router.get("/me", authenticateToken, requireCustomer, async (req, res) => {
  try {
    const pool = await poolPromise;
    const customer = await getCustomerByUserId(pool, req.user.id);
    if (!customer || !customer.is_active) return res.status(404).json({ message: "Chưa có hồ sơ khách hàng đang hoạt động." });
    res.json(customer);
  } catch (error) {
    console.error("GET customer me:", error);
    res.status(500).json({ message: "Không tải được hồ sơ khách hàng." });
  }
});

router.patch("/me", authenticateToken, requireCustomer, async (req, res) => {
  try {
    const { fullName, phone, email, gender, dateOfBirth, address, note } = req.body || {};
    const phoneNorm = normalizeVNPhone(phone);
    if (!String(fullName || "").trim() || !phoneNorm) {
      return res.status(400).json({ message: "Họ tên và số điện thoại di động hợp lệ là bắt buộc." });
    }

    const pool = await poolPromise;
    const customer = await getCustomerByUserId(pool, req.user.id);
    if (!customer || !customer.is_active) return res.status(404).json({ message: "Không tìm thấy hồ sơ khách hàng." });

    const userEmail = String(email || "").trim() || null;
    const dob = String(dateOfBirth || "").trim() || null;
    if (userEmail && !isValidEmail(userEmail)) return res.status(400).json({ message: "Email không hợp lệ." });
    const taken = await pool.request().input("phone", sql.VarChar, phoneNorm).input("id", sql.Int, customer.id)
      .query("SELECT TOP 1 id FROM dbo.customers WHERE phone=@phone AND user_id IS NOT NULL AND id<>@id");
    if (taken.recordset.length) return res.status(409).json({ message: "Số điện thoại này đã được dùng cho một tài khoản khác." });

    await pool.request()
      .input("customerId", sql.Int, customer.id)
      .input("userId", sql.Int, req.user.id)
      .input("fullName", sql.NVarChar, String(fullName).trim())
      .input("phone", sql.VarChar, phoneNorm)
      .input("email", sql.VarChar, userEmail)
      .input("gender", sql.VarChar, gender ? String(gender).toUpperCase() : null)
      .input("dateOfBirth", sql.Date, dob)
      .input("address", sql.NVarChar, String(address || "").trim() || null)
      .input("note", sql.NVarChar, String(note || "").trim() || null)
      .query(`
        UPDATE dbo.customers
        SET full_name=@fullName, phone=@phone, email=@email, gender=@gender,
            date_of_birth=@dateOfBirth, address=@address, note=@note, updated_at=SYSDATETIME()
        WHERE id=@customerId AND user_id=@userId AND is_active=1;

        UPDATE dbo.users
        SET full_name=@fullName, phone=@phone, email=@email, updated_at=SYSDATETIME()
        WHERE id=@userId AND is_active=1;
      `);

    await writeAudit(pool, { userId: req.user.id, action: "UPDATE_CUSTOMER_PROFILE", entityType: "CUSTOMER", entityId: customer.id, description: "Khách hàng cập nhật hồ sơ.", req });
    res.json({ message: "Cập nhật hồ sơ thành công." });
  } catch (error) {
    console.error("PATCH customer me:", error);
    if (error?.number === 2601 || error?.number === 2627) return res.status(409).json({ message: "Email đã được sử dụng." });
    res.status(500).json({ message: "Không thể cập nhật hồ sơ khách hàng." });
  }
});

/*
 * Khách tự xóa tài khoản (quyền được xóa dữ liệu cá nhân).
 *  - Xác nhận bằng mật khẩu; chặn khi còn lịch đang chờ/sắp tới hoặc còn khoản tiền chờ hoàn.
 *  - ẨN DANH hóa thay vì xóa cứng: lịch hẹn/thanh toán cũ giữ lại cho đối soát kế toán nhưng không còn gắn với thông tin cá nhân.
 *  - Xóa lịch sử chat, thông báo, token đặt lại mật khẩu; vô hiệu hóa mọi phiên đăng nhập.
 */
router.post("/me/delete-account", authenticateToken, requireCustomer, async (req, res) => {
  try {
    const password = String(req.body?.password || "");
    if (!password) return res.status(400).json({ message: "Vui lòng nhập mật khẩu để xác nhận xóa tài khoản." });

    const pool = await poolPromise;
    const customer = await getCustomerByUserId(pool, req.user.id);
    if (!customer) return res.status(404).json({ message: "Không tìm thấy hồ sơ khách hàng." });

    const userRow = await pool.request().input("id", sql.Int, Number(req.user.id)).query("SELECT password_hash FROM dbo.users WHERE id=@id AND is_active=1");
    const hash = userRow.recordset[0]?.password_hash;
    if (!hash || !(await bcrypt.compare(password, hash))) {
      return res.status(401).json({ message: "Mật khẩu không đúng." });
    }

    const blockers = await pool.request().input("cid", sql.Int, customer.id).query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.appointments WHERE customer_id=@cid AND status IN ('PENDING','CONFIRMED')) AS open_count,
        (SELECT COUNT(*) FROM dbo.payments p INNER JOIN dbo.appointments a ON a.id=p.appointment_id
          WHERE a.customer_id=@cid AND a.status='CANCELLED' AND p.refunded_at IS NULL
            AND (p.payment_status='PAID' OR (p.payment_status='FAILED' AND p.provider_amount>0))) AS refund_count
    `);
    const b = blockers.recordset[0];
    if (b.open_count > 0) return res.status(409).json({ message: `Bạn còn ${b.open_count} lịch hẹn đang chờ/sắp tới. Hãy hủy hoặc hoàn thành các lịch này trước khi xóa tài khoản.` });
    if (b.refund_count > 0) return res.status(409).json({ message: "Bạn còn khoản tiền đang chờ hoàn. Vui lòng đợi cửa hàng hoàn tiền xong rồi xóa tài khoản." });

    const randomHash = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10);
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const r = () => new sql.Request(tx).input("uid", sql.Int, Number(req.user.id)).input("cid", sql.Int, customer.id);
      await r().query(`
        DELETE m FROM dbo.chat_messages m INNER JOIN dbo.chat_conversations c ON c.id=m.conversation_id WHERE c.user_id=@uid;
        DELETE FROM dbo.chat_conversations WHERE user_id=@uid;
        DELETE FROM dbo.notifications WHERE user_id=@uid;
        DELETE FROM dbo.password_reset_tokens WHERE user_id=@uid;
        UPDATE dbo.reviews SET comment=NULL WHERE customer_id=@cid;
      `);
      await r().input("phone", sql.VarChar, `DEL${customer.id}`).query(`
        UPDATE dbo.customers
        SET full_name=N'Khách đã xóa tài khoản', phone=@phone, email=NULL, gender=NULL, date_of_birth=NULL,
            address=NULL, note=NULL, is_active=0, updated_at=SYSDATETIME()
        WHERE id=@cid;
      `);
      await r().input("username", sql.VarChar, `deleted_${req.user.id}`).input("hash", sql.VarChar, randomHash).query(`
        UPDATE dbo.users
        SET username=@username, password_hash=@hash, full_name=N'Khách đã xóa tài khoản', email=NULL, phone=NULL, avatar_url=NULL,
            is_active=0, password_changed_at=SYSUTCDATETIME(), updated_at=SYSDATETIME()
        WHERE id=@uid;
      `);
      await tx.commit();
    } catch (error) {
      try { await tx.rollback(); } catch { /* đã rollback */ }
      throw error;
    }
    invalidateUserCache(req.user.id);
    await writeAudit(pool, { userId: null, action: "DELETE_ACCOUNT", entityType: "CUSTOMER", entityId: customer.id, description: `Khách #${customer.id} tự xóa (ẩn danh hóa) tài khoản.`, req });
    res.json({ message: "Tài khoản đã được xóa. Cảm ơn bạn đã sử dụng Hẹn Khéo." });
  } catch (error) {
    console.error("POST customers/me/delete-account:", error);
    res.status(500).json({ message: "Không thể xóa tài khoản." });
  }
});

router.get("/", authenticateToken, requireAdminOrStaff, async (req, res) => {
  try {
    const pool = await poolPromise;
    const request = pool.request();
    // STAFF chỉ được xem khách đã từng đặt lịch với chính mình (bảo vệ dữ liệu cá nhân của khách khác).
    let staffFilter = "";
    if (req.user.role === "STAFF") {
      const staffRow = await pool.request().input("userId", sql.Int, req.user.id)
        .query("SELECT TOP 1 id FROM dbo.staff WHERE user_id=@userId AND is_active=1");
      if (!staffRow.recordset.length) return res.json([]);
      request.input("staffId", sql.Int, staffRow.recordset[0].id);
      staffFilter = "WHERE EXISTS (SELECT 1 FROM dbo.appointments x WHERE x.customer_id=c.id AND x.staff_id=@staffId)";
    }
    const result = await request.query(`
      SELECT
        c.id, c.user_id, c.full_name, c.phone, c.email, c.gender,
        c.date_of_birth, c.address, c.note, c.is_active,
        COUNT(a.id) AS appointment_count,
        MAX(a.appointment_date) AS last_appointment,
        COALESCE(SUM(CASE WHEN a.status='COMPLETED' THEN a.price_at_booking ELSE 0 END),0) AS total_spent
      FROM dbo.customers c
      LEFT JOIN dbo.appointments a ON a.customer_id=c.id
      ${staffFilter}
      GROUP BY c.id, c.user_id, c.full_name, c.phone, c.email, c.gender,
               c.date_of_birth, c.address, c.note, c.is_active
      ORDER BY c.is_active DESC, appointment_count DESC, c.id;
    `);
    res.json(result.recordset.map((c) => ({
      ...c,
      appointment_count: Number(c.appointment_count || 0),
      total_spent: Number(c.total_spent || 0),
    })));
  } catch (error) {
    console.error("GET customers:", error);
    res.status(500).json({ message: "Không tải được danh sách khách hàng." });
  }
});

router.patch("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "ID khách hàng không hợp lệ." });
    const { fullName, phone, email, address, note, gender, dateOfBirth } = req.body || {};
    if (!String(fullName || "").trim() || !/^0\d{9}$/.test(String(phone || "").trim())) return res.status(400).json({ message: "Họ tên và số điện thoại hợp lệ là bắt buộc." });
    const emailValue = String(email || "").trim();
    if (emailValue && !/^.+@.+\..+$/.test(emailValue)) return res.status(400).json({ message: "Email không hợp lệ." });
    const pool = await poolPromise;
    const result = await pool.request()
      .input("id", sql.Int, id)
      .input("fullName", sql.NVarChar, String(fullName).trim())
      .input("phone", sql.VarChar, String(phone).trim())
      .input("email", sql.VarChar, String(email || "").trim() || null)
      .input("address", sql.NVarChar, String(address || "").trim() || null)
      .input("note", sql.NVarChar, String(note || "").trim() || null)
      .input("gender", sql.VarChar, gender ? String(gender).toUpperCase() : null)
      .input("dateOfBirth", sql.Date, String(dateOfBirth || "").trim() || null)
      .query(`
        UPDATE dbo.customers
        SET full_name=@fullName, phone=@phone, email=@email, address=@address,
            note=@note, gender=@gender, date_of_birth=@dateOfBirth, updated_at=SYSDATETIME()
        WHERE id=@id AND is_active=1;
      `);
    if (!result.rowsAffected[0]) return res.status(404).json({ message: "Không tìm thấy khách hàng đang hoạt động." });
    await writeAudit(pool, { userId: req.user.id, action: "UPDATE_CUSTOMER", entityType: "CUSTOMER", entityId: id, description: "ADMIN cập nhật thông tin khách hàng.", req });
    res.json({ message: "Cập nhật khách hàng thành công." });
  } catch (error) {
    console.error("PATCH customer:", error);
    if (error?.number === 2601 || error?.number === 2627) return res.status(409).json({ message: "Email đã được sử dụng." });
    res.status(500).json({ message: "Không thể cập nhật khách hàng." });
  }
});

/* Khóa khách: vô hiệu hóa hồ sơ VÀ tài khoản đăng nhập (token đang dùng bị từ chối ngay). */
router.delete("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "ID khách hàng không hợp lệ." });
    const pool = await poolPromise;
    const result = await pool.request().input("id", sql.Int, id).query(`
      UPDATE dbo.customers SET is_active=0, updated_at=SYSDATETIME() OUTPUT INSERTED.user_id WHERE id=@id AND is_active=1
    `);
    if (!result.recordset.length) return res.status(404).json({ message: "Không tìm thấy khách hàng đang hoạt động." });
    const userId = result.recordset[0].user_id;
    if (userId) {
      await pool.request().input("userId", sql.Int, userId)
        .query("UPDATE dbo.users SET is_active=0, updated_at=SYSDATETIME() WHERE id=@userId");
      invalidateUserCache(userId);
    }
    await writeAudit(pool, { userId: req.user.id, action: "DISABLE_CUSTOMER", entityType: "CUSTOMER", entityId: id, description: "ADMIN vô hiệu hóa khách hàng và tài khoản đăng nhập.", req });
    res.json({ message: "Đã khóa khách hàng và tài khoản đăng nhập." });
  } catch (error) {
    console.error("DELETE customer:", error);
    res.status(500).json({ message: "Không thể vô hiệu hóa khách hàng." });
  }
});

router.patch("/:id/restore", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "ID khách hàng không hợp lệ." });
    const pool = await poolPromise;
    const result = await pool.request().input("id", sql.Int, id).query(`
      UPDATE dbo.customers SET is_active=1, updated_at=SYSDATETIME() OUTPUT INSERTED.user_id WHERE id=@id AND is_active=0
    `);
    if (!result.recordset.length) return res.status(404).json({ message: "Không tìm thấy khách hàng đang bị khóa." });
    const userId = result.recordset[0].user_id;
    if (userId) {
      await pool.request().input("userId", sql.Int, userId)
        .query("UPDATE dbo.users SET is_active=1, updated_at=SYSDATETIME() WHERE id=@userId");
      invalidateUserCache(userId);
    }
    await writeAudit(pool, { userId: req.user.id, action: "RESTORE_CUSTOMER", entityType: "CUSTOMER", entityId: id, description: "ADMIN kích hoạt lại khách hàng.", req });
    res.json({ message: "Đã kích hoạt lại khách hàng." });
  } catch (error) {
    console.error("PATCH restore customer:", error);
    res.status(500).json({ message: "Không thể kích hoạt lại khách hàng." });
  }
});

export default router;
