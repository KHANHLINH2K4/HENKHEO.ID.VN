/*
 * Tạo / đặt lại tài khoản ADMIN.
 *   ADMIN_USERNAME (mặc định "admin"), ADMIN_PASSWORD trong .env.
 *   Không đặt ADMIN_PASSWORD -> script tự sinh mật khẩu ngẫu nhiên và in ra MỘT lần.
 * (Trước đây mật khẩu cố định "Admin@123456" nằm sẵn trong mã nguồn — không an toàn khi triển khai thật.)
 */
import "./config.js";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { poolPromise, sql } from "./db.js";

const username = (process.env.ADMIN_USERNAME || "admin").trim();
let password = process.env.ADMIN_PASSWORD;
let generated = false;
if (!password) {
  password = crypto.randomBytes(9).toString("base64url") + "#7a";
  generated = true;
}
if (password.length < 8) {
  console.error("❌ ADMIN_PASSWORD phải có ít nhất 8 ký tự.");
  process.exit(1);
}

try {
  const pool = await poolPromise;
  const roleResult = await pool.request()
    .input("roleName", sql.VarChar, "ADMIN")
    .query("SELECT id FROM dbo.roles WHERE name = @roleName");
  if (!roleResult.recordset.length) throw new Error("Không tìm thấy role ADMIN. Hãy chạy `npm run db:migrate` trước.");
  const roleId = roleResult.recordset[0].id;
  const hash = await bcrypt.hash(password, 12);

  const exists = await pool.request()
    .input("username", sql.VarChar, username)
    .query("SELECT id FROM dbo.users WHERE username = @username");

  if (exists.recordset.length) {
    await pool.request()
      .input("username", sql.VarChar, username)
      .input("passwordHash", sql.VarChar, hash)
      .input("roleId", sql.Int, roleId)
      .query("UPDATE dbo.users SET password_hash=@passwordHash, role_id=@roleId, is_active=1, updated_at=SYSDATETIME() WHERE username=@username");
    console.log(`✅ Đã cập nhật tài khoản ADMIN "${username}".`);
  } else {
    await pool.request()
      .input("roleId", sql.Int, roleId)
      .input("username", sql.VarChar, username)
      .input("passwordHash", sql.VarChar, hash)
      .input("fullName", sql.NVarChar, "Quản trị viên Hẹn Khéo")
      .input("email", sql.VarChar, process.env.ADMIN_EMAIL || "admin@henkheo.local")
      .input("phone", sql.VarChar, "0900000000")
      .query(`
        INSERT INTO dbo.users (role_id, username, password_hash, full_name, email, phone, is_active)
        VALUES (@roleId, @username, @passwordHash, @fullName, @email, @phone, 1)
      `);
    console.log(`✅ Đã tạo tài khoản ADMIN "${username}".`);
  }
  if (generated) {
    console.log("──────────────────────────────────────────────");
    console.log(` Tên đăng nhập : ${username}`);
    console.log(` Mật khẩu      : ${password}`);
    console.log(" (Chỉ hiển thị một lần — hãy lưu lại và đổi sau khi đăng nhập.)");
    console.log("──────────────────────────────────────────────");
  }
  process.exit(0);
} catch (error) {
  console.error("❌ Seed admin lỗi:", error.message);
  process.exit(1);
}
