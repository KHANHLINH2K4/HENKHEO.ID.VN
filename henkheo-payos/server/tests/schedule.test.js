import { test } from "node:test";
import assert from "node:assert/strict";
process.env.JWT_SECRET ||= "test";
process.env.DB_CONNECT_TIMEOUT = "500";
const { resolveDay, getEffectiveSchedulesForStaff } = await import("../scheduleResolver.js");
const { buildSlots } = await import("../routes/appointments.js");

const D = "2026-10-26"; // thứ Hai

test("resolveDay: ngoại lệ > lịch tuần > lịch cứng cũ", () => {
  const tpl = [{ day_of_week: 1, start_time: "09:00:00", end_time: "17:00:00", is_working: 1 }];
  assert.equal(resolveDay(D, { ex: { is_day_off: 1, reason: "Ốm" }, weekdayRows: tpl, hasTemplates: true }).is_working, false);
  const withEx = resolveDay(D, { ex: { is_day_off: 0, start_time: "13:00:00", end_time: "15:00:00" }, weekdayRows: tpl, hasTemplates: true });
  assert.deepEqual(withEx.shifts, [{ start_time: "13:00", end_time: "15:00" }]);
  const fromTpl = resolveDay(D, { weekdayRows: tpl, hasTemplates: true });
  assert.equal(fromTpl.source, "TEMPLATE"); assert.equal(fromTpl.shifts[0].start_time, "09:00");
  assert.equal(resolveDay(D, { weekdayRows: [], hasTemplates: true }).is_working, false, "có lịch tuần nhưng hôm nay không có dòng làm việc = nghỉ");
  const legacy = resolveDay(D, { legacy: [{ is_available: 1, start_time: "08:00:00", end_time: "12:00:00" }] });
  assert.equal(legacy.source, "CONCRETE"); assert.equal(legacy.is_working, true);
  assert.equal(resolveDay(D, {}).source, "NONE");
});

test("getEffectiveSchedulesForStaff: gộp 3 truy vấn cho nhiều nhân viên và cho kết quả như từng người", async () => {
  const calls = [];
  const pool = { request: () => ({ input() { return this; }, query: async (q) => {
    calls.push(q);
    if (q.includes("staff_schedule_exceptions")) return { recordset: [{ staff_id: 2, is_day_off: 1, reason: "Nghỉ" }] };
    if (q.includes("staff_schedule_templates")) return { recordset: [
      { staff_id: 1, day_of_week: 1, start_time: "09:00:00", end_time: "17:00:00", is_working: 1 },
      { staff_id: 2, day_of_week: 1, start_time: "09:00:00", end_time: "17:00:00", is_working: 1 } ] };
    return { recordset: [] };
  } }) };
  const map = await getEffectiveSchedulesForStaff(pool, [1, 2, 3, "x", 1], D);
  assert.equal(calls.length, 3, "chỉ 3 truy vấn dù có nhiều nhân viên");
  assert.equal(map.get(1).length, 1);
  assert.equal(map.get(2).length, 0, "ngoại lệ nghỉ thắng lịch tuần");
  assert.equal(map.get(3).length, 0, "không có lịch nào = không làm");
  assert.ok(!map.has(NaN));
});

test("buildSlots: bước chia khung giờ lấy từ tham số", () => {
  const sched = [{ start_time: "09:00", end_time: "11:00" }];
  assert.deepEqual(buildSlots(sched, [], 30, 0, 30), ["09:00", "09:30", "10:00", "10:30"]);
  assert.deepEqual(buildSlots(sched, [], 30, 0, 60), ["09:00", "10:00"]);
});
