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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sql from "mssql";
import { buildConfig } from "./db.js";

const dir = path.dirname(fileURLToPath(import.meta.url));

// Thứ tự quan trọng.
export const MIGRATIONS = [
  { name: "001_schema.sql", file: "schema.sql", baseline: true },
  { name: "002_staff_services.sql", file: "staff_services_migration.sql" },
  { name: "003_operational_v3_complete.sql", file: "migration_operational_v3_complete.sql" },
  { name: "004_payos.sql", file: "migration_payos.sql" },
  { name: "005_chat_booking_flow.sql", file: "migration_chat_booking_flow.sql" },
  { name: "006_production_hardening.sql", file: "migrations/006_production_hardening.sql" },
  { name: "007_business_rules.sql", file: "migrations/007_business_rules.sql" },
];
export const SEEDS = [{ name: "seed_demo_data.sql", file: "seed.sql" }];
// Chạy sau MỖI lần migrate (idempotent), không ghi vào schema_migrations.
export const REPEATABLE = ["migrations/R__ensure_defaults.sql"];

/** Danh sách migration chưa được áp dụng vào database (dùng khi khởi động server). */
export async function pendingMigrations(pool) {
  let applied = new Set();
  try {
    const r = await pool.request().query("SELECT name FROM dbo.schema_migrations");
    applied = new Set(r.recordset.map((x) => x.name));
  } catch {
    // Chưa có bảng schema_migrations: database chưa từng chạy `npm run db:migrate`.
  }
  return MIGRATIONS.filter((m) => !applied.has(m.name)).map((m) => m.name);
}

/** Tách script T-SQL thành các batch theo dòng GO (không phân biệt hoa thường, cho phép GO n). */
export function splitBatches(script) {
  return script
    .replace(/^\uFEFF/, "")
    .split(/^\s*GO(?:\s+\d+)?\s*(?:--.*)?$/gim)
    .map((b) => b.trim())
    .filter(Boolean);
}

/** Bỏ dòng "USE <db>;" vì ta đã kết nối thẳng vào đúng database. */
function stripUse(batch) {
  return batch.replace(/^\s*USE\s+\[?[\w]+\]?\s*;?\s*$/gim, "").trim();
}

async function runFile(pool, file) {
  const script = fs.readFileSync(path.join(dir, file), "utf8");
  const batches = splitBatches(script);
  for (let i = 0; i < batches.length; i += 1) {
    const batch = stripUse(batches[i]);
    if (!batch) continue;
    try {
      await pool.request().batch(batch);
    } catch (e) {
      // Chỉ rõ đoạn lệnh nào lỗi để dễ sửa (các đoạn trước đó đã chạy xong, chạy lại migrate là an toàn).
      const preview = batch.replace(/\s+/g, " ").slice(0, 160);
      e.message = `${e.message}\n   (file ${file}, đoạn ${i + 1}/${batches.length}: ${preview}...)`;
      throw e;
    }
  }
}

async function main() {
  const withSeed = process.argv.includes("--seed");
  const dbName = process.env.DB_NAME || "henkheo";
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) throw new Error("DB_NAME chỉ được chứa chữ, số, dấu gạch dưới.");

  // 1. Tạo database nếu chưa có (kết nối vào master).
  // Khi chạy trong Docker, SQL Server cần vài chục giây để khởi động -> thử lại tối đa ~90 giây.
  let master;
  for (let attempt = 1; ; attempt += 1) {
    try {
      master = await new sql.ConnectionPool(buildConfig("master")).connect();
      break;
    } catch (e) {
      if (attempt >= 30) throw e;
      console.log(`… chờ SQL Server sẵn sàng (${attempt}/30): ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  await master.request().batch(`IF DB_ID(N'${dbName}') IS NULL CREATE DATABASE [${dbName}];`);
  await master.close();
  console.log(`✔ Database [${dbName}] sẵn sàng.`);

  // 2. Kết nối database ứng dụng.
  const pool = await new sql.ConnectionPool(buildConfig(dbName)).connect();
  await pool.request().batch(`
    IF OBJECT_ID(N'dbo.schema_migrations', N'U') IS NULL
      CREATE TABLE dbo.schema_migrations (
        name NVARCHAR(200) NOT NULL PRIMARY KEY,
        applied_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()
      );`);

  const applied = new Set((await pool.request().query("SELECT name FROM dbo.schema_migrations")).recordset.map((r) => r.name));
  const hasSchema = (await pool.request().query("SELECT OBJECT_ID(N'dbo.roles', N'U') AS id")).recordset[0].id != null;

  // Seed demo phải chạy ngay sau schema (trước các migration tạo lịch tuần / phân công dịch vụ).
  const [schemaStep, ...rest] = MIGRATIONS;
  const plan = [schemaStep, ...(withSeed ? SEEDS : []), ...rest];
  for (const m of plan) {
    if (applied.has(m.name)) { console.log(`• Bỏ qua (đã chạy): ${m.name}`); continue; }

    // Database có sẵn từ trước (đã chạy schema.sql bằng SSMS): ghi nhận baseline, KHÔNG chạy lại schema.
    if (m.baseline && hasSchema) {
      await pool.request().input("n", sql.NVarChar, m.name).query("INSERT INTO dbo.schema_migrations(name) VALUES(@n)");
      console.log(`• Nhận diện schema có sẵn, đánh dấu baseline: ${m.name}`);
      continue;
    }
    if (!fs.existsSync(path.join(dir, m.file))) throw new Error(`Thiếu file migration: ${m.file}`);

    process.stdout.write(`→ Đang chạy ${m.name} ... `);
    try {
      await runFile(pool, m.file);
    } catch (e) {
      console.log("LỖI");
      console.error(`Migration ${m.name} thất bại: ${e.message}`);
      await pool.close();
      process.exit(1);
    }
    await pool.request().input("n", sql.NVarChar, m.name).query("INSERT INTO dbo.schema_migrations(name) VALUES(@n)");
    console.log("xong");
  }

  for (const file of REPEATABLE) {
    process.stdout.write(`↻ Đảm bảo dữ liệu nền (${path.basename(file)}) ... `);
    await runFile(pool, file);
    console.log("xong");
  }

  await ensureAppUser(pool);

  await pool.close();
  console.log("✅ Migration hoàn tất. Chạy tiếp: npm run seed:admin");
}

/**
 * Nguyên tắc đặc quyền tối thiểu: nếu đặt APP_DB_USER + APP_DB_PASSWORD, tạo login/user riêng chỉ có quyền
 * đọc/ghi dữ liệu (không có quyền tạo/xóa bảng) để server ứng dụng dùng thay cho tài khoản quản trị (sa).
 * Tài khoản quản trị chỉ dùng cho migration. An toàn khi chạy lại nhiều lần.
 */
async function ensureAppUser(pool) {
  const user = process.env.APP_DB_USER;
  const password = process.env.APP_DB_PASSWORD;
  if (!user || !password) return;
  if (!/^[A-Za-z0-9_]+$/.test(user)) throw new Error("APP_DB_USER chỉ được chứa chữ, số, dấu gạch dưới.");
  if (user === process.env.DB_USER) return;
  if (password.length < 12) throw new Error("APP_DB_PASSWORD cần tối thiểu 12 ký tự (SQL Server còn yêu cầu đủ chữ hoa, thường, số, ký hiệu).");
  const dbName = process.env.DB_NAME || "henkheo";
  const pw = password.replace(/'/g, "''");
  const master = await new sql.ConnectionPool(buildConfig("master")).connect();
  try {
    await master.request().batch(`
      IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name=N'${user}')
        CREATE LOGIN [${user}] WITH PASSWORD=N'${pw}', CHECK_POLICY=ON;
      ELSE
        ALTER LOGIN [${user}] WITH PASSWORD=N'${pw}';
    `);
  } finally {
    await master.close();
  }
  await pool.request().batch(`
    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name=N'${user}')
      CREATE USER [${user}] FOR LOGIN [${user}];
    ALTER ROLE db_datareader ADD MEMBER [${user}];
    ALTER ROLE db_datawriter ADD MEMBER [${user}];
  `);
  console.log(`✔ Tài khoản ứng dụng [${user}] (chỉ đọc/ghi dữ liệu) sẵn sàng trong [${dbName}].`);
}

// Chỉ chạy main khi gọi trực tiếp (để test có thể import splitBatches).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("❌ Migration lỗi:", e.message); process.exit(1); });
}
