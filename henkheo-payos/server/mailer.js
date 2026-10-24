/*
 * Gửi email giao dịch (xác nhận đặt lịch, nhắc lịch, quên mật khẩu...).
 *  - Bật khi có SMTP_HOST (+ SMTP_USER/SMTP_PASS nếu máy chủ yêu cầu đăng nhập).
 *  - Chưa cấu hình SMTP: KHÔNG lỗi, chỉ ghi log (dev in nội dung ra console) -> luồng nghiệp vụ không bị chặn.
 *  - Gửi lỗi (mạng/SMTP) được thử lại vài lần; vẫn lỗi thì chỉ ghi log, không ném lỗi ra ngoài.
 */
import nodemailer from "nodemailer";

let transporter = null;
let overrideTransport = null; // dùng cho test

export function isMailConfigured() {
  return Boolean(overrideTransport || process.env.SMTP_HOST);
}

export function setMailTransportForTest(t) {
  overrideTransport = t;
  transporter = null;
}

function getTransporter() {
  if (overrideTransport) return overrideTransport;
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT) || 587;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: String(process.env.SMTP_SECURE || (port === 465)).toLowerCase() === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" } : undefined,
  });
  return transporter;
}

const brand = () => process.env.BRAND_NAME || "Hẹn Khéo";

/** Gửi 1 email. Trả về true nếu đã gửi, false nếu bỏ qua/lỗi. Không bao giờ ném lỗi. */
export async function sendMail({ to, subject, text }) {
  const address = String(to || "").trim();
  if (!address) return false;
  if (!isMailConfigured()) {
    if (process.env.NODE_ENV !== "production") console.log(`✉️  [mail chưa cấu hình] → ${address} | ${subject}\n${text}\n`);
    return false;
  }
  // Thử lại khi lỗi tạm thời (mạng/SMTP bận): tối đa MAIL_RETRIES lần, chờ tăng dần (MAIL_RETRY_DELAY_MS × 2^lần).
  const attempts = 1 + Math.max(0, Number(process.env.MAIL_RETRIES ?? 2));
  const baseDelay = Math.max(0, Number(process.env.MAIL_RETRY_DELAY_MS ?? 1000));
  for (let i = 0; i < attempts; i += 1) {
    try {
      await getTransporter().sendMail({
        from: process.env.MAIL_FROM || `${brand()} <no-reply@henkheo.local>`,
        to: address,
        subject: `[${brand()}] ${subject}`,
        text,
      });
      return true;
    } catch (error) {
      console.warn(`Gửi email thất bại (lần ${i + 1}/${attempts}):`, error?.message || error);
      if (i < attempts - 1 && baseDelay > 0) await new Promise((r) => setTimeout(r, baseDelay * 2 ** i));
    }
  }
  return false;
}

const fmtDate = (d) => String(d).slice(0, 10).split("-").reverse().join("/");

export const mailTemplates = {
  bookingCreated: ({ name, code, service, date, time, staff, confirmed }) => ({
    subject: `Đã nhận lịch hẹn ${code}`,
    text: `Chào ${name},\n\nLịch hẹn của bạn đã được ghi nhận${confirmed ? " và xác nhận" : " và đang chờ xác nhận"}.\n\n• Mã lịch: ${code}\n• Dịch vụ: ${service}\n• Thời gian: ${time} ngày ${fmtDate(date)}\n• Nhân viên: ${staff}\n\nBạn có thể xem, đổi hoặc hủy lịch trong mục "Lịch của tôi".\n\n${brand()}`,
  }),
  statusChanged: ({ name, code, statusText }) => ({
    subject: `Lịch hẹn ${code} ${statusText}`,
    text: `Chào ${name},\n\nLịch hẹn ${code} ${statusText}.\n\nNếu cần hỗ trợ, vui lòng liên hệ cửa hàng.\n\n${brand()}`,
  }),
  reminder: ({ name, code, service, date, time, staff }) => ({
    subject: `Nhắc lịch hẹn ${code}`,
    text: `Chào ${name},\n\nBạn có lịch hẹn sắp tới:\n\n• Dịch vụ: ${service}\n• Thời gian: ${time} ngày ${fmtDate(date)}\n• Nhân viên: ${staff}\n\nVui lòng đến đúng giờ. Nếu cần đổi hoặc hủy, hãy thực hiện trong mục "Lịch của tôi".\n\n${brand()}`,
  }),
  passwordReset: ({ name, link, minutes }) => ({
    subject: "Đặt lại mật khẩu",
    text: `Chào ${name},\n\nBạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu.\nBấm vào liên kết dưới đây trong vòng ${minutes} phút để đặt mật khẩu mới:\n\n${link}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu hiện tại vẫn an toàn.\n\n${brand()}`,
  }),
};
