import { test } from "node:test";
import assert from "node:assert/strict";
import { buildICS, fold } from "../ics.js";

test("ICS: cấu trúc hợp lệ, xuống dòng CRLF, ký tự đặc biệt được escape", () => {
  const ics = buildICS({ code: "HK20261023AB12CD34", service: "Cắt, gội; sấy", staff: "Lan", date: "2026-10-23", startTime: "09:00:00", endTime: "09:45:00", now: new Date("2026-10-22T00:00:00Z") });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.match(ics, /UID:HK20261023AB12CD34@henkheo/);
  assert.match(ics, /DTSTART:\d{8}T\d{6}Z/);
  assert.match(ics, /Cắt\\, gội\\; sấy/);
  assert.ok(!/[^\r]\n/.test(ics), "mọi xuống dòng đều là CRLF");
});

test("ICS: ngày giờ sai thì báo lỗi; dòng dài được gập ≤ 75 byte", () => {
  assert.throws(() => buildICS({ code: "X", service: "S", date: "không", startTime: "09:00", endTime: "10:00" }));
  const folded = fold("DESCRIPTION:" + "á".repeat(100));
  for (const l of folded.split("\r\n")) assert.ok(Buffer.byteLength(l) <= 75);
});
