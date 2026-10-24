import { Router } from "express";
import bcrypt from "bcryptjs";
import { poolPromise, sql } from "../db.js";
import { authenticateToken, requireAdmin, verifyAccessToken, invalidateUserCache } from "../middleware/authMiddleware.js";
import { writeAudit } from "../utils_audit.js";

const router = Router();

function normalizeSpecialties(value) {
  return String(value || "")
    .split(/[,;|]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .join(", ");
}

/* Xem người gọi có phải ADMIN không (không bắt buộc đăng nhập) để quyết định trả thông tin liên hệ. */
async function isAdminRequest(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return false;
  try { return (await verifyAccessToken(header.slice(7))).role === "ADMIN"; } catch { return false; }
}

router.get("/", async (req, res) => {
  try {
    const admin = await isAdminRequest(req);
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT id, user_id, employee_code, full_name, phone, email, position, specialties, avatar_url, hire_date, is_active
      FROM dbo.staff
      WHERE is_active=1
      ORDER BY id
    `);
    res.json(result.recordset.map((row) => {
      // Khách/ẩn danh chỉ thấy thông tin giới thiệu; số điện thoại, email, mã tài khoản chỉ dành cho ADMIN.
      const { phone, email, user_id, hire_date, ...publicFields } = row;
      const base = admin ? row : publicFields;
      return {
        ...base,
        name: row.full_name,
        specialties: row.specialties ? row.specialties.split(/[,;|]/).map((x) => x.trim()).filter(Boolean) : [],
      };
    }));
  } catch (error) {
    console.error("GET staff:", error);
    res.status(500).json({ message: "Không tải được danh sách nhân viên." });
  }
});

router.post("/", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      employeeCode,
      fullName,
      phone,
      email,
      position,
      specialties,
      hireDate,
    } = req.body || {};

    if (!String(employeeCode || "").trim() || !String(fullName || "").trim()) {
      return res.status(400).json({ message: "Mã nhân viên và họ tên là bắt buộc." });
    }

    const pool = await poolPromise;
    const duplicate = await pool.request()
      .input("employeeCode", sql.VarChar, String(employeeCode).trim())
      .query("SELECT TOP 1 id FROM dbo.staff WHERE employee_code=@employeeCode");

    if (duplicate.recordset.length) {
      return res.status(409).json({ message: "Mã nhân viên đã tồn tại." });
    }

    const result = await pool.request()
      .input("employeeCode", sql.VarChar, String(employeeCode).trim())
      .input("fullName", sql.NVarChar, String(fullName).trim())
      .input("phone", sql.VarChar, String(phone || "").trim() || null)
      .input("email", sql.VarChar, String(email || "").trim() || null)
      .input("position", sql.NVarChar, String(position || "").trim() || null)
      .input("specialties", sql.NVarChar, normalizeSpecialties(specialties) || null)
      .input("hireDate", sql.Date, hireDate || null)
      .query(`
        INSERT INTO dbo.staff
          (employee_code, full_name, phone, email, position, specialties, hire_date, is_active)
        OUTPUT INSERTED.id
        VALUES
          (@employeeCode, @fullName, @phone, @email, @position, @specialties, @hireDate, 1)
      `);

    const staffId = result.recordset[0].id;

    // Nhân viên mới nhận lịch TUẦN mặc định (T2–T7: 08:00–18:00, Chủ nhật nghỉ).
    // Lịch tuần lặp vô hạn nên nhân viên luôn đặt được lịch; Admin chỉnh sau ở tab "Lịch làm việc".
    await pool.request()
      .input("staffId", sql.Int, staffId)
      .query(`
        INSERT INTO dbo.staff_schedule_templates(staff_id, day_of_week, start_time, end_time, is_working, note)
        SELECT @staffId, d.day_of_week, '08:00', '18:00',
               CASE WHEN d.day_of_week = 7 THEN 0 ELSE 1 END,
               CASE WHEN d.day_of_week = 7 THEN N'Nghỉ Chủ nhật' ELSE N'Lịch mặc định 08:00-18:00' END
        FROM (VALUES (1),(2),(3),(4),(5),(6),(7)) AS d(day_of_week)
        WHERE NOT EXISTS (
          SELECT 1 FROM dbo.staff_schedule_templates t
          WHERE t.staff_id=@staffId AND t.day_of_week=d.day_of_week
        );
      `);

    await writeAudit(pool, { userId: req.user.id, action: "CREATE_STAFF", entityType: "STAFF", entityId: staffId, description: `Tạo nhân viên ${fullName.trim()} (${employeeCode.trim()}).`, req });
    res.status(201).json({ message: "Thêm nhân viên thành công.", id: staffId });
  } catch (error) {
    console.error("POST staff:", error);
    res.status(500).json({ message: "Không thể thêm nhân viên." });
  }
});

router.patch("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID nhân viên không hợp lệ." });
    }

    const {
      employeeCode,
      fullName,
      phone,
      email,
      position,
      specialties,
      hireDate,
    } = req.body || {};

    if (!String(employeeCode || "").trim() || !String(fullName || "").trim()) {
      return res.status(400).json({ message: "Mã nhân viên và họ tên là bắt buộc." });
    }

    const pool = await poolPromise;
    const exists = await pool.request()
      .input("id", sql.Int, id)
      .query("SELECT TOP 1 id FROM dbo.staff WHERE id=@id AND is_active=1");

    if (!exists.recordset.length) {
      return res.status(404).json({ message: "Không tìm thấy nhân viên." });
    }

    const duplicate = await pool.request()
      .input("employeeCode", sql.VarChar, String(employeeCode).trim())
      .input("id", sql.Int, id)
      .query("SELECT TOP 1 id FROM dbo.staff WHERE employee_code=@employeeCode AND id<>@id");

    if (duplicate.recordset.length) {
      return res.status(409).json({ message: "Mã nhân viên đã tồn tại ở nhân viên khác." });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("employeeCode", sql.VarChar, String(employeeCode).trim())
      .input("fullName", sql.NVarChar, String(fullName).trim())
      .input("phone", sql.VarChar, String(phone || "").trim() || null)
      .input("email", sql.VarChar, String(email || "").trim() || null)
      .input("position", sql.NVarChar, String(position || "").trim() || null)
      .input("specialties", sql.NVarChar, normalizeSpecialties(specialties) || null)
      .input("hireDate", sql.Date, hireDate || null)
      .query(`
        UPDATE dbo.staff
        SET employee_code=@employeeCode,
            full_name=@fullName,
            phone=@phone,
            email=@email,
            position=@position,
            specialties=@specialties,
            hire_date=@hireDate,
            updated_at=SYSDATETIME()
        WHERE id=@id
      `);

    await writeAudit(pool, { userId: req.user.id, action: "UPDATE_STAFF", entityType: "STAFF", entityId: id, description: `Cập nhật nhân viên ${fullName.trim()}.`, req });
    res.json({ message: "Cập nhật nhân viên thành công." });
  } catch (error) {
    console.error("PATCH staff:", error);
    res.status(500).json({ message: "Không thể cập nhật nhân viên." });
  }
});

router.post("/:id/account", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const staffId = Number(req.params.id);
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (!Number.isInteger(staffId) || staffId <= 0) {
      return res.status(400).json({ message: "ID nhân viên không hợp lệ." });
    }
    if (!/^[A-Za-z0-9._-]{4,50}$/.test(username)) {
      return res.status(400).json({ message: "Username phải dài 4-50 ký tự và chỉ gồm chữ, số, dấu chấm, gạch dưới hoặc gạch ngang." });
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({ message: "Mật khẩu phải có ít nhất 8 ký tự, gồm cả chữ và số." });
    }

    const pool = await poolPromise;
    const staffResult = await pool.request()
      .input("staffId", sql.Int, staffId)
      .query(`SELECT TOP 1 id, user_id, full_name, phone, email, is_active FROM dbo.staff WHERE id=@staffId`);
    const staff = staffResult.recordset[0];

    if (!staff || !staff.is_active) {
      return res.status(404).json({ message: "Không tìm thấy nhân viên đang hoạt động." });
    }
    if (staff.user_id) {
      return res.status(409).json({ message: "Nhân viên này đã có tài khoản STAFF." });
    }

    const usernameExists = await pool.request()
      .input("username", sql.VarChar, username)
      .query("SELECT TOP 1 id FROM dbo.users WHERE username=@username");
    if (usernameExists.recordset.length) {
      return res.status(409).json({ message: "Username đã tồn tại." });
    }

    const roleResult = await pool.request()
      .input("roleName", sql.VarChar, "STAFF")
      .query("SELECT TOP 1 id FROM dbo.roles WHERE name=@roleName");
    if (!roleResult.recordset.length) {
      return res.status(500).json({ message: "Không tìm thấy role STAFF." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const request = new sql.Request(tx);
      const userResult = await request
        .input("roleId", sql.Int, roleResult.recordset[0].id)
        .input("username", sql.VarChar, username)
        .input("passwordHash", sql.VarChar, passwordHash)
        .input("fullName", sql.NVarChar, staff.full_name)
        .input("email", sql.VarChar, staff.email || null)
        .input("phone", sql.VarChar, staff.phone || null)
        .query(`
          INSERT INTO dbo.users (role_id, username, password_hash, full_name, email, phone, is_active)
          OUTPUT INSERTED.id
          VALUES (@roleId, @username, @passwordHash, @fullName, @email, @phone, 1)
        `);
      const userId = userResult.recordset[0].id;

      await new sql.Request(tx)
        .input("staffId", sql.Int, staffId)
        .input("userId", sql.Int, userId)
        .query("UPDATE dbo.staff SET user_id=@userId, updated_at=SYSDATETIME() WHERE id=@staffId");

      await tx.commit();
      await writeAudit(pool, { userId: req.user.id, action: "CREATE_STAFF_ACCOUNT", entityType: "STAFF", entityId: staffId, description: `Tạo tài khoản STAFF: ${username}.`, req });
      res.status(201).json({ message: "Tạo tài khoản STAFF thành công.", username });
    } catch (transactionError) {
      try { await tx.rollback(); } catch {}
      throw transactionError;
    }
  } catch (error) {
    console.error("POST staff account:", error);
    res.status(500).json({ message: "Không thể tạo tài khoản STAFF." });
  }
});

/*
 * Ngừng làm việc của nhân viên:
 *  - Chặn khi còn lịch PENDING/CONFIRMED từ hôm nay trở đi (Admin phải chuyển lịch sang nhân viên khác hoặc hủy trước),
 *    trừ khi gửi ?force=1 (các lịch đó KHÔNG bị hủy tự động; chỉ dùng khi chắc chắn sẽ xử lý riêng).
 *  - Khóa luôn tài khoản đăng nhập của nhân viên (có hiệu lực ngay) và ngừng phân công dịch vụ.
 */
router.delete("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID nhân viên không hợp lệ." });
    }

    const pool = await poolPromise;
    const today = new Date().toLocaleDateString("en-CA");
    const force = String(req.query.force || "") === "1";

    const open = await pool.request()
      .input("id", sql.Int, id)
      .input("today", sql.Date, today)
      .query(`SELECT COUNT(*) AS n FROM dbo.appointments
              WHERE staff_id=@id AND status IN ('PENDING','CONFIRMED') AND appointment_date >= @today`);
    const openCount = Number(open.recordset[0]?.n || 0);
    if (openCount > 0 && !force) {
      return res.status(409).json({
        message: `Nhân viên còn ${openCount} lịch chờ/sắp tới. Hãy chuyển các lịch này sang nhân viên khác (hoặc hủy) trước khi ngừng làm việc.`,
        code: "STAFF_HAS_OPEN_APPOINTMENTS",
        open_appointments: openCount,
      });
    }

    const result = await pool.request()
      .input("id", sql.Int, id)
      .query(`
        UPDATE dbo.staff
        SET is_active=0,
            updated_at=SYSDATETIME()
        OUTPUT INSERTED.user_id
        WHERE id=@id AND is_active=1
      `);

    if (!result.recordset.length) {
      return res.status(404).json({ message: "Không tìm thấy nhân viên hoặc nhân viên đã bị xoá." });
    }

    // Ngừng phân công nhân viên đã xoá khỏi các dịch vụ.
    await pool.request()
      .input("staffId", sql.Int, id)
      .query(`
        UPDATE dbo.staff_services
        SET is_active=0,
            updated_at=SYSDATETIME()
        WHERE staff_id=@staffId
      `);

    // Khóa tài khoản đăng nhập: nhân viên nghỉ việc không thể tiếp tục vào hệ thống.
    const userId = result.recordset[0].user_id;
    if (userId) {
      await pool.request().input("userId", sql.Int, userId)
        .query("UPDATE dbo.users SET is_active=0, updated_at=SYSDATETIME() WHERE id=@userId");
      invalidateUserCache(userId);
    }

    await writeAudit(pool, { userId: req.user.id, action: "DISABLE_STAFF", entityType: "STAFF", entityId: id, description: `Ngừng làm việc của nhân viên #${id}${openCount ? ` (còn ${openCount} lịch mở, force)` : ""}.`, req });
    res.json({ message: "Đã xoá nhân viên khỏi hệ thống và khóa tài khoản đăng nhập.", open_appointments: openCount });
  } catch (error) {
    console.error("DELETE staff:", error);
    res.status(500).json({ message: "Không thể xoá nhân viên." });
  }
});

export default router;
