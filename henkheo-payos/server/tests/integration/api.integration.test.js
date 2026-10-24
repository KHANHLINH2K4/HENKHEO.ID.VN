/*
 * Test tích hợp: chạy trên server THẬT + SQL Server THẬT (đã `npm run db:migrate -- --seed`).
 *   RUN_INTEGRATION=1 ADMIN_USER=admin ADMIN_PASSWORD=... API_URL=http://localhost:5000 npm run test:integration
 * Không đặt RUN_INTEGRATION thì toàn bộ bị bỏ qua (để `npm test` luôn chạy được không cần CSDL).
 * Mỗi lần chạy tự tạo tài khoản khách mới (hậu tố ngẫu nhiên) nên chạy lại nhiều lần được.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";

const RUN = process.env.RUN_INTEGRATION === "1";
const API = `${process.env.API_URL || "http://localhost:5000"}/api`;
const opts = { skip: !RUN && "đặt RUN_INTEGRATION=1 để chạy" };

const call = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const rand = () => Math.random().toString(36).slice(2, 8);
const phone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const nextWeekday = () => { const d = new Date(); d.setDate(d.getDate() + 3); while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1); return d.toLocaleDateString("en-CA"); };

let admin; let customerA; let customerB; let svc; let date; let slot; let staffId;
const register = async () => {
  const username = `it_${rand()}`;
  const r = await call("/auth/register", { method: "POST", body: { username, password: "Test12345", fullName: `IT ${username}`, phone: phone() } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { token: r.data.token, username };
};

before(async () => {
  if (!RUN) return;
  const login = await call("/auth/login", { method: "POST", body: { username: process.env.ADMIN_USER || "admin", password: process.env.ADMIN_PASSWORD } });
  assert.equal(login.status, 200, "Đăng nhập admin thất bại — kiểm tra ADMIN_PASSWORD");
  admin = login.data.token;
  customerA = await register();
  customerB = await register();
  const services = (await call("/services")).data;
  date = nextWeekday();
  for (const s of services) { // tìm dịch vụ có khung giờ trống
    const o = await call(`/appointments/booking-options?serviceId=${s.id}&date=${date}`, { token: customerA.token });
    const st = o.data.staff?.find((x) => x.available);
    if (st) { svc = s; staffId = st.id; slot = st.slots[0]; break; }
  }
  assert.ok(svc, "Không tìm thấy dịch vụ/nhân viên còn trống để test");
});

test("Chưa đăng nhập: API lịch hẹn trả 401", opts, async () => {
  assert.equal((await call("/appointments")).status, 401);
});

test("Khách không truy cập được API quản trị (403)", opts, async () => {
  assert.equal((await call("/appointments", { token: customerA.token })).status, 403);
  assert.equal((await call("/time-off", { token: customerA.token })).status, 403);
});

test("Đăng ký trùng SĐT bị từ chối (409)", opts, async () => {
  const me = (await call("/customers/me", { token: customerA.token })).data;
  const r = await call("/auth/register", { method: "POST", body: { username: `it_${rand()}`, password: "Test12345", fullName: "Trùng SĐT", phone: me.phone } });
  assert.equal(r.status, 409);
});

test("Đua slot: hai khách đặt CÙNG khung giờ cùng lúc → đúng 1 thành công, 1 bị 409", opts, async () => {
  const body = { serviceId: svc.id, staffId, date, time: slot, paymentMethod: "AT_STORE" };
  const [a, b] = await Promise.all([
    call("/appointments", { method: "POST", token: customerA.token, body }),
    call("/appointments", { method: "POST", token: customerB.token, body }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409], JSON.stringify([a.data, b.data]));
  globalThis.__bookedBy = a.status === 201 ? { who: customerA, id: a.data.id } : { who: customerB, id: b.data.id };
});

test("Khách tự hủy lịch PENDING chưa trả tiền: được phép, giải phóng khung giờ", opts, async () => {
  const { who, id } = globalThis.__bookedBy;
  const r = await call(`/appointments/my/${id}/cancel`, { method: "POST", token: who.token, body: { reason: "test tích hợp" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const again = await call("/appointments", { method: "POST", token: customerA.token, body: { serviceId: svc.id, staffId, date, time: slot, paymentMethod: "AT_STORE" } });
  assert.equal(again.status, 201, "khung giờ phải đặt lại được sau khi hủy");
  await call(`/appointments/my/${again.data.id}/cancel`, { method: "POST", token: customerA.token, body: { reason: "dọn dẹp" } });
});

test("Giới hạn số lịch chờ: đặt quá 3 lịch bị 409", opts, async () => {
  const c = await register();
  const o = (await call(`/appointments/booking-options?serviceId=${svc.id}&date=${date}`, { token: c.token })).data;
  const slots = o.staff.find((x) => x.id === staffId).slots;
  const results = [];
  for (let i = 0; i < 4 && i * 2 < slots.length; i += 1) {
    results.push((await call("/appointments", { method: "POST", token: c.token, body: { serviceId: svc.id, staffId, date, time: slots[i * 2], paymentMethod: "AT_STORE" } })).status);
  }
  if (results.length === 4) assert.deepEqual(results, [201, 201, 201, 409]);
});

test("Admin tạo lịch hộ khách (walk-in): xác nhận ngay; staffId=ANY tự chọn nhân viên", opts, async () => {
  const o = (await call(`/appointments/manual/options?serviceId=${svc.id}&date=${date}`, { token: admin })).data;
  assert.ok(o.any?.slots?.length, "phải có khung giờ chung");
  const r = await call("/appointments/manual", { method: "POST", token: admin, body: { source: "WALK_IN", fullName: "Khách quầy IT", phone: phone(), serviceId: svc.id, staffId: "ANY", date, time: o.any.slots[o.any.slots.length - 1] } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.status, "confirmed");
  assert.equal(r.data.auto_assigned, true);
});

test("Khách không được gọi API tạo lịch hộ (403)", opts, async () => {
  const r = await call("/appointments/manual", { method: "POST", token: customerA.token, body: {} });
  assert.equal(r.status, 403);
});

test("Quên mật khẩu luôn trả cùng thông báo dù tài khoản có tồn tại hay không", opts, async () => {
  const a = await call("/auth/forgot-password", { method: "POST", body: { identifier: "khong_ton_tai_" + rand() } });
  const b = await call("/auth/forgot-password", { method: "POST", body: { identifier: customerA.username } });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(a.data.message, b.data.message);
});

test("Đặt lại mật khẩu với token sai bị từ chối", opts, async () => {
  const r = await call("/auth/reset-password", { method: "POST", body: { token: "a".repeat(64), newPassword: "Moi12345" } });
  assert.equal(r.status, 400);
});

test("Hoàn tiền bắt buộc có mã tham chiếu (400)", opts, async () => {
  const r = await call("/payments/999999/refund", { method: "PATCH", token: admin, body: {} });
  assert.equal(r.status, 400);
});

/* ===== Bổ sung V4.1 ===== */
test("Không đánh dấu hoàn thành lịch chưa đến giờ; khách không được chuyển lịch", opts, async () => {
  const c = await register();
  const o = (await call(`/appointments/booking-options?serviceId=${svc.id}&date=${date}`, { token: c.token })).data;
  const sl = o.staff.find((x) => x.id === staffId)?.slots?.[0];
  if (!sl) return;
  const made = await call("/appointments", { method: "POST", token: c.token, body: { serviceId: svc.id, staffId, date, time: sl, paymentMethod: "AT_STORE" } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.id;
  assert.equal((await call(`/appointments/${id}`, { method: "PATCH", token: admin, body: { status: "confirmed" } })).status, 200);
  const early = await call(`/appointments/${id}`, { method: "PATCH", token: admin, body: { status: "completed" } });
  assert.equal(early.status, 409, JSON.stringify(early.data));
  assert.equal((await call(`/appointments/${id}/reassign`, { method: "PATCH", token: c.token, body: { staffId } })).status, 403);
  assert.equal((await call(`/appointments/${id}/reassign`, { method: "PATCH", token: admin, body: {} })).status, 400);
  assert.equal((await call(`/appointments/${id}/reassign`, { method: "PATCH", token: admin, body: { staffId } })).status, 400, "không đổi gì thì 400");
  // Chủ lịch tải được .ics, người khác thì không
  const ics = await fetch(`${API}/appointments/${id}/ics`, { headers: { Authorization: `Bearer ${c.token}` } });
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get("content-type") || "", /text\/calendar/);
  assert.equal((await fetch(`${API}/appointments/${id}/ics`, { headers: { Authorization: `Bearer ${customerB.token}` } })).status, 404);
  // Khách còn lịch mở thì không xóa được tài khoản; sai mật khẩu thì 401
  assert.equal((await call("/customers/me/delete-account", { method: "POST", token: c.token, body: { password: "sai-mat-khau" } })).status, 401);
  assert.equal((await call("/customers/me/delete-account", { method: "POST", token: c.token, body: { password: "Test12345" } })).status, 409);
  await call(`/appointments/my/${id}/cancel`, { method: "POST", token: c.token, body: { reason: "dọn dẹp" } });
});

test("Báo cáo: chỉ ADMIN, kiểm tra khoảng ngày, xuất CSV", opts, async () => {
  assert.equal((await call("/reports/summary", { token: customerA.token })).status, 403);
  assert.equal((await call("/reports/summary?from=2026-10-31&to=2026-10-01", { token: admin })).status, 400);
  const ok = await call("/reports/summary", { token: admin });
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(ok.data.daily) && ok.data.totals);
  const csv = await fetch(`${API}/reports/export.csv`, { headers: { Authorization: `Bearer ${admin}` } });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type") || "", /text\/csv/);
});

test("Chat ẩn danh: không tiếp tục được hội thoại của người khác nếu thiếu token", opts, async () => {
  const first = await call("/chat", { method: "POST", body: { messages: [{ role: "user", text: "giờ làm việc" }] } });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.ok(first.data.conversationToken);
  const hijack = await call("/chat", { method: "POST", body: { conversationId: first.data.conversationId, messages: [{ role: "user", text: "giá dịch vụ" }] } });
  assert.notEqual(hijack.data.conversationId, first.data.conversationId, "thiếu token thì phải tạo hội thoại mới");
  const own = await call("/chat", { method: "POST", body: { conversationId: first.data.conversationId, conversationToken: first.data.conversationToken, messages: [{ role: "user", text: "giá dịch vụ" }] } });
  assert.equal(own.data.conversationId, first.data.conversationId);
});

test("Đăng nhập sai nhiều lần bị khóa tạm (429)", opts, async () => {
  const u = `khong_co_${rand()}`;
  let last = 0;
  for (let i = 0; i < 8; i += 1) last = (await call("/auth/login", { method: "POST", body: { username: u, password: "sai" } })).status;
  assert.ok([401, 429].includes(last));
  assert.equal(last, 429);
});
