/*
 * Tạo file lịch .ics (iCalendar, RFC 5545) để khách thêm lịch hẹn vào Google/Apple/Outlook Calendar.
 * Dùng giờ UTC (hậu tố Z) nên hiển thị đúng ở mọi múi giờ.
 */
const esc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

/** Gập dòng ≤ 75 byte theo chuẩn (dòng tiếp theo bắt đầu bằng một khoảng trắng). */
export function fold(line) {
  const out = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildICS({ code, service, staff, date, startTime, endTime, location = "", brand = "Hẹn Khéo", now = new Date() }) {
  const start = new Date(`${date}T${String(startTime).slice(0, 5)}:00`);
  const end = new Date(`${date}T${String(endTime).slice(0, 5)}:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("Ngày/giờ không hợp lệ");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${brand}//Booking//VI`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${code}@henkheo`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(`${service} – ${brand}`)}`,
    `DESCRIPTION:${esc(`Mã lịch ${code}${staff ? `\nNhân viên: ${staff}` : ""}`)}`,
    ...(location ? [`LOCATION:${esc(location)}`] : []),
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(`Sắp đến lịch hẹn ${service}`)}`,
    "TRIGGER:-PT60M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
