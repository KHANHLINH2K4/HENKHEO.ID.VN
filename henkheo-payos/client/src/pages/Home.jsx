import React from "react";
import {
  Calendar, ChevronRight, ArrowRight, ShieldCheck
} from "lucide-react";
import { GradButton, CategoryChip } from "../components/ui.jsx";
import { formatVND, dmLabel, addDays, dowLabel } from "../lib/format.js";
import { C, displayFont, bodyFont } from "../lib/theme.js";

export function Home({ services, setView, setPreselectService }) {
  const popular = services.filter(s => s.popular).slice(0, 4);
  return <div className="fade-up">
    <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-14 pb-10 grid lg:grid-cols-[1.1fr,.9fr] items-center gap-10">
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-full mb-5" style={{ background: "rgba(108,76,240,.08)", color: C.primary, fontFamily: bodyFont }}><ShieldCheck size={14} /> Đặt lịch thông minh · chống trùng giờ</div>
        <h1 style={{ fontFamily: displayFont, color: C.ink }} className="text-4xl sm:text-6xl font-bold tracking-tight leading-[1.02]">Đặt lịch gọn hơn.<br /><span style={{ color: C.primary }}>Hẹn khéo hơn.</span></h1>
        <p style={{ fontFamily: bodyFont, color: C.inkSoft }} className="mt-5 max-w-xl text-base sm:text-lg leading-relaxed">Khách hàng chọn dịch vụ, nhân viên, ngày giờ; hệ thống tự kiểm tra lịch làm việc và phát hiện khung giờ bị trùng trước khi tạo lịch.</p>
        <div className="flex flex-wrap gap-3 mt-7"><GradButton onClick={() => setView("booking")}>Đặt lịch ngay <ArrowRight size={15} /></GradButton><GradButton variant="ghost" onClick={() => setView("services")}>Xem dịch vụ</GradButton></div>
      </div>
      <div className="glass rounded-[30px] p-6">
        <div className="flex items-center justify-between mb-5"><div><div style={{ fontFamily: displayFont, color: C.ink }} className="font-bold">Lịch hẹn 7 ngày</div><div style={{ fontFamily: bodyFont, color: C.inkSoft }} className="text-xs mt-1">Kiểm tra xung đột ngay trên server</div></div><Calendar size={20} color={C.primary} /></div>
        <div className="grid grid-cols-7 gap-2">{Array.from({ length: 7 }, (_, i) => addDays(i)).map(d => <div key={d}><div style={{ fontFamily: bodyFont, color: C.inkSoft }} className="text-[10px] text-center mb-2">{dowLabel(d)}</div><div style={{ background: "rgba(24,21,35,.04)" }} className="h-28 rounded-xl p-2"><div className="h-6 rounded-lg mb-2" style={{ background: `linear-gradient(135deg, ${C.primary}55, ${C.secondary}55)` }} /><div className="h-10 rounded-lg" style={{ background: `linear-gradient(135deg, ${C.accent}55, ${C.accentAlt}55)` }} /></div><div style={{ fontFamily: bodyFont, color: C.inkSoft }} className="text-[10px] text-center mt-1">{dmLabel(d)}</div></div>)}</div>
      </div>
    </section>

    <section className="max-w-6xl mx-auto px-5 sm:px-8 py-10">
      <div className="flex items-end justify-between mb-5"><div><h2 style={{ fontFamily: displayFont, color: C.ink }} className="text-2xl font-bold">Dịch vụ nổi bật</h2><p style={{ fontFamily: bodyFont, color: C.inkSoft }} className="text-sm mt-1">Một số dịch vụ đang được quan tâm.</p></div><button onClick={() => setView("services")} style={{ color: C.primary, fontFamily: bodyFont }} className="text-sm font-bold">Xem tất cả <ChevronRight size={16} className="inline" /></button></div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">{popular.map(s => <div key={s.id} className="glass hover-lift rounded-[24px] p-5">
        <div className="flex items-center justify-between mb-4"><CategoryChip id={s.category} size={42} /><span style={{ fontFamily: bodyFont, color: C.inkSoft }} className="text-xs">{s.duration} phút</span></div>
        <h3 style={{ fontFamily: displayFont, color: C.ink }} className="font-bold">{s.name}</h3><p style={{ fontFamily: bodyFont, color: C.inkSoft }} className="text-xs mt-2 min-h-10">{s.description}</p>
        <div className="flex items-center justify-between mt-4"><b style={{ fontFamily: displayFont, color: C.ink }}>{formatVND(s.price)}</b><button onClick={() => { setPreselectService(s.id); setView("booking"); }} style={{ color: C.primary, fontFamily: bodyFont }} className="text-xs font-bold">Đặt lịch →</button></div>
      </div>)}</div>
    </section>
  </div>;
}
