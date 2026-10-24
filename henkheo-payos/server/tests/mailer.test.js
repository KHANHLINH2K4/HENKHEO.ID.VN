import { test } from "node:test";
import assert from "node:assert/strict";
import { sendMail, mailTemplates, setMailTransportForTest, isMailConfigured } from "../mailer.js";

test("Không cấu hình SMTP: sendMail trả false, không ném lỗi", async () => {
  setMailTransportForTest(null);
  delete process.env.SMTP_HOST;
  process.env.NODE_ENV = "production"; // không in log khi test
  assert.equal(isMailConfigured(), false);
  assert.equal(await sendMail({ to: "a@b.vn", subject: "x", text: "y" }), false);
});

test("Có transport: gửi đúng người nhận và tiêu đề có tên thương hiệu", async () => {
  const sent = [];
  setMailTransportForTest({ sendMail: async (m) => { sent.push(m); } });
  const tpl = mailTemplates.bookingCreated({ name: "An", code: "HK1", service: "Cắt tóc", date: "2026-10-22", time: "09:00", staff: "Lan", confirmed: true });
  assert.equal(await sendMail({ to: "an@x.vn", ...tpl }), true);
  assert.equal(sent[0].to, "an@x.vn");
  assert.match(sent[0].subject, /^\[.+\] Đã nhận lịch hẹn HK1$/);
  assert.match(sent[0].text, /22\/10\/2026/);
  assert.match(sent[0].text, /xác nhận/);
});

test("Transport lỗi: sendMail nuốt lỗi và trả false (không làm hỏng luồng đặt lịch)", async () => {
  process.env.MAIL_RETRY_DELAY_MS = "0";
  setMailTransportForTest({ sendMail: async () => { throw new Error("SMTP down"); } });
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(await sendMail({ to: "a@b.vn", subject: "s", text: "t" }), false); } finally { console.warn = warn; }
});

test("Email rỗng thì bỏ qua", async () => {
  setMailTransportForTest({ sendMail: async () => { throw new Error("không được gọi"); } });
  assert.equal(await sendMail({ to: "", subject: "s", text: "t" }), false);
});

test("Mẫu email đặt lại mật khẩu chứa link và thời hạn", () => {
  const t = mailTemplates.passwordReset({ name: "An", link: "https://x/?reset=abc", minutes: 30 });
  assert.match(t.text, /https:\/\/x\/\?reset=abc/);
  assert.match(t.text, /30 phút/);
});

test("Lỗi tạm thời: thử lại và gửi được ở lần sau", async () => {
  process.env.MAIL_RETRY_DELAY_MS = "0";
  process.env.MAIL_RETRIES = "2";
  let calls = 0;
  setMailTransportForTest({ sendMail: async () => { calls += 1; if (calls < 3) throw new Error("tạm thời"); } });
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(await sendMail({ to: "a@b.vn", subject: "s", text: "t" }), true); } finally { console.warn = warn; }
  assert.equal(calls, 3);
});
