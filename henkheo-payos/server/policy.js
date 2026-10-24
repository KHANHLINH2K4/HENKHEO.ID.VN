/*
 * Quy tắc nghiệp vụ dạng HÀM THUẦN (không đụng CSDL) để dùng chung ở nhiều route và dễ kiểm thử.
 * Mọi ngưỡng đều cấu hình bằng .env (xem .env.example), có giá trị mặc định hợp lý.
 */

const num = (value, fallback, min = 0) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? n : fallback;
};

export function policyConfig(env = process.env) {
  return {
    // Khách chỉ được tự hủy / đổi lịch (đã xác nhận hoặc đã trả tiền) trước giờ hẹn tối thiểu N giờ.
    cancelMinHours: num(env.CANCEL_MIN_HOURS, 2),
    rescheduleMinHours: num(env.RESCHEDULE_MIN_HOURS, 2),
    // Số lịch sắp tới (PENDING/CONFIRMED) tối đa mỗi khách được giữ cùng lúc.
    maxActiveBookings: num(env.MAX_ACTIVE_BOOKINGS, 3, 1),
    // Khách "không đến" từ N lần trong M ngày gần nhất sẽ bị tạm khóa đặt online.
    noShowBlockCount: num(env.NO_SHOW_BLOCK_COUNT, 3, 1),
    noShowWindowDays: num(env.NO_SHOW_WINDOW_DAYS, 90, 1),
    // Lịch "thanh toán tại cơ sở" chưa được cơ sở xác nhận sau N phút sẽ tự hủy để nhả khung giờ.
    storePendingExpireMinutes: num(env.STORE_PENDING_EXPIRE_MINUTES, 720, 5),
    // Nhắc lịch trước giờ hẹn N giờ.
    reminderHours: num(env.REMINDER_HOURS_BEFORE, 24, 1),
    // Thời gian đệm (dọn dẹp/nghỉ) giữa hai lịch liên tiếp của cùng nhân viên.
    slotBufferMinutes: num(env.SLOT_BUFFER_MINUTES, 0),
    // Giờ mở/đóng cửa chung của cửa hàng (HH:MM) và bước chia khung giờ (phút).
    openMinutes: hhmmToMinutes(env.BUSINESS_OPEN_TIME, 8 * 60),
    closeMinutes: hhmmToMinutes(env.BUSINESS_CLOSE_TIME, 18 * 60),
    slotStepMinutes: num(env.SLOT_STEP_MINUTES, 30, 5),
    // Chỉ cho đánh dấu "không đến" sau giờ hẹn tối thiểu N phút.
    noShowAfterMinutes: num(env.NO_SHOW_AFTER_MINUTES, 0),
  };
}

/** "08:30" -> 510; sai định dạng thì dùng giá trị mặc định. */
export function hhmmToMinutes(value, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (!m) return fallback;
  const h = Number(m[1]); const min = Number(m[2]);
  return h <= 24 && min <= 59 ? h * 60 + min : fallback;
}

export const minutesToHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** "2026-10-21" + "14:30" -> Date theo giờ địa phương của server (TZ ứng dụng). */
export function startDateTime(date, time) {
  const t = String(time || "").slice(0, 5);
  return new Date(`${String(date).slice(0, 10)}T${t}:00`);
}

export function hoursUntilStart(date, time, now = new Date()) {
  return (startDateTime(date, time).getTime() - now.getTime()) / 3_600_000;
}

/**
 * Khách có được tự hủy / đổi lịch không?
 *  - Lịch PENDING và CHƯA thanh toán: luôn được (chưa phát sinh chi phí, nhả giờ cho người khác).
 *  - Lịch đã xác nhận hoặc đã trả tiền: phải trước giờ hẹn tối thiểu N giờ.
 * Trả về { ok, message, hoursLeft, minHours }.
 */
export function checkCustomerChange({ date, time, status, paid = false }, kind = "cancel", now = new Date(), cfg = policyConfig()) {
  const st = String(status || "").toUpperCase();
  if (!["PENDING", "CONFIRMED"].includes(st)) {
    return { ok: false, message: "Lịch này không còn ở trạng thái có thể thay đổi.", hoursLeft: null, minHours: 0 };
  }
  const minHours = kind === "reschedule" ? cfg.rescheduleMinHours : cfg.cancelMinHours;
  const hoursLeft = hoursUntilStart(date, time, now);
  if (st === "PENDING" && !paid) return { ok: true, message: "", hoursLeft, minHours };
  if (hoursLeft < minHours) {
    const verb = kind === "reschedule" ? "đổi" : "hủy";
    return {
      ok: false,
      hoursLeft,
      minHours,
      message: `Chỉ được tự ${verb} lịch trước giờ hẹn tối thiểu ${minHours} giờ. Vui lòng liên hệ cửa hàng để được hỗ trợ.`,
    };
  }
  return { ok: true, message: "", hoursLeft, minHours };
}

/** Lịch "tại cơ sở" đang PENDING có nên tự hủy không (quá hạn chờ xác nhận, hoặc giờ hẹn đã trôi qua)? */
export function isStorePendingExpired({ minutesSinceCreated, date, time }, now = new Date(), cfg = policyConfig()) {
  if (Number(minutesSinceCreated) >= cfg.storePendingExpireMinutes) return "Quá thời hạn chờ cơ sở xác nhận.";
  if (startDateTime(date, time).getTime() <= now.getTime()) return "Giờ hẹn đã qua mà lịch chưa được xác nhận.";
  return null;
}

/** Có cần gửi nhắc lịch bây giờ không? (đã xác nhận, chưa nhắc, còn trong cửa sổ N giờ và chưa quá giờ) */
export function shouldSendReminder({ date, time, status, reminderSentAt }, now = new Date(), cfg = policyConfig()) {
  if (String(status).toUpperCase() !== "CONFIRMED" || reminderSentAt) return false;
  const h = hoursUntilStart(date, time, now);
  return h > 0 && h <= cfg.reminderHours;
}

/** Chuẩn hóa SĐT Việt Nam về dạng 0xxxxxxxxx; trả null nếu không phải số di động hợp lệ. */
export function normalizeVNPhone(raw) {
  let v = String(raw ?? "").replace(/[\s.\-()]/g, "");
  if (v.startsWith("+84")) v = `0${v.slice(3)}`;
  else if (v.startsWith("84") && v.length === 11) v = `0${v.slice(2)}`;
  return /^0(3[2-9]|5[25689]|7[06-9]|8[1-9]|9\d)\d{7}$/.test(v) ? v : null;
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || "").trim()) && String(email).length <= 150;
}

/** Chọn nhân viên cho chế độ "Bất kỳ nhân viên": ít lịch nhất trong ngày trước, hòa thì id nhỏ trước. */
export function rankStaffForAutoAssign(candidates) {
  return [...candidates].sort((a, b) => (a.load - b.load) || (a.staffId - b.staffId)).map((c) => c.staffId);
}

/** Hai khoảng [start,end) có chồng lấn không, tính cả thời gian đệm? (đơn vị phút) */
export function overlapsWithBuffer(start, end, otherStart, otherEnd, buffer = 0) {
  return start < otherEnd + buffer && otherStart - buffer < end;
}

/* ---------- Chuyển trạng thái lịch hẹn (Admin/Staff) ---------- */
export const APPOINTMENT_TRANSITIONS = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "CANCELLED", "NO_SHOW"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function canTransition(from, to) {
  return (APPOINTMENT_TRANSITIONS[String(from).toUpperCase()] || []).includes(String(to).toUpperCase());
}

/**
 * Kiểm tra thời điểm + thanh toán khi đổi trạng thái:
 *  - COMPLETED / NO_SHOW: không được đánh dấu trước giờ hẹn (NO_SHOW còn cần quá giờ hẹn thêm noShowAfterMinutes).
 *  - COMPLETED: lịch thanh toán tại cơ sở phải được ghi nhận đã thu tiền.
 * Trả về chuỗi lỗi hoặc null.
 */
export function checkStatusChange({ to, date, time, paymentMethod, paymentStatus }, now = new Date(), cfg = policyConfig()) {
  const target = String(to).toUpperCase();
  if (target !== "COMPLETED" && target !== "NO_SHOW") return null;
  const start = startDateTime(date, time).getTime();
  if (target === "COMPLETED" && now.getTime() < start) return "Chưa đến giờ hẹn nên chưa thể đánh dấu hoàn thành.";
  if (target === "NO_SHOW" && now.getTime() < start + cfg.noShowAfterMinutes * 60_000) {
    return cfg.noShowAfterMinutes > 0
      ? `Chỉ được đánh dấu "không đến" sau giờ hẹn ít nhất ${cfg.noShowAfterMinutes} phút.`
      : "Chưa đến giờ hẹn nên chưa thể đánh dấu không đến.";
  }
  if (target === "COMPLETED" && String(paymentMethod || "").toUpperCase() === "AT_STORE" && String(paymentStatus || "").toUpperCase() !== "PAID") {
    return "Hãy ghi nhận thu tiền tại cơ sở trước khi đánh dấu hoàn thành.";
  }
  return null;
}

/* ---------- Thanh toán ---------- */
/**
 * Quyết định xử lý khi nhận tiền từ cổng thanh toán.
 *  - ALREADY_PAID  : webhook trùng, bỏ qua
 *  - AMOUNT_MISMATCH: số tiền khác số phải thu -> từ chối, ghi nhận tiền đã nhận để hoàn lại
 *  - PAID_REFUND_NEEDED: đúng tiền nhưng lịch đã bị hủy -> ghi PAID + đánh dấu cần hoàn tiền
 *  - PAID          : thanh toán hợp lệ
 */
export function decidePaymentOutcome({ expectedAmount, receivedAmount, paymentStatus, appointmentStatus }) {
  if (String(paymentStatus).toUpperCase() === "PAID") return "ALREADY_PAID";
  if (Number(expectedAmount) !== Number(receivedAmount)) return "AMOUNT_MISMATCH";
  if (String(appointmentStatus).toUpperCase() === "CANCELLED") return "PAID_REFUND_NEEDED";
  return "PAID";
}

/** Khoản thanh toán có đang \"chờ hoàn tiền\" không? */
export function isRefundPending({ appointmentStatus, paymentStatus, refundedAt, refundRequestedAt }) {
  if (String(appointmentStatus).toUpperCase() !== "CANCELLED" || refundedAt) return false;
  const ps = String(paymentStatus).toUpperCase();
  return ps === "PAID" || (ps === "FAILED" && !!refundRequestedAt);
}

/* ---------- Mã định danh ---------- */
/** Mã lịch dạng HK20261021ABCD1234 (≤ 30 ký tự, ngẫu nhiên nên không đoán/trùng). */
export function makeAppointmentCode(dateISO, randomHex) {
  return `HK${String(dateISO).slice(0, 10).replaceAll("-", "")}${String(randomHex).toUpperCase()}`;
}
