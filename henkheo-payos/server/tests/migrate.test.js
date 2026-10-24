import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.DB_CONNECT_TIMEOUT = "500";
const { splitBatches, MIGRATIONS, SEEDS, REPEATABLE } = await import("../migrate.js");
const dir = path.dirname(fileURLToPath(import.meta.url));

test("splitBatches tách theo GO và bỏ batch rỗng", () => {
  const out = splitBatches("USE x;\nGO\nSELECT 1;\n  go  \n\nSELECT 2;\nGO 2\n");
  assert.equal(out.length, 3);
  assert.equal(out[1], "SELECT 1;");
});

test("splitBatches không cắt nhầm chữ 'GO' nằm trong câu lệnh", () => {
  const out = splitBatches("SELECT 'GOOD' AS a;\nGO\nSELECT N'ĐI GO ĐI';");
  assert.equal(out.length, 2);
});

test("Mọi file migration/seed khai báo đều tồn tại", () => {
  for (const m of [...MIGRATIONS, ...SEEDS]) assert.ok(fs.existsSync(path.join(dir, "..", m.file)), m.file);
  for (const f of REPEATABLE) assert.ok(fs.existsSync(path.join(dir, "..", f)), f);
});

test("Tên migration không trùng nhau", () => {
  const names = MIGRATIONS.map((m) => m.name);
  assert.equal(new Set(names).size, names.length);
});
