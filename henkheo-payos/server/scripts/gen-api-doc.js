/*
 * Sinh docs/API.md từ mã nguồn (server/routes/*.js + điểm gắn trong index.js).
 *   node scripts/gen-api-doc.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = fs.readFileSync(path.join(root, "index.js"), "utf8");
const imports = Object.fromEntries([...index.matchAll(/import (\w+)(?:,\s*\{[^}]*\})? from "\.\/routes\/([\w]+)\.js"/g)].map((m) => [m[1], m[2]]));
const mounts = [...index.matchAll(/app\.use\("(\/api\/[\w/-]+)", (\w+Router)\)/g)].map((m) => ({ prefix: m[1], file: imports[m[2]] })).filter((m) => m.file);

const roleOf = (chain) => {
  if (/requireAdminOrStaff/.test(chain)) return "Admin, Staff";
  if (/requireAdmin/.test(chain)) return "Admin";
  if (/requireStaff/.test(chain)) return "Staff";
  if (/requireCustomer/.test(chain)) return "Customer";
  if (/authenticateToken/.test(chain)) return "Đã đăng nhập";
  return "Công khai";
};

const rows = [];
for (const { prefix, file } of mounts) {
  const src = fs.readFileSync(path.join(root, "routes", `${file}.js`), "utf8");
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*"([^"]*)"\s*,([\s\S]*?)(?:async\s*\(|\(req)/g)) {
    const sub = m[2] === "/" ? "" : m[2];
    rows.push({ method: m[1].toUpperCase(), url: `${prefix}${sub}`, role: roleOf(m[3]), module: `${file}.js` });
  }
}
rows.sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method));

const out = [
  "# Danh sách API",
  "",
  "Sinh tự động từ mã nguồn bằng `node server/scripts/gen-api-doc.js` (đừng sửa tay). Tiền tố `/api`. Cột \"Quyền\" lấy theo middleware khai báo trên route.",
  "",
  "| Method | Đường dẫn | Quyền | Module |",
  "|---|---|---|---|",
  ...rows.map((r) => `| ${r.method} | \`${r.url}\` | ${r.role} | ${r.module} |`),
  "",
  `Tổng cộng **${rows.length}** endpoint (chưa tính Socket.IO: \`notification:new\`, \`appointments:changed\`, \`admin:changed\`, \`payment:changed\`, \`reschedule:changed\`).`,
  "",
  "Ngoài các route trên: `GET /api/live` (liveness, không đụng CSDL) và `GET /api/health` (readiness, kiểm tra cả CSDL).",
  "",
];
fs.writeFileSync(path.join(root, "..", "docs", "API.md"), out.join("\n"));
console.log(`Đã ghi docs/API.md (${rows.length} endpoint).`);
