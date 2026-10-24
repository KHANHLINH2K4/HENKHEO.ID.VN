import { test } from "node:test";
import assert from "node:assert/strict";
process.env.JWT_SECRET ||= "test";
process.env.DB_CONNECT_TIMEOUT = "500";
const { parseRange, csvCell, toCsv } = await import("../routes/reports.js");

test("parseRange: mặc định 30 ngày, chặn khoảng sai/quá dài", () => {
  const r = parseRange({ from: "2026-10-01", to: "2026-10-31" });
  assert.equal(r.days, 31);
  assert.match(parseRange({ from: "2026-10-31", to: "2026-10-01" }).error, /trước hoặc bằng/);
  assert.match(parseRange({ from: "2024-01-01", to: "2026-01-01" }).error, /tối đa 366/);
  assert.match(parseRange({ from: "abc", to: "2026-01-01" }).error, /không hợp lệ/);
  assert.equal(parseRange({}).days, 30);
});

test("CSV: escape nháy kép và chống CSV injection", () => {
  assert.equal(csvCell('Nguyễn "An"'), '"Nguyễn ""An"""');
  assert.equal(csvCell("=HYPERLINK(\"x\")"), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell("+84901234567"), '"\'+84901234567"');
  assert.equal(csvCell(null), '""');
  const csv = toCsv([{ a: 1, b: "x,y" }], [{ header: "A", value: (r) => r.a }, { header: "B", value: (r) => r.b }]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"A","B"\r\n"1","x,y"\r\n$/);
});
