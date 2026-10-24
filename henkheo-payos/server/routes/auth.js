import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { poolPromise, sql } from "../db.js";
import { writeAudit } from "../utils_audit.js";
import crypto from "node:crypto";
import { authenticateToken, requireAdmin, invalidateUserCache } from "../middleware/authMiddleware.js";
import { normalizeVNPhone, isValidEmail } from "../policy.js";
import { sendMail, mailTemplates } from "../mailer.js";
import { loginGuard } from "../loginGuard.js";

const RESET_TOKEN_MINUTES = 30;
const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

const MIN_PASSWORD = 8;
const passwordProblem = (pw) => {
  const v = String(pw || "");
  if (v.length < MIN_PASSWORD) return `Mật khẩu phải có ít nhất ${MIN_PASSWORD} ký tự.`;
  if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return "Mật khẩu phải gồm cả chữ và số.";
  return null;
};

const router = express.Router();

function createToken(user) {
  if (!process.env.JWT_SECRET) throw new Error("Thiếu JWT_SECRET trong .env");
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role_name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "1d" }
  );
}

router.post("/register", async (req, res) => {
  const { username, password, fullName, email, phone } = req.body || {};

  if (!username?.trim() || !password || !fullName?.trim() || !phone?.trim()) {
    return res.status(400).json({ message: "Vui lòng nhập đầy đủ username, password, họ tên và số điện thoại." });
  }
  const pwProblem = passwordProblem(password);
  if (pwProblem) return res.status(400).json({ message: pwProblem });
  const phoneNorm = normalizeVNPhone(phone);
  if (!phoneNorm) {
    return res.status(400).json({ message: "Số điện thoại không hợp lệ (cần số di động Việt Nam, ví dụ 0912345678)." });
  }
  if (email?.trim() && !isValidEmail(email)) {
    return res.status(400).json({ message: "Email không hợp lệ." });
  }

  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);

  try {
    const exists = await pool.request()
      .input("username", sql.VarChar, username.trim())
      .query("SELECT id FROM dbo.users WHERE username = @username");

    if (exists.recordset.length) {
      return res.status(409).json({ message: "Tên đăng nhập đã tồn tại." });
    }

    // Mỗi số điện thoại chỉ một tài khoản: chặn tạo nhiều tài khoản để né giới hạn đặt lịch / lịch sử "không đến".
    const phoneTaken = await pool.request()
      .input("phone", sql.VarChar, phoneNorm)
      .query("SELECT TOP 1 id FROM dbo.customers WHERE phone=@phone AND user_id IS NOT NULL");
    if (phoneTaken.recordset.length) {
      return res.status(409).json({ message: "Số điện thoại này đã được dùng cho một tài khoản khác." });
    }

    if (email?.trim()) {
      const emailExists = await pool.request()
        .input("email", sql.VarChar, email.trim())
        .query("SELECT id FROM dbo.users WHERE email = @email");
      if (emailExists.recordset.length) {
        return res.status(409).json({ message: "Email đã được sử dụng." });
      }
    }

    const roleResult = await pool.request()
      .input("roleName", sql.VarChar, "CUSTOMER")
      .query("SELECT id FROM dbo.roles WHERE name = @roleName");

    if (!roleResult.recordset.length) {
      return res.status(500).json({ message: "Không tìm thấy role CUSTOMER." });
    }

    const roleId = roleResult.recordset[0].id;
    const passwordHash = await bcrypt.hash(password, 12);

    await transaction.begin();
    const request = new sql.Request(transaction);
    const userResult = await request
      .input("roleId", sql.Int, roleId)
      .input("username", sql.VarChar, username.trim())
      .input("passwordHash", sql.VarChar, passwordHash)
      .input("fullName", sql.NVarChar, fullName.trim())
      .input("email", sql.VarChar, email?.trim() || null)
      .input("phone", sql.VarChar, phoneNorm)
      .query(`
        INSERT INTO dbo.users (role_id, username, password_hash, full_name, email, phone, is_active)
        OUTPUT INSERTED.id, INSERTED.username, INSERTED.full_name, INSERTED.email, INSERTED.phone, INSERTED.is_active
        VALUES (@roleId, @username, @passwordHash, @fullName, @email, @phone, 1)
      `);

    const user = userResult.recordset[0];

    // Nếu cửa hàng đã từng tạo hồ sơ khách vãng lai theo số này -> gắn tài khoản vào hồ sơ đó để giữ lịch sử.
    const walkIn = await new sql.Request(transaction)
      .input("phone", sql.VarChar, phoneNorm)
      .query("SELECT TOP 1 id FROM dbo.customers WITH (UPDLOCK) WHERE phone=@phone AND user_id IS NULL AND is_active=1 ORDER BY id");
    if (walkIn.recordset[0]) {
      await new sql.Request(transaction)
        .input("id", sql.Int, walkIn.recordset[0].id)
        .input("userId", sql.Int, user.id)
        .input("fullName", sql.NVarChar, fullName.trim())
        .input("email", sql.VarChar, email?.trim() || null)
        .query("UPDATE dbo.customers SET user_id=@userId, full_name=@fullName, email=COALESCE(@email,email), updated_at=SYSDATETIME() WHERE id=@id");
    } else {
      await new sql.Request(transaction)
        .input("userId", sql.Int, user.id)
        .input("fullName", sql.NVarChar, fullName.trim())
        .input("phone", sql.VarChar, phoneNorm)
        .input("email", sql.VarChar, email?.trim() || null)
        .query(`
          INSERT INTO dbo.customers (user_id, full_name, phone, email, is_active)
          VALUES (@userId, @fullName, @phone, @email, 1)
        `);
    }

    await transaction.commit();

    const loginUser = { ...user, role_name: "CUSTOMER" };
    await writeAudit(pool, { userId: user.id, action: "REGISTER", entityType: "USER", entityId: user.id, description: "Khách hàng đăng ký tài khoản.", req });
    return res.status(201).json({
      message: "Đăng ký tài khoản thành công.",
      token: createToken(loginUser),
      user: loginUser,
    });
  } catch (error) {
    try { await transaction.rollback(); } catch {}
    if (error?.number === 2627 || error?.number === 2601) {
      return res.status(409).json({ message: "Tên đăng nhập hoặc email đã được sử dụng." });
    }
    console.error("Register error:", error);
    return res.status(500).json({ message: "Lỗi server khi đăng ký tài khoản." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: "Vui lòng nhập username và password." });
    }

    const wait = loginGuard.retryAfterSeconds(req.ip, String(username).trim());
    if (wait > 0) {
      res.setHeader("Retry-After", String(wait));
      return res.status(429).json({ message: `Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${Math.ceil(wait / 60)} phút.` });
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input("username", sql.VarChar, username.trim())
      .query(`
        SELECT
          u.id, u.username, u.password_hash, u.full_name, u.email, u.phone,
          u.is_active, r.name AS role_name
        FROM dbo.users u
        INNER JOIN dbo.roles r ON r.id = u.role_id
        WHERE u.username = @username
      `);

    if (!result.recordset.length) {
      loginGuard.recordFailure(req.ip, String(username).trim());
      return res.status(401).json({ message: "Tên đăng nhập hoặc mật khẩu không đúng." });
    }

    const dbUser = result.recordset[0];
    if (!dbUser.is_active) {
      return res.status(403).json({ message: "Tài khoản đã bị khóa hoặc vô hiệu hóa." });
    }

    const ok = await bcrypt.compare(password, dbUser.password_hash);
    if (!ok) {
      loginGuard.recordFailure(req.ip, String(username).trim());
      return res.status(401).json({ message: "Tên đăng nhập hoặc mật khẩu không đúng." });
    }
    loginGuard.recordSuccess(req.ip, String(username).trim());

    await pool.request()
      .input("userId", sql.Int, dbUser.id)
      .query("UPDATE dbo.users SET last_login_at = SYSDATETIME(), updated_at = SYSDATETIME() WHERE id = @userId");

    const user = {
      id: dbUser.id,
      username: dbUser.username,
      full_name: dbUser.full_name,
      email: dbUser.email,
      phone: dbUser.phone,
      is_active: dbUser.is_active,
      role_name: dbUser.role_name,
    };

    await writeAudit(pool, { userId: dbUser.id, action: "LOGIN", entityType: "USER", entityId: dbUser.id, description: `Đăng nhập thành công với quyền ${dbUser.role_name}.`, req });
    return res.json({ message: "Đăng nhập thành công.", token: createToken(user), user });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Lỗi server khi đăng nhập tài khoản." });
  }
});

router.get("/me", authenticateToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input("userId", sql.Int, req.user.id)
      .query(`
        SELECT u.id, u.username, u.full_name, u.email, u.phone, u.is_active, r.name AS role_name
        FROM dbo.users u
        INNER JOIN dbo.roles r ON r.id = u.role_id
        WHERE u.id = @userId
      `);
    if (!result.recordset.length) return res.status(404).json({ message: "Không tìm thấy người dùng." });
    res.json({ user: result.recordset[0] });
  } catch (error) {
    console.error("Auth me error:", error);
    res.status(500).json({ message: "Không tải được thông tin tài khoản." });
  }
});

/*
 * Quên mật khẩu qua email:
 *  1) POST /forgot-password {identifier: tên đăng nhập hoặc email}  -> luôn trả cùng một thông báo
 *     (không lộ tài khoản có tồn tại hay không). Token ngẫu nhiên 32 byte, CSDL chỉ lưu bản băm SHA-256,
 *     hết hạn sau 30 phút, dùng được một lần, tối đa 1 yêu cầu / 2 phút / tài khoản.
 *  2) POST /reset-password {token, newPassword} -> đổi mật khẩu, vô hiệu mọi token cũ và mọi phiên đăng nhập cũ.
 * Tài khoản không có email vẫn nhờ ADMIN đặt lại qua /admin/reset-password.
 */
router.post("/forgot-password", async (req, res) => {
  const generic = { message: "Nếu tài khoản tồn tại và có email, hướng dẫn đặt lại mật khẩu đã được gửi. Vui lòng kiểm tra hộp thư (cả thư rác)." };
  try {
    const identifier = String(req.body?.identifier || "").trim();
    if (!identifier) return res.status(400).json({ message: "Vui lòng nhập tên đăng nhập hoặc email." });

    const pool = await poolPromise;
    const found = await pool.request().input("id", sql.VarChar, identifier.slice(0, 150)).query(`
      SELECT TOP 1 u.id, u.full_name, u.email FROM dbo.users u
      WHERE u.is_active=1 AND u.email IS NOT NULL AND (u.username=@id OR u.email=@id)
    `);
    const user = found.recordset[0];
    if (!user) return res.json(generic);

    const recent = await pool.request().input("uid", sql.Int, user.id).query(
      "SELECT TOP 1 id FROM dbo.password_reset_tokens WHERE user_id=@uid AND created_at > DATEADD(MINUTE,-2,SYSUTCDATETIME())");
    if (recent.recordset.length) return res.json(generic);

    const token = crypto.randomBytes(32).toString("hex");
    await pool.request()
      .input("uid", sql.Int, user.id)
      .input("hash", sql.Char(64), sha256(token))
      .input("mins", sql.Int, RESET_TOKEN_MINUTES)
      .input("ip", sql.VarChar, String(req.ip || "").slice(0, 64))
      .query("INSERT INTO dbo.password_reset_tokens(user_id,token_hash,expires_at,requested_ip) VALUES(@uid,@hash,DATEADD(MINUTE,@mins,SYSUTCDATETIME()),@ip)");

    const base = String(process.env.APP_WEB_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    await sendMail({ to: user.email, ...mailTemplates.passwordReset({ name: user.full_name, link: `${base}/?reset=${token}`, minutes: RESET_TOKEN_MINUTES }) });
    await writeAudit(pool, { userId: user.id, action: "REQUEST_PASSWORD_RESET", entityType: "USER", entityId: user.id, description: "Yêu cầu đặt lại mật khẩu qua email.", req });
    return res.json(generic);
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ message: "Không thể xử lý yêu cầu. Vui lòng thử lại sau." });
  }
});

router.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body || {};
  const tx = new sql.Transaction(await poolPromise);
  try {
    if (!token || !/^[a-f0-9]{64}$/.test(String(token))) return res.status(400).json({ message: "Liên kết đặt lại mật khẩu không hợp lệ." });
    const pwProblem = passwordProblem(newPassword);
    if (pwProblem) return res.status(400).json({ message: pwProblem.replace("Mật khẩu", "Mật khẩu mới") });

    const newHash = await bcrypt.hash(String(newPassword), 12);
    await tx.begin();
    const tk = await new sql.Request(tx).input("hash", sql.Char(64), sha256(String(token))).query(`
      SELECT TOP 1 t.id, t.user_id FROM dbo.password_reset_tokens t WITH (UPDLOCK)
      INNER JOIN dbo.users u ON u.id=t.user_id
      WHERE t.token_hash=@hash AND t.used_at IS NULL AND t.expires_at > SYSUTCDATETIME() AND u.is_active=1
    `);
    const row = tk.recordset[0];
    if (!row) { await tx.rollback(); return res.status(400).json({ message: "Liên kết đã hết hạn hoặc đã được sử dụng. Vui lòng yêu cầu lại." }); }

    await new sql.Request(tx).input("uid", sql.Int, row.user_id).input("hash", sql.VarChar, newHash)
      .query("UPDATE dbo.users SET password_hash=@hash, password_changed_at=SYSUTCDATETIME(), updated_at=SYSDATETIME() WHERE id=@uid");
    await new sql.Request(tx).input("uid", sql.Int, row.user_id)
      .query("UPDATE dbo.password_reset_tokens SET used_at=SYSUTCDATETIME() WHERE user_id=@uid AND used_at IS NULL");
    await tx.commit();

    invalidateUserCache(row.user_id);
    await writeAudit(await poolPromise, { userId: row.user_id, action: "RESET_PASSWORD_BY_EMAIL", entityType: "USER", entityId: row.user_id, description: "Đặt lại mật khẩu qua liên kết email.", req });
    return res.json({ message: "Đặt lại mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới." });
  } catch (error) {
    try { await tx.rollback(); } catch { /* chưa bắt đầu hoặc đã rollback */ }
    console.error("Reset password error:", error);
    return res.status(500).json({ message: "Không thể đặt lại mật khẩu. Vui lòng thử lại." });
  }
});

/* Đổi mật khẩu khi đã đăng nhập. */
router.post("/change-password", authenticateToken, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: "Vui lòng nhập mật khẩu hiện tại và mật khẩu mới." });
    }
    const pwProblem = passwordProblem(newPassword);
    if (pwProblem) return res.status(400).json({ message: pwProblem.replace("Mật khẩu", "Mật khẩu mới") });

    const pool = await poolPromise;
    const result = await pool.request()
      .input("userId", sql.Int, req.user.id)
      .query("SELECT TOP 1 id, password_hash FROM dbo.users WHERE id=@userId AND is_active=1");
    const dbUser = result.recordset[0];
    if (!dbUser) return res.status(404).json({ message: "Không tìm thấy người dùng." });

    const ok = await bcrypt.compare(String(oldPassword), dbUser.password_hash);
    if (!ok) return res.status(401).json({ message: "Mật khẩu hiện tại không đúng." });

    const newHash = await bcrypt.hash(String(newPassword), 12);
    await pool.request()
      .input("userId", sql.Int, req.user.id)
      .input("hash", sql.VarChar, newHash)
      .query("UPDATE dbo.users SET password_hash=@hash, password_changed_at=SYSUTCDATETIME(), updated_at=SYSDATETIME() WHERE id=@userId");
    invalidateUserCache(req.user.id);

    await writeAudit(pool, { userId: req.user.id, action: "CHANGE_PASSWORD", entityType: "USER", entityId: req.user.id, description: "Người dùng tự đổi mật khẩu.", req });
    // Token cũ (kể cả của thiết bị khác) đã bị vô hiệu: cấp token mới để phiên hiện tại không bị đăng xuất.
    const fresh = createToken({ id: req.user.id, username: req.user.username, role_name: req.user.role });
    return res.json({ message: "Đổi mật khẩu thành công.", token: fresh });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({ message: "Lỗi server khi đổi mật khẩu." });
  }
});

/* ADMIN đặt lại mật khẩu tạm cho tài khoản không có email / không tự khôi phục được. */
router.post("/admin/reset-password", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId, newPassword } = req.body || {};
    if (!userId || !newPassword) return res.status(400).json({ message: "Thiếu userId hoặc newPassword." });
    const pwProblem = passwordProblem(newPassword);
    if (pwProblem) return res.status(400).json({ message: pwProblem.replace("Mật khẩu", "Mật khẩu mới") });

    const pool = await poolPromise;
    const target = await pool.request().input("userId", sql.Int, Number(userId)).query("SELECT TOP 1 id, username FROM dbo.users WHERE id=@userId");
    if (!target.recordset.length) return res.status(404).json({ message: "Không tìm thấy người dùng." });

    const newHash = await bcrypt.hash(String(newPassword), 12);
    await pool.request()
      .input("userId", sql.Int, Number(userId))
      .input("hash", sql.VarChar, newHash)
      .query("UPDATE dbo.users SET password_hash=@hash, password_changed_at=SYSUTCDATETIME(), updated_at=SYSDATETIME() WHERE id=@userId");
    invalidateUserCache(Number(userId));

    await writeAudit(pool, { userId: req.user.id, action: "ADMIN_RESET_PASSWORD", entityType: "USER", entityId: Number(userId), description: `ADMIN đặt lại mật khẩu cho tài khoản ${target.recordset[0].username}.`, req });
    return res.json({ message: "Đã đặt lại mật khẩu cho người dùng." });
  } catch (error) {
    console.error("Admin reset password error:", error);
    return res.status(500).json({ message: "Lỗi server khi đặt lại mật khẩu." });
  }
});

export default router;
