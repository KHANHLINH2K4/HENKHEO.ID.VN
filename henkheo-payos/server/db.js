import "./config.js"; // đảm bảo .env đã nạp và TZ đã đặt
import pkg from 'pg';
const { Pool } = pkg;

// Cấu hình pool kết nối PostgreSQL/Supabase
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Bỏ qua lỗi self-signed certificate khi chạy trên Render
  }
});

export const poolPromise = pool;

// Object `sql` giả lập tương thích cho các file cũ gọi truy vấn kiểu query
export const sql = {
  query: async (text, params) => {
    return await pool.query(text, params);
  }
};