import { test } from "node:test";
import assert from "node:assert/strict";
import {
  policyConfig, checkCustomerChange, isStorePendingExpired, shouldSendReminder,
  normalizeVNPhone, isValidEmail, rankStaffForAutoAssign, overlapsWithBuffer, hoursUntilStart,
} from "../policy.js";

const cfg = policyConfig({});
const at = (s) => new Date(s); // giờ địa phương
const now = at("2026-10-21T10:00:00");

test("Cấu hình mặc định hợp lý và đọc được từ env", () => {
  assert.equal(cfg.cancelMinHours, 2);
  assert.equal(cfg.maxActiveBookings, 3);
  assert.equal(policyConfig({ CANCEL_MIN_HOURS: "6", MAX_ACTIVE_BOOKINGS: "x" }).cancelMinHours, 6);
  assert.equal(policyConfig({ MAX_ACTIVE_BOOKINGS: "x" }).maxActiveBookings, 3); // giá trị rác -> mặc định
});

test("hoursUntilStart tính đúng", () => {
  assert.equal(hoursUntilStart("2026-10-21", "12:00", now), 2);
  assert.ok(hoursUntilStart("2026-10-21", "09:00", now) < 0);
});

test("Hủy: lịch CONFIRMED sát giờ (<2h) bị chặn, đủ 2h thì được", () => {
  const close = checkCustomerChange({ date: "2026-10-21", time: "11:30", status: "CONFIRMED" }, "cancel", now, cfg);
  assert.equal(close.ok, false);
  assert.match(close.message, /tối thiểu 2 giờ/);
  const ok = checkCustomerChange({ date: "2026-10-21", time: "12:00", status: "CONFIRMED" }, "cancel", now, cfg);
  assert.equal(ok.ok, true);
});

test("Hủy: lịch PENDING chưa trả tiền luôn được hủy, kể cả sát giờ", () => {
  assert.equal(checkCustomerChange({ date: "2026-10-21", time: "10:15", status: "PENDING", paid: false }, "cancel", now, cfg).ok, true);
});

test("Hủy: lịch PENDING nhưng ĐÃ trả tiền phải theo cửa sổ hủy", () => {
  assert.equal(checkCustomerChange({ date: "2026-10-21", time: "10:15", status: "PENDING", paid: true }, "cancel", now, cfg).ok, false);
});

test("Đổi lịch dùng ngưỡng riêng và lời nhắn 'đổi'", () => {
  const c = policyConfig({ RESCHEDULE_MIN_HOURS: "5" });
  const r = checkCustomerChange({ date: "2026-10-21", time: "13:00", status: "CONFIRMED" }, "reschedule", now, c);
  assert.equal(r.ok, false);
  assert.match(r.message, /đổi lịch trước giờ hẹn tối thiểu 5 giờ/);
});

test("Trạng thái đã kết thúc không được hủy/đổi", () => {
  for (const status of ["COMPLETED", "CANCELLED", "NO_SHOW"]) {
    assert.equal(checkCustomerChange({ date: "2026-11-01", time: "10:00", status }, "cancel", now, cfg).ok, false);
  }
});

test("Lịch tại cơ sở chờ xác nhận: hết hạn theo thời gian hoặc qua giờ hẹn", () => {
  assert.ok(isStorePendingExpired({ minutesSinceCreated: 721, date: "2026-10-30", time: "10:00" }, now, cfg));
  assert.ok(isStorePendingExpired({ minutesSinceCreated: 5, date: "2026-10-21", time: "09:00" }, now, cfg));
  assert.equal(isStorePendingExpired({ minutesSinceCreated: 60, date: "2026-10-22", time: "09:00" }, now, cfg), null);
});

test("Nhắc lịch: chỉ CONFIRMED, chưa nhắc, trong cửa sổ 24h và chưa qua giờ", () => {
  const base = { date: "2026-10-22", time: "09:00", status: "CONFIRMED", reminderSentAt: null };
  assert.equal(shouldSendReminder(base, now, cfg), true);
  assert.equal(shouldSendReminder({ ...base, date: "2026-10-23" }, now, cfg), false); // còn quá xa
  assert.equal(shouldSendReminder({ ...base, reminderSentAt: new Date() }, now, cfg), false);
  assert.equal(shouldSendReminder({ ...base, status: "PENDING" }, now, cfg), false);
  assert.equal(shouldSendReminder({ ...base, date: "2026-10-21", time: "09:00" }, now, cfg), false); // đã qua giờ
});

test("Chuẩn hóa SĐT Việt Nam", () => {
  assert.equal(normalizeVNPhone("0912345678"), "0912345678");
  assert.equal(normalizeVNPhone("+84 912 345 678"), "0912345678");
  assert.equal(normalizeVNPhone("84912345678"), "0912345678");
  assert.equal(normalizeVNPhone("0912.345.678"), "0912345678");
  assert.equal(normalizeVNPhone("0123456789"), null); // đầu số không tồn tại
  assert.equal(normalizeVNPhone("091234567"), null);  // thiếu số
  assert.equal(normalizeVNPhone("abc"), null);
});

test("Kiểm tra email", () => {
  assert.equal(isValidEmail("a@b.vn"), true);
  assert.equal(isValidEmail("a@b"), false);
  assert.equal(isValidEmail("a b@c.vn"), false);
});

test("Tự phân công: ít lịch nhất trước, hòa thì id nhỏ trước", () => {
  assert.deepEqual(rankStaffForAutoAssign([{ staffId: 3, load: 2 }, { staffId: 1, load: 2 }, { staffId: 2, load: 0 }]), [2, 1, 3]);
  assert.deepEqual(rankStaffForAutoAssign([]), []);
});

test("Chồng lấn giờ có tính thời gian đệm", () => {
  assert.equal(overlapsWithBuffer(600, 660, 660, 720, 0), false);  // liền kề, không đệm
  assert.equal(overlapsWithBuffer(600, 660, 660, 720, 10), true);  // đệm 10' -> đụng
  assert.equal(overlapsWithBuffer(600, 660, 670, 720, 10), false); // cách đúng 10'
  assert.equal(overlapsWithBuffer(600, 660, 630, 700, 0), true);
});
