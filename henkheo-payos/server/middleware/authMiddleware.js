import jwt from "jsonwebtoken";
import { poolPromise, sql } from "../db.js";

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Thiếu JWT_SECRET trong file .env");
  return secret;
}

/*
 * Token chỉ chứng minh "đã đăng nhập lúc nào", không đủ để tin quyền hiện tại.
 * Mỗi request ta đối chiếu lại CSDL (cache ngắn 10 giây để không tốn truy vấn):
 *   - tài khoản bị khóa  -> từ chối ngay (không phải đợi token hết hạn)
 *   - vai trò bị đổi     -> dùng vai trò MỚI trong CSDL
 *   - đã đổi/đặt lại mật khẩu sau khi cấp token -> token cũ vô hiệu
 */
const CACHE_TTL_MS = 10_000;
const cache = new Map();

export function invalidateUserCache(userId) {
  if (userId == null) cache.clear();
  else cache.delete(Number(userId));
}

async function loadUserState(userId) {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.state;
  const pool = await poolPromise;
  const r = await pool.request().input("id", sql.Int, userId).query(`
    SELECT u.is_active, r.name AS role_name, u.password_changed_at
    FROM dbo.users u INNER JOIN dbo.roles r ON r.id = u.role_id
    WHERE u.id = @id
  `);
  const row = r.recordset[0];
  const state = row
    ? {
        active: !!row.is_active,
        role: row.role_name,
        // Cột lưu UTC (SYSUTCDATETIME) nên Date trả về đã đúng thời điểm tuyệt đối.
        passwordChangedAt: row.password_changed_at ? new Date(row.password_changed_at).getTime() : 0,
      }
    : null;
  cache.set(userId, { at: Date.now(), state });
  return state;
}

/** Xác minh token + trạng thái tài khoản. Trả về payload đã làm mới, hoặc ném lỗi có `status`. */
export async function verifyAccessToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, getSecret());
  } catch {
    const e = new Error("Token không hợp lệ hoặc đã hết hạn.");
    e.status = 401;
    throw e;
  }
  const state = await loadUserState(Number(payload.id));
  if (!state) { const e = new Error("Tài khoản không tồn tại."); e.status = 401; throw e; }
  if (!state.active) { const e = new Error("Tài khoản đã bị khóa hoặc vô hiệu hóa."); e.status = 403; throw e; }
  if (state.passwordChangedAt && payload.iat * 1000 < state.passwordChangedAt - 1000) {
    const e = new Error("Mật khẩu đã thay đổi, vui lòng đăng nhập lại."); e.status = 401; throw e;
  }
  return { ...payload, role: state.role };
}

export async function authenticateToken(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Bạn chưa đăng nhập.", code: "AUTH_INVALID" });
    }
    req.user = await verifyAccessToken(header.slice(7));
    next();
  } catch (error) {
    if (!error.status) console.error("Auth error:", error.message);
    // code=AUTH_INVALID để giao diện biết phải xóa phiên đăng nhập và quay về trang đăng nhập.
    return res.status(error.status || 500).json({
      message: error.status ? error.message : "Lỗi xác thực.",
      ...(error.status ? { code: "AUTH_INVALID" } : {}),
    });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ message: "Bạn chưa đăng nhập." });
  if (req.user.role !== "ADMIN") return res.status(403).json({ message: "Bạn không có quyền ADMIN." });
  next();
}

export function requireAdminOrStaff(req, res, next) {
  if (!req.user) return res.status(401).json({ message: "Bạn chưa đăng nhập." });
  if (!["ADMIN", "STAFF"].includes(req.user.role)) {
    return res.status(403).json({ message: "Bạn không có quyền truy cập chức năng này." });
  }
  next();
}

export function requireCustomer(req, res, next) {
  if (!req.user) return res.status(401).json({ message: "Bạn chưa đăng nhập." });
  if (req.user.role !== "CUSTOMER") {
    return res.status(403).json({ message: "Chức năng này dành cho CUSTOMER." });
  }
  next();
}

export function requireStaff(req, res, next) {
  if (!req.user) return res.status(401).json({ message: "Bạn chưa đăng nhập." });
  if (!["STAFF", "ADMIN"].includes(req.user.role)) {
    return res.status(403).json({ message: "Chức năng này dành cho STAFF." });
  }
  next();
}
