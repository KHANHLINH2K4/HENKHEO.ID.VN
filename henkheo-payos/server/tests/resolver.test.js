import { test } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET ||= "test";
process.env.DB_CONNECT_TIMEOUT = "500";
const { getEffectiveScheduleRange, getEffectiveSchedules, isoWeekday, addDaysISO } = await import("../scheduleResolver.js");

/* Pool giả: trả dữ liệu theo bảng được truy vấn. */
function fakePool({ exceptions = [], templates = [], concrete = [] }) {
  return {
    request() {
      const r = {
        input() { return r; },
        async query(text) {
          if (text.includes("staff_schedule_exceptions")) return { recordset: exceptions };
          if (text.includes("staff_schedule_templates")) return { recordset: templates };
          if (text.includes("dbo.staff_schedules")) return { recordset: concrete };
          return { recordset: [] };
        },
      };
      return r;
    },
  };
}
const tpl = (dow, working = true, s = "08:00", e = "18:00") => ({ id: dow, day_of_week: dow, start_time: s, end_time: e, is_working: working, note: "" });

test("isoWeekday & addDaysISO không phụ thuộc múi giờ", () => {
  assert.equal(isoWeekday("2026-10-05"), 1); // thứ Hai
  assert.equal(isoWeekday("2026-10-04"), 7); // Chủ nhật
  assert.equal(addDaysISO("2026-12-31", 1), "2027-01-01");
});

test("Lịch tuần áp dụng cho mọi tuần, Chủ nhật nghỉ", async () => {
  const pool = fakePool({ templates: [1, 2, 3, 4, 5, 6].map((d) => tpl(d)).concat(tpl(7, false)) });
  const days = await getEffectiveScheduleRange(pool, 1, "2026-10-05", "2026-10-11");
  assert.equal(days.length, 7);
  assert.equal(days.filter((d) => d.is_working).length, 6);
  assert.equal(days[6].is_working, false);
});

test("Ngoại lệ ưu tiên hơn lịch tuần (nghỉ phép & đổi ca)", async () => {
  const pool = fakePool({
    templates: [1, 2, 3, 4, 5, 6].map((d) => tpl(d)),
    exceptions: [
      { id: 1, work_date: new Date("2026-10-06T00:00:00Z"), is_day_off: true, reason: "Nghỉ phép" },
      { id: 2, work_date: new Date("2026-10-07T00:00:00Z"), is_day_off: false, start_time: "10:00", end_time: "14:00", reason: "Ca ngắn" },
    ],
  });
  const days = await getEffectiveScheduleRange(pool, 1, "2026-10-05", "2026-10-08");
  assert.equal(days[1].is_working, false);
  assert.equal(days[1].source, "EXCEPTION");
  assert.deepEqual(days[2].shifts, [{ start_time: "10:00", end_time: "14:00" }]);
  assert.equal(days[3].source, "TEMPLATE");
});

test("Lịch cứng cũ KHÔNG còn đè lên lịch tuần (lỗi cũ)", async () => {
  const pool = fakePool({
    templates: [1, 2, 3, 4, 5, 6].map((d) => tpl(d)),
    concrete: [{ id: 9, work_date: new Date("2026-10-05T00:00:00Z"), start_time: "08:00", end_time: "12:00", is_available: true, note: "Ca sáng" }],
  });
  const [mon] = await getEffectiveScheduleRange(pool, 1, "2026-10-05", "2026-10-05");
  assert.deepEqual(mon.shifts, [{ start_time: "08:00", end_time: "18:00" }]);
  assert.equal(mon.source, "TEMPLATE");
});

test("Nhân viên chưa có lịch tuần thì dùng lịch cứng cũ (tương thích dữ liệu legacy)", async () => {
  const pool = fakePool({
    concrete: [{ id: 9, work_date: new Date("2026-10-05T00:00:00Z"), start_time: "08:00", end_time: "12:00", is_available: true, note: "" }],
  });
  const [d] = await getEffectiveScheduleRange(pool, 1, "2026-10-05", "2026-10-05");
  assert.equal(d.source, "CONCRETE");
  assert.equal(d.is_working, true);
});

test("getEffectiveSchedules giữ nguyên định dạng cũ cho đặt lịch", async () => {
  const pool = fakePool({ templates: [1, 2, 3, 4, 5, 6].map((d) => tpl(d)) });
  const rows = await getEffectiveSchedules(pool, 3, "2026-10-05");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].start_time, "08:00");
  assert.equal(rows[0].is_available, true);
  assert.deepEqual(await getEffectiveSchedules(pool, 3, "2026-10-04"), []); // Chủ nhật
});
