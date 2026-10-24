import "./config.js"; // đảm bảo .env đã nạp và TZ đã đặt trước khi tạo kết nối
import sql from "mssql";

const options = {
  // Bật DB_ENCRYPT=true khi kết nối SQL Server từ xa/Azure. Localhost/Docker thì để false.
  encrypt: String(process.env.DB_ENCRYPT || "false").toLowerCase() === "true",
  trustServerCertificate: String(process.env.DB_TRUST_CERT || "true").toLowerCase() === "true",
};
if (process.env.DB_INSTANCE) {
  options.instanceName = process.env.DB_INSTANCE; // vd: SQLEXPRESS
}

export function buildConfig(database = process.env.DB_NAME || "henkheo") {
  const config = {
    server: process.env.DB_SERVER || "localhost",
    database,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options,
    pool: { max: Number(process.env.DB_POOL_MAX) || 10, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT) || 30000,
    connectionTimeout: Number(process.env.DB_CONNECT_TIMEOUT) || 15000,
  };
  // Khi dùng instanceName, KHÔNG khai báo port (mssql tự dò qua SQL Browser).
  if (!process.env.DB_INSTANCE) config.port = Number(process.env.DB_PORT) || 1433;
  return config;
}

export const poolPromise = sql.connect(buildConfig());
// Tránh "unhandled rejection" ồn ào khi DB chưa chạy; index.js sẽ await và báo lỗi rõ ràng.
poolPromise.catch(() => {});
export { sql };
