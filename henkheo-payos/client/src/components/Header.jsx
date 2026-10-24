import React, { useEffect, useState } from "react";
import {
  CalendarCheck, LogIn, LogOut, UserRound, Menu, Bell
} from "lucide-react";
import { GradButton } from "./ui.jsx";
import { apiGet, apiSend } from "../lib/api.js";
import { C, displayFont, bodyFont, gradPrimary } from "../lib/theme.js";

export function Header({ view, setView, user, onLogout, unreadCount = 0, onRefreshNotifications, onOpenNotification }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = user?.role_name === "ADMIN";
  const isStaff = user?.role_name === "STAFF";
  const isCustomer = user?.role_name === "CUSTOMER";
  const nav = [
    { id: "home", label: "Trang chủ" },
    { id: "services", label: "Dịch vụ" },
    ...(isCustomer ? [{ id: "booking", label: "Đặt lịch" }, { id: "customer", label: "Lịch của tôi" }] : []),
    ...(isStaff ? [{ id: "staff", label: "Khu vực nhân viên" }] : []),
    ...(isAdmin ? [{ id: "admin", label: "Quản trị" }] : []),
  ];
  return (
    <header className="sticky top-0 z-40">
      <div className="glass-strong" style={{ borderWidth: "0 0 1px 0", borderRadius: 0 }}>
        <div className="max-w-6xl mx-auto min-h-16 flex items-center justify-between px-4 sm:px-8 py-2 gap-3">
          <button onClick={() => setView("home")} className="flex items-center gap-2.5 shrink-0 group">
            <div style={{ background: gradPrimary }} className="w-9 h-9 rounded-xl flex items-center justify-center transition-transform duration-300 group-hover:rotate-[-8deg] group-hover:scale-110"><CalendarCheck size={18} color="#fff" /></div>
            <span style={{ fontFamily: displayFont, color: C.ink }} className="text-lg font-bold tracking-tight">Hẹn Khéo</span>
          </button>

          <nav className="hidden lg:flex items-center gap-1">
            {nav.map((n) => <button key={n.id} onClick={() => setView(n.id)} style={{ fontFamily: bodyFont, color: view === n.id ? C.primaryDark : C.inkSoft, background: view === n.id ? "rgba(108,76,240,.09)" : "transparent" }} className="nav-link px-4 py-2 rounded-xl text-sm font-semibold">{n.label}</button>)}
          </nav>

          <div className="flex items-center gap-2">
            {user && <NotificationBell unreadCount={unreadCount} onRefresh={onRefreshNotifications} onOpenNotification={onOpenNotification} />}
            {user ? (
              <>
                <div className="hidden sm:flex items-center gap-2 pl-1 pr-3 py-1 rounded-full" style={{ border: `1px solid ${C.line}`, background: "#fff" }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(108,76,240,.10)" }}><UserRound size={15} color={C.primary} /></div>
                  <div style={{ fontFamily: bodyFont }} className="text-xs text-left leading-tight">
                    <div style={{ color: C.ink }} className="font-bold max-w-[130px] truncate">{user.full_name}</div>
                    <div style={{ color: C.inkSoft }}>{user.role_name}</div>
                  </div>
                </div>
                <button onClick={onLogout} className="p-2.5 rounded-xl transition-colors hover:bg-red-50" title="Đăng xuất" aria-label="Đăng xuất"><LogOut size={17} color={C.danger} /></button>
              </>
            ) : <GradButton onClick={() => setView("login")} className="!py-2.5"><LogIn size={15} /> Đăng nhập</GradButton>}
            <button className="lg:hidden p-2 rounded-xl hover:bg-black/5" onClick={() => setMenuOpen(v => !v)} aria-label="Mở menu"><Menu size={21} color={C.ink} /></button>
          </div>
        </div>
      </div>

      {menuOpen && <div className="lg:hidden glass-strong mx-3 mt-2 rounded-2xl p-2 flex flex-col gap-1">
        {nav.map((n) => <button key={n.id} onClick={() => { setView(n.id); setMenuOpen(false); }} style={{ fontFamily: bodyFont, color: view === n.id ? C.primaryDark : C.ink, background: view === n.id ? "rgba(108,76,240,.09)" : "transparent" }} className="text-left px-4 py-2.5 rounded-xl text-sm font-semibold">{n.label}</button>)}
        {!user && <button onClick={() => { setView("login"); setMenuOpen(false); }} style={{ fontFamily: bodyFont, color: C.primary }} className="text-left px-4 py-2.5 rounded-xl text-sm font-semibold">Đăng nhập / Đăng ký</button>}
      </div>}
    </header>
  );
}

export function NotificationBell({ unreadCount = 0, onRefresh, onOpenNotification }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const load = async () => {
    try { const rows = await apiGet("/notifications"); setItems(rows); } catch {}
  };
  useEffect(() => { if (open) load(); }, [open]);
  const openNotification = async (n) => {
    try { if (!n.is_read) await apiSend(`/notifications/${n.id}/read`, "PATCH", {}); } catch {}
    await load();
    onRefresh?.();
    setOpen(false);
    onOpenNotification?.(n);
  };
  const markAll = async () => { try { await apiSend("/notifications/read-all", "PATCH", {}); await load(); onRefresh?.(); } catch {} };
  return <div className="relative">
    <button onClick={() => setOpen(v => !v)} className="relative p-2.5 rounded-full transition-transform duration-200 hover:scale-110 hover:rotate-[-8deg]" title="Thông báo" aria-label="Thông báo" style={{ background: "rgba(108,76,240,.09)" }}>
      <Bell size={17} color={C.primary}/>{unreadCount>0&&<span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center" style={{background:C.danger,color:"white"}}>{unreadCount>9?"9+":unreadCount}</span>}
    </button>
    {open && <div className="absolute right-0 top-12 w-[min(92vw,360px)] glass-strong rounded-2xl shadow-2xl overflow-hidden z-50">
      <div className="px-4 py-3 flex items-center justify-between" style={{borderBottom:`1px solid ${C.line}`}}><div style={{fontFamily:displayFont}} className="font-bold text-sm">Thông báo</div><button onClick={markAll} style={{fontFamily:bodyFont,color:C.primary}} className="text-xs font-semibold">Đọc tất cả</button></div>
      <div className="max-h-80 overflow-y-auto">{items.length?items.map(n=><button key={n.id} onClick={()=>openNotification(n)} className="w-full text-left px-4 py-3 hover:bg-black/[.03] transition-colors" style={{background:n.is_read?"transparent":"rgba(108,76,240,.05)",borderBottom:`1px solid ${C.line}`}}><div className="flex items-start justify-between gap-2"><div style={{fontFamily:bodyFont}} className="text-xs font-bold">{n.title}</div>{!n.is_read&&<span className="mt-0.5 w-2 h-2 rounded-full shrink-0" style={{background:C.danger}}/>}</div><div style={{fontFamily:bodyFont,color:C.inkSoft}} className="text-xs mt-1 whitespace-pre-wrap">{n.message}</div><div style={{fontFamily:bodyFont,color:C.inkSoft}} className="text-[10px] mt-1">{new Date(n.created_at).toLocaleString("vi-VN")}</div><div style={{fontFamily:bodyFont,color:C.primary}} className="text-[10px] font-semibold mt-2">Nhấn để mở nơi xử lý →</div></button>):<div className="p-5 text-center text-xs" style={{fontFamily:bodyFont,color:C.inkSoft}}>Chưa có thông báo.</div>}</div>
    </div>}
  </div>;
}
