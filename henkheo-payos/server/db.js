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

export const poolPromise = pool.connect();
poolPromise.catch(() => {});

// Bổ sung object `sql` giả lập để các file cũ gọi import { sql } không bị lỗi SyntaxError
export const sql = {
  query: async (queryText, params) => {
    const client = await pool.connect();
    try {
      // Chuyển đổi cú pháp tham số từ @param sang $1, $2 nếu cần, hoặc chạy trực tiếp
      const res = await client.query(queryText, params);
      return res;
    } finally {
      client.release();
    }
  }
};

export { pool };
export default pool;