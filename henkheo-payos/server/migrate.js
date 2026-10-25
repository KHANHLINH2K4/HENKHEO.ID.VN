import "./config.js";
import pkg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runMigrations() {
  console.log("🚀 Bắt đầu chạy migration lên PostgreSQL (Supabase)...");
  
  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log("⚠️ Không tìm thấy thư mục migrations, bỏ qua bước migrate.");
    process.exit(0);
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  try {
    for (const file of files) {
      console.log(`📂 Đang chạy migration: ${file}`);
      const filePath = path.join(migrationsDir, file);
      let rawSql = fs.readFileSync(filePath, 'utf8');

      // Loại bỏ các từ khóa hoặc dòng lệnh không tương thích với Postgres nếu có (như GO)
      rawSql = rawSql.replace(/^\s*GO\s*$/gim, '');

      // Thực thi toàn bộ câu lệnh SQL an toàn trên Postgres
      await client.query(rawSql);
      console.log(`✅ Hoàn thành: ${file}`);
    }
    console.log("🎉 Tất cả các migration đã chạy thành công!");
  } catch (err) {
    console.error("❌ Lỗi khi chạy migration:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();