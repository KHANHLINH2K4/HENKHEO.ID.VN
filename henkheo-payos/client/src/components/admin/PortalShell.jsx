import React, { useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, ChevronDown, ChevronLeft, ChevronRight, CornerDownLeft, ExternalLink, LogOut, Menu, Search, X } from "lucide-react";
import { NotificationBell } from "../Header.jsx";
import { Avatar, Modal, cx, norm, themeVars } from "./kit.jsx";
import "./admin.css";

function CommandPalette({ open, onClose, onPick, items: all }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const items = useMemo(() => { const s = norm(q.trim()); return s ? all.filter((i) => norm(`${i.label} ${i.group} ${i.description || ""}`).includes(s)) : all; }, [q, all]);
  useEffect(() => { if (open) { setQ(""); setSel(0); } }, [open]);
  useEffect(() => { setSel(0); }, [q]);
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter" && items[sel]) onPick(items[sel]);
  };
  return (
    <Modal open={open} onClose={onClose} top>
      <div style={{ margin: "-20px -22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--ad-line-2)" }}>
          <Search size={18} className="ad-muted" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Chuyển nhanh đến trang…" aria-label="Chuyển nhanh đến trang"
            style={{ flex: 1, border: 0, outline: 0, font: "inherit", fontSize: 15, background: "transparent" }} />
          <span className="ad-kbd">Esc</span>
        </div>
        <div className="ad-cmd-list">
          {items.map((it, i) => { const Icon = it.icon; return (
            <button key={it.id} type="button" className={cx("ad-cmd-item", i === sel && "is-sel")} onMouseEnter={() => setSel(i)} onClick={() => onPick(it)}>
              <div className="ad-icon-tile ad-tint ad-tone-violet" style={{ width: 34, height: 34, borderRadius: 10 }}><Icon size={16} /></div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600 }}>{it.label}</div><div className="ad-muted ad-truncate" style={{ fontSize: 12 }}>{it.group}</div></div>
              {i === sel && <CornerDownLeft size={15} className="ad-muted" />}
            </button>); })}
          {!items.length && <div className="ad-empty" style={{ padding: 28 }}>Không tìm thấy trang phù hợp.</div>}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Khung dùng chung cho Quản trị và Nhân viên: thanh bên, thanh trên, Ctrl+K, chuông thông báo, menu người dùng.
 * groups: [{ title, items: [{ id, label, icon, description, badge? }] }]
 */
export function PortalShell({
  groups, tab, onNavigate, counts = {}, brandSub = "QUẢN TRỊ", crumbRoot = "Quản trị", roleText = "Toàn quyền hệ thống",
  user, onLogout, onExit, exitLabel = "Trang khách", unreadCount = 0, onRefreshNotifications, onOpenNotification,
  headerExtra, children, miniKey = "henkheo_sidebar_mini", contentKey,
}) {
  const all = useMemo(() => groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title }))), [groups]);
  const active = all.find((i) => i.id === tab) || all[0];
  const [mini, setMini] = useState(() => { try { return localStorage.getItem(miniKey) === "1"; } catch { return false; } });
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((v) => !v); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { try { localStorage.setItem(miniKey, mini ? "1" : "0"); } catch { /* ignore */ } }, [mini, miniKey]);
  useEffect(() => {
    if (!menu) return;
    const off = (e) => { if (!menuRef.current?.contains(e.target)) setMenu(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [menu]);
  useEffect(() => {
    const prev = document.title;
    document.title = `${active.label} · Hẹn Khéo`;
    return () => { document.title = prev; };
  }, [active.label]);

  const go = (id) => { setDrawer(false); setPalette(false); onNavigate(id); window.scrollTo({ top: 0 }); };
  const paletteItems = useMemo(() => [...all, ...(onExit ? [{ id: "__site", label: "Xem trang khách hàng", group: "Liên kết", icon: ExternalLink, description: "Mở website đặt lịch" }] : [])], [all, onExit]);
  const name = user?.full_name || "Tài khoản";

  return (
    <div className="ad-scope ad-root" style={themeVars}>
      {drawer && <button type="button" aria-label="Đóng menu" className="ad-scrim" onClick={() => setDrawer(false)} style={{ border: 0 }} />}
      <aside className={cx("ad-sidebar", mini && "is-mini", drawer && "is-open")} aria-label="Điều hướng">
        <div className="ad-brand">
          <div className="ad-brand-mark"><CalendarCheck size={19} /></div>
          <div className="ad-brand-text"><div className="ad-brand-name">Hẹn Khéo</div><div className="ad-brand-sub">{brandSub}</div></div>
          {drawer && <button type="button" className="ad-iconbtn" style={{ marginLeft: "auto" }} onClick={() => setDrawer(false)} aria-label="Đóng"><X size={18} /></button>}
        </div>
        <nav className="ad-nav">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="ad-nav-title">{g.title}</div>
              {g.items.map((it) => {
                const Icon = it.icon; const n = it.badge ? counts[it.badge] : 0;
                return (
                  <button key={it.id} type="button" title={mini ? it.label : undefined} onClick={() => go(it.id)} className={cx("ad-nav-item", tab === it.id && "is-active")} aria-current={tab === it.id ? "page" : undefined}>
                    <Icon size={18} /><span className="ad-nav-label ad-truncate">{it.label}</span>
                    {n > 0 && <span className="ad-nav-badge ad-num" aria-label={`${n} mục cần xử lý`}>{n > 99 ? "99+" : n}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="ad-side-foot">
          <div className="ad-me">
            <Avatar name={name} tone="violet" />
            <div className="ad-me-text" style={{ minWidth: 0 }}>
              <div className="ad-truncate" style={{ fontWeight: 650, fontSize: 13 }}>{name}</div>
              <div className="ad-muted" style={{ fontSize: 11.5 }}>{roleText}</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="ad-main">
        <header className="ad-topbar">
          <button type="button" className="ad-iconbtn ad-menu-btn boxed" onClick={() => setDrawer(true)} aria-label="Mở menu"><Menu size={18} /></button>
          <button type="button" className="ad-iconbtn boxed ad-collapse-btn" onClick={() => setMini((v) => !v)} aria-label={mini ? "Mở rộng menu" : "Thu gọn menu"} title={mini ? "Mở rộng menu" : "Thu gọn menu"}>
            {mini ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          </button>
          <nav className="ad-crumbs ad-hide-sm" aria-label="Vị trí hiện tại"><span>{crumbRoot}</span><ChevronRight size={14} /><b className="ad-truncate">{active.label}</b></nav>
          <div className="ad-spacer" />
          <button type="button" className="ad-cmdk" onClick={() => setPalette(true)} aria-label="Tìm nhanh trang (Ctrl K)"><Search size={15} /><span>Chuyển nhanh đến…</span><span className="ad-kbd">Ctrl K</span></button>
          {onExit && <button type="button" className="ad-btn ad-btn-ghost sm ad-hide-sm" onClick={onExit}><ExternalLink size={14} />{exitLabel}</button>}
          <NotificationBell unreadCount={unreadCount} onRefresh={onRefreshNotifications} onOpenNotification={onOpenNotification} />
          <div style={{ position: "relative" }} ref={menuRef}>
            <button type="button" className="ad-profile-btn" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu}>
              <Avatar name={name} size="sm" tone="violet" />
              <span className="ad-hide-sm ad-truncate" style={{ fontWeight: 600, fontSize: 13, maxWidth: 120 }}>{name}</span>
              <ChevronDown size={14} className="ad-muted ad-hide-sm" />
            </button>
            {menu && (
              <div className="ad-menu" role="menu">
                <div style={{ padding: "8px 10px 10px" }}><div style={{ fontWeight: 650 }}>{name}</div><div className="ad-muted" style={{ fontSize: 12 }}>{user?.role_name || ""}</div></div>
                {onExit && <button role="menuitem" className="ad-menu-item" onClick={() => { setMenu(false); onExit(); }}><ExternalLink size={16} />Xem trang khách hàng</button>}
                {onLogout && <button role="menuitem" className="ad-menu-item danger" onClick={() => { setMenu(false); onLogout(); }}><LogOut size={16} />Đăng xuất</button>}
              </div>
            )}
          </div>
        </header>
        <main className="ad-content" key={contentKey || tab}>
          <div className="ad-page-head">
            <div><h1 className="ad-title">{active.label}</h1><p className="ad-subtitle">{active.description}</p></div>
            {headerExtra}
          </div>
          {children}
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} items={paletteItems} onPick={(it) => (it.id === "__site" ? onExit?.() : go(it.id))} />
    </div>
  );
}
