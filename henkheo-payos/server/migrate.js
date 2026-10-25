/*
 * Bộ chạy migration CSDL tự động (thay cho việc mở từng file .sql trong SSMS).
 *
 *   npm run db:migrate            -> tạo database (nếu chưa có), chạy các migration còn thiếu
 *   npm run db:migrate -- --seed  -> như trên + nạp dữ liệu mẫu (categories, dịch vụ, nhân viên demo)
 *
 * - Mỗi file chỉ chạy đúng 1 lần, ghi nhận trong bảng dbo.schema_migrations.
 * - File được tách theo dòng "GO" (cú pháp của SSMS, SQL Server không hiểu GO khi gửi qua driver).
 * - An toàn khi chạy lại nhiều lần.
 * - Các file legacy đã bị hợp nhất (migration_operational_v2/v3, migration_payments,
 *   migration_final_features, migration_price_at_booking) và file phá dữ liệu
 *   (fix_staff_schedule_08_18.sql) KHÔNG nằm trong danh sách này.
 */
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
  
  const migrationsDir = path.join(__dirname, 'migrations'); // hoặc thư mục chứa file sql của bạn
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
      const sqlQuery = fs.readFileSync(filePath, 'utf8');
      await client.query(sqlQuery);
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