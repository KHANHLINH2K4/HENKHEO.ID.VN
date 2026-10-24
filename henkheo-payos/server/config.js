/*
 * Nạp cấu hình MỘT lần, trước mọi module khác (phải là import đầu tiên trong index.js).
 *  - Đặt múi giờ ứng dụng: toàn bộ logic "hôm nay / giờ hiện tại" (chặn đặt lịch quá khứ,
 *    thống kê theo ngày, lọc khung giờ) dựa vào TZ này, không phụ thuộc máy chủ đặt ở đâu.
 *  - Kiểm tra biến môi trường bắt buộc, dừng sớm với thông báo rõ ràng thay vì lỗi khó hiểu
 *    khi chạy.
 */
import dotenv from "dotenv";
dotenv.config();

process.env.TZ = process.env.APP_TIMEZONE || process.env.TZ || "Asia/Ho_Chi_Minh";

export const isProduction = process.env.NODE_ENV === "production";

const PLACEHOLDERS = ["replace_with_a_long_random_secret", "henkheo_jwt_secret_change_this_2026", "changeme"];
const DB_PASSWORD_PLACEHOLDERS = ["ChangeMe_Strong#2026", "changeme", "password", "YourStrong@Passw0rd"];

export function validateConfig() {
  const errors = [];
  const warnings = [];

  const secret = process.env.JWT_SECRET || "";
  if (!secret) errors.push("Thiếu JWT_SECRET.");
  else if (PLACEHOLDERS.includes(secret) || secret.length < 32) {
    (isProduction ? errors : warnings).push(
      "JWT_SECRET đang là giá trị mẫu hoặc quá ngắn (<32 ký tự). Tạo chuỗi ngẫu nhiên: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
    );
  }

  if (!process.env.DB_USER || !process.env.DB_PASSWORD) errors.push("Thiếu DB_USER / DB_PASSWORD.");
  else {
    if (DB_PASSWORD_PLACEHOLDERS.includes(process.env.DB_PASSWORD)) {
      (isProduction ? errors : warnings).push("DB_PASSWORD đang là mật khẩu mẫu. Hãy đặt mật khẩu mạnh, duy nhất.");
    }
    if (isProduction && String(process.env.DB_USER).toLowerCase() === "sa") {
      warnings.push("Server đang kết nối CSDL bằng tài khoản 'sa' (toàn quyền). Hãy dùng tài khoản đọc/ghi riêng: đặt APP_DB_USER/APP_DB_PASSWORD rồi chạy migrate (xem docs/DEPLOYMENT.md).");
    }
  }

  const open = process.env.BUSINESS_OPEN_TIME; const close = process.env.BUSINESS_CLOSE_TIME;
  const hm = (v) => /^\d{1,2}:\d{2}$/.test(String(v));
  if ((open && !hm(open)) || (close && !hm(close))) errors.push("BUSINESS_OPEN_TIME / BUSINESS_CLOSE_TIME phải có dạng HH:MM (vd 08:00).");

  const payosKeys = ["PAYOS_CLIENT_ID", "PAYOS_API_KEY", "PAYOS_CHECKSUM_KEY"];
  const set = payosKeys.filter((k) => process.env[k] && !process.env[k].startsWith("YOUR_"));
  if (set.length === 0) {
    warnings.push("payOS chưa cấu hình → khách chỉ có thể chọn 'Thanh toán tại cơ sở'.");
  } else if (set.length < payosKeys.length) {
    errors.push(`payOS cấu hình thiếu: cần đủ ${payosKeys.join(", ")}.`);
  } else if (isProduction && !/^https:\/\//i.test(process.env.PAYOS_WEBHOOK_URL || "")) {
    warnings.push("PAYOS_WEBHOOK_URL phải là URL HTTPS công khai thì payOS mới gửi được webhook.");
  }

  if (isProduction && !process.env.CORS_ORIGIN) {
    warnings.push("CORS_ORIGIN chưa đặt: mặc định chỉ cho phép cùng origin (phù hợp khi server phục vụ luôn giao diện).");
  }

  for (const w of warnings) console.warn(`⚠️  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`❌ ${e}`);
    console.error("Dừng khởi động do cấu hình chưa hợp lệ. Xem server/.env.example.");
    process.exit(1);
  }
}

/** Danh sách origin được phép gọi API/Socket.IO (CORS_ORIGIN, phân tách bằng dấu phẩy). */
export function allowedOrigins() {
  return String(process.env.CORS_ORIGIN || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}
