import { test } from "node:test";
import assert from "node:assert/strict";
process.env.JWT_SECRET ||= "test";
process.env.DB_CONNECT_TIMEOUT = "500";
const { validateTimeOffRange, daysBetween } = await import("../routes/timeOff.js");

test("daysBetween liệt kê đủ ngày (kể cả qua tháng/năm)", () => {
  assert.deepEqual(daysBetween("2026-12-30", "2027-01-02"), ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  assert.deepEqual(daysBetween("2026-10-21", "2026-10-21"), ["2026-10-21"]);
});

test("Đơn nghỉ: chặn ngày quá khứ, đảo ngược, quá dài, quá xa, sai định dạng", () => {
  const now = "2026-10-21";
  assert.equal(validateTimeOffRange("2026-10-22", "2026-10-23", now), null);
  assert.match(validateTimeOffRange("2026-10-20", "2026-10-22", now), /đã qua/);
  assert.match(validateTimeOffRange("2026-10-25", "2026-10-24", now), /sau hoặc bằng/);
  assert.match(validateTimeOffRange("2026-10-22", "2026-12-30", now), /tối đa 30 ngày/);
  assert.match(validateTimeOffRange("2027-06-01", "2027-06-02", now), /tối đa 180 ngày/);
  assert.match(validateTimeOffRange("abc", "2026-10-22", now), /không hợp lệ/);
});
