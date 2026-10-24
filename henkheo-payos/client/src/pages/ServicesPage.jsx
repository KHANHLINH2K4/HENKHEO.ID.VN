import React, { useState } from "react";
import { GradButton, CategoryChip } from "../components/ui.jsx";
import { CATEGORIES } from "../lib/categories.jsx";
import { formatVND } from "../lib/format.js";
import { C, displayFont, bodyFont, gradPrimary } from "../lib/theme.js";

export function ServicesPage({ services, setView, setPreselectService }) {
  const [cat, setCat] = useState("all");
  const filtered = cat === "all" ? services : services.filter(s => s.category === cat);
  return <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 fade-up">
    <h1 style={{ fontFamily: displayFont, color: C.ink }} className="text-4xl font-bold mb-2">Danh mục dịch vụ</h1><p style={{ fontFamily: bodyFont, color: C.inkSoft }} className="mb-8">Tra cứu giá, thời lượng và mô tả trước khi đặt.</p>
    <div className="flex flex-wrap gap-2 mb-8"><button onClick={() => setCat("all")} style={{ background: cat === "all" ? gradPrimary : "#fff", color: cat === "all" ? "#fff" : C.ink, fontFamily: bodyFont }} className="chip-btn px-4 py-2 rounded-full text-sm font-semibold">Tất cả</button>{CATEGORIES.map(c => <button key={c.id} onClick={() => setCat(c.id)} style={{ background: cat === c.id ? `linear-gradient(135deg, ${c.color}, ${c.color}CC)` : "#fff", color: cat === c.id ? "#fff" : C.ink, fontFamily: bodyFont }} className="chip-btn px-4 py-2 rounded-full text-sm font-semibold">{c.label}</button>)}</div>
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">{filtered.map(s => <div key={s.id} className="glass hover-lift rounded-[26px] p-6 flex flex-col">
      <div className="flex items-center justify-between mb-4"><CategoryChip id={s.category} /><span style={{ fontFamily: bodyFont, color: C.inkSoft }} className="text-xs px-2.5 py-1 rounded-full">{s.duration} phút</span></div>
      <h3 style={{ fontFamily: displayFont, color: C.ink }} className="text-lg font-bold">{s.name}</h3><p style={{ fontFamily: bodyFont, color: C.inkSoft }} className="text-sm mt-2 flex-1">{s.description || ""}</p>
      <div className="flex items-center justify-between mt-5"><span style={{ fontFamily: displayFont, color: C.ink }} className="font-bold">{formatVND(s.price)}</span><GradButton variant="warm" onClick={() => { setPreselectService(s.id); setView("booking"); }} className="!py-2 !px-4 text-xs">Đặt lịch</GradButton></div>
    </div>)}</div>
  </div>;
}
