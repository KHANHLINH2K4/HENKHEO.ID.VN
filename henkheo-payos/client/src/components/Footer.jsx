import React from "react";
import {
  CalendarCheck, Phone, Mail, MapPin
} from "lucide-react";
import { displayFont, bodyFont } from "../lib/theme.js";

export function Footer() {
  return <footer className="mt-14 mx-3 sm:mx-6 mb-4"><div style={{ background: `linear-gradient(135deg, #2B1D6B, #181523)` }} className="max-w-6xl mx-auto rounded-[22px] px-5 sm:px-8 py-10 grid sm:grid-cols-3 gap-8"><div><div className="flex items-center gap-2 mb-3"><CalendarCheck size={16} color="#fff" /><span style={{ fontFamily: displayFont, color: "#fff" }} className="font-bold">Hẹn Khéo</span></div><p style={{ fontFamily: bodyFont, color: "rgba(255,255,255,.65)" }} className="text-sm">Hệ thống quản lý đặt lịch dịch vụ tích hợp Chatbot xử lý ngôn ngữ tự nhiên.</p></div><div style={{ fontFamily: bodyFont, color: "rgba(255,255,255,.72)" }} className="text-sm space-y-2"><div className="footer-link items-center gap-2"><MapPin size={14} /> Hà Nội</div><div className="footer-link items-center gap-2"><Phone size={14} /> 0396 267 558</div><div className="footer-link items-center gap-2"><Mail size={14} /> khanhlinhn481@gmail.com</div></div><div style={{ fontFamily: bodyFont, color: "rgba(255,255,255,.65)" }} className="text-sm"><div style={{ color: "#fff" }} className="font-semibold mb-2">Giờ làm việc</div><div>Hằng ngày: 08:00 – 18:00</div></div></div></footer>;
}
