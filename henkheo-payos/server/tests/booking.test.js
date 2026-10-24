import { test } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET ||= "test";
process.env.DB_CONNECT_TIMEOUT = "500";
process.env.BOOKING_MIN_LEAD_MINUTES = "30";
process.env.BOOKING_MAX_ADVANCE_DAYS = "60";
const { validateBookingWindow, dropPastSlots, buildSlots } = await import("../routes/appointments.js");

const today = () => new Date().toLocaleDateString("en-CA");
const shift = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };

test("Chặn ngày quá khứ và ngày quá xa", () => {
  assert.match(validateBookingWindow(shift(-1), 600), /đã qua/);
  assert.match(validateBookingWindow(shift(61), 600), /tối đa 60 ngày/);
  assert.equal(validateBookingWindow(shift(2), 600), null);
  assert.match(validateBookingWindow("abc", 600), /không hợp lệ/);
});

test("Hôm nay: phải đặt trước đủ số phút tối thiểu", () => {
  const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
  assert.match(validateBookingWindow(today(), Math.max(0, nowMin - 5)), /ít nhất 30 phút/);
  if (nowMin + 60 < 1080) assert.equal(validateBookingWindow(today(), nowMin + 60), null);
});

test("dropPastSlots: ngày tương lai giữ nguyên, ngày quá khứ trống", () => {
  const slots = ["08:00", "09:00"];
  assert.deepEqual(dropPastSlots(shift(1), slots), slots);
  assert.deepEqual(dropPastSlots(shift(-1), slots), []);
});

test("buildSlots tránh lịch đã đặt và đủ thời lượng", () => {
  const slots = buildSlots(
    [{ start_time: "08:00", end_time: "10:00" }],
    [{ start_time: "08:30", end_time: "09:00" }],
    60
  );
  assert.deepEqual(slots, ["09:00"]); // 08:00–09:00 và 08:30–09:30 đều đụng lịch 08:30–09:00
});
