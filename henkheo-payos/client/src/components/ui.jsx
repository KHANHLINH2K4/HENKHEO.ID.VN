import React from "react";
import { CATEGORIES } from "../lib/categories.jsx";
import { C, bodyFont } from "../lib/theme.js";

export function Badge({ status }) {
  const map = {
    confirmed: ["Đã xác nhận", "rgba(18,183,106,.12)", C.success],
    pending: ["Chờ xác nhận", "rgba(255,184,76,.18)", "#A8680A"],
    cancelled: ["Đã huỷ", "rgba(229,72,77,.12)", C.danger],
    completed: ["Hoàn thành", "rgba(108,76,240,.10)", C.primary],
    no_show: ["Không đến", "rgba(24,21,35,.07)", C.inkSoft],
  };
  const [label, bg, fg] = map[String(status).toLowerCase()] || map.pending;
  return <span style={{ background: bg, color: fg, fontFamily: bodyFont }} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap"><span className="w-1.5 h-1.5 rounded-full" style={{ background: "currentColor" }} />{label}</span>;
}

export function GradButton({ children, onClick, disabled, variant = "primary", className = "", type = "button" }) {
  const cls = variant === "ghost" ? "gb-ghost" : variant === "warm" ? "gb-warm" : "gb-primary";
  return <button type={type} onClick={onClick} disabled={disabled} style={{ fontFamily: bodyFont }} className={`gb ${cls} disabled:opacity-60 ${className}`}>{children}</button>;
}

export function CategoryChip({ id, size = 40 }) {
  const item = CATEGORIES.find(c => c.id === id) || CATEGORIES[0];
  const Icon = item.icon;
  return <div style={{ width: size, height: size, background: `linear-gradient(135deg, ${item.color}, ${item.color}CC)` }} className="rounded-2xl flex items-center justify-center shrink-0 hl-icon"><Icon size={size * .48} color="#fff" /></div>;
}
