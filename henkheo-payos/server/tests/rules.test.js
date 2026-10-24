import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canTransition, checkStatusChange, decidePaymentOutcome, isRefundPending, makeAppointmentCode,
  hhmmToMinutes, minutesToHHMM, policyConfig,
} from "../policy.js";

const cfg = { ...policyConfig(), noShowAfterMinutes: 0 };
const at = (iso) => new Date(iso);

test("Chuyển trạng thái hợp lệ / không hợp lệ", () => {
  assert.equal(canTransition("PENDING", "CONFIRMED"), true);
  assert.equal(canTransition("PENDING", "COMPLETED"), false);
  assert.equal(canTransition("CONFIRMED", "NO_SHOW"), true);
  assert.equal(canTransition("COMPLETED", "CANCELLED"), false);
  assert.equal(canTransition("cancelled", "confirmed"), false);
});

test("Không hoàn thành / không đến trước giờ hẹn", () => {
  const base = { date: "2026-10-23", time: "10:00", paymentMethod: "ONLINE", paymentStatus: "PAID" };
  assert.match(checkStatusChange({ ...base, to: "COMPLETED" }, at("2026-10-23T09:00:00"), cfg), /Chưa đến giờ hẹn/);
  assert.match(checkStatusChange({ ...base, to: "NO_SHOW" }, at("2026-10-23T09:59:00"), cfg), /Chưa đến giờ hẹn/);
  assert.equal(checkStatusChange({ ...base, to: "COMPLETED" }, at("2026-10-23T10:30:00"), cfg), null);
  assert.equal(checkStatusChange({ ...base, to: "NO_SHOW" }, at("2026-10-23T10:01:00"), cfg), null);
});

test("NO_SHOW chờ thêm N phút sau giờ hẹn khi cấu hình", () => {
  const c = { ...cfg, noShowAfterMinutes: 15 };
  const base = { date: "2026-10-23", time: "10:00", to: "NO_SHOW" };
  assert.match(checkStatusChange(base, at("2026-10-23T10:10:00"), c), /ít nhất 15 phút/);
  assert.equal(checkStatusChange(base, at("2026-10-23T10:15:00"), c), null);
});

test("Lịch thu tiền tại cơ sở phải ghi nhận đã thu trước khi hoàn thành", () => {
  const base = { to: "COMPLETED", date: "2026-10-23", time: "10:00", paymentMethod: "AT_STORE" };
  const now = at("2026-10-23T11:00:00");
  assert.match(checkStatusChange({ ...base, paymentStatus: "PENDING" }, now, cfg), /thu tiền/);
  assert.equal(checkStatusChange({ ...base, paymentStatus: "PAID" }, now, cfg), null);
  // Các trạng thái khác không bị ràng buộc bởi thời điểm/thanh toán
  assert.equal(checkStatusChange({ ...base, to: "CANCELLED", paymentStatus: "PENDING" }, at("2020-01-01T00:00:00"), cfg), null);
});

test("Quyết định xử lý khi nhận tiền từ cổng thanh toán", () => {
  const ok = { expectedAmount: 200000, receivedAmount: 200000, paymentStatus: "PENDING", appointmentStatus: "PENDING" };
  assert.equal(decidePaymentOutcome(ok), "PAID");
  assert.equal(decidePaymentOutcome({ ...ok, paymentStatus: "PAID" }), "ALREADY_PAID");
  assert.equal(decidePaymentOutcome({ ...ok, receivedAmount: 100000 }), "AMOUNT_MISMATCH");
  assert.equal(decidePaymentOutcome({ ...ok, appointmentStatus: "CANCELLED" }), "PAID_REFUND_NEEDED");
  // Thanh toán đã CANCELLED/EXPIRED nhưng tiền thực sự về đúng số: vẫn xác nhận lịch đang chờ
  assert.equal(decidePaymentOutcome({ ...ok, paymentStatus: "CANCELLED" }), "PAID");
  assert.equal(decidePaymentOutcome({ ...ok, paymentStatus: "EXPIRED" }), "PAID");
});

test("Cờ chờ hoàn tiền", () => {
  assert.equal(isRefundPending({ appointmentStatus: "CANCELLED", paymentStatus: "PAID" }), true);
  assert.equal(isRefundPending({ appointmentStatus: "CANCELLED", paymentStatus: "PAID", refundedAt: "2026-10-23" }), false);
  assert.equal(isRefundPending({ appointmentStatus: "CONFIRMED", paymentStatus: "PAID" }), false);
  assert.equal(isRefundPending({ appointmentStatus: "CANCELLED", paymentStatus: "FAILED", refundRequestedAt: "2026-10-23" }), true);
  assert.equal(isRefundPending({ appointmentStatus: "CANCELLED", paymentStatus: "FAILED" }), false);
});

test("Mã lịch ngẫu nhiên, đúng định dạng và vừa cột VARCHAR(30)", () => {
  const code = makeAppointmentCode("2026-10-23", "ab12cd34");
  assert.equal(code, "HK20261023AB12CD34");
  assert.ok(code.length <= 30);
});

test("Giờ mở/đóng cửa từ cấu hình", () => {
  assert.equal(hhmmToMinutes("08:30", 0), 510);
  assert.equal(hhmmToMinutes("abc", 480), 480);
  assert.equal(hhmmToMinutes("25:00", 480), 480);
  assert.equal(minutesToHHMM(1080), "18:00");
  const saved = { o: process.env.BUSINESS_OPEN_TIME, c: process.env.BUSINESS_CLOSE_TIME, s: process.env.SLOT_STEP_MINUTES };
  process.env.BUSINESS_OPEN_TIME = "07:00"; process.env.BUSINESS_CLOSE_TIME = "21:30"; process.env.SLOT_STEP_MINUTES = "15";
  const c = policyConfig();
  assert.equal(c.openMinutes, 420); assert.equal(c.closeMinutes, 1290); assert.equal(c.slotStepMinutes, 15);
  for (const [k, v] of [["BUSINESS_OPEN_TIME", saved.o], ["BUSINESS_CLOSE_TIME", saved.c], ["SLOT_STEP_MINUTES", saved.s]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
