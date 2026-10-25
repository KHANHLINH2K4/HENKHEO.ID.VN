import "./config.js"; // đảm bảo .env đã nạp và TZ đã đặt
import pkg from 'pg';
const { Pool } = pkg;

// Tạo kết nối Pool tới PostgreSQL / Supabase
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Bắt buộc để kết nối từ Render tới Supabase
  },
  max: Number(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT) || 15000,
});

// Bắt lỗi kết nối background của Pool (nếu có)
pool.on('error', (err) => {
  console.error('Lỗi kết nối CSDL PostgreSQL:', err);
});

// Giữ nguyên export poolPromise để tương thích với code index.js hiện tại của bạn
export const poolPromise = pool.connect();
poolPromise.catch(() => {});

export { pool };
export default pool;