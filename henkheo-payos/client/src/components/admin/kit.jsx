import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, Info, Loader2, Search, X, Inbox,
} from "lucide-react";
import { C } from "../../lib/theme.js";

/* Biến màu admin lấy từ theme.js: đổi bảng màu chỉ cần sửa 1 chỗ */
export const themeVars = {
  "--ad-primary": C.primary, "--ad-primary-dark": C.primaryDark, "--ad-secondary": C.secondary, "--ad-accent": C.accent,
  "--ad-amber": C.accentAlt, "--ad-success": C.success, "--ad-danger": C.danger, "--ad-ink": C.ink, "--ad-ink-2": C.inkSoft,
};

/* ---------- helpers ---------- */
export const cx = (...a) => a.filter(Boolean).join(" ");
const AVATAR_TONES = ["violet", "teal", "coral", "amber", "green"];
export const initials = (name = "") => {
  const p = String(name).trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
};
export const toneFor = (seed = "") => AVATAR_TONES[[...String(seed)].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_TONES.length];
export const fmtCompact = (v) => {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")} tỷ`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")} tr`;
  if (Math.abs(n) >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
};
/* Bỏ dấu để tìm kiếm tiếng Việt: "nguyen" khớp "Nguyễn" */
export const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/* ---------- basic blocks ---------- */
export function Card({ title, subtitle, action, children, flush, className = "", tone, onClick, style }) {
  const interactive = !!onClick;
  const Tag = interactive ? "button" : "div";
  return (
    <Tag type={interactive ? "button" : undefined} onClick={onClick} style={style}
      className={cx("ad-card", interactive && "is-interactive", tone && `ad-tone-${tone}`, className)}>
      {(title || action) && (
        <div className="ad-card-head">
          <div style={{ minWidth: 0 }}>
            {title && <h3 className="ad-card-title">{title}</h3>}
            {subtitle && <p className="ad-card-sub">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={cx("ad-card-body", flush && "flush")}>{children}</div>
    </Tag>
  );
}

export function StatCard({ label, value, hint, icon: Icon, tone = "violet", loading, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick}
      className={cx("ad-card ad-kpi", `ad-tone-${tone}`, onClick && "is-interactive")}>
      <div style={{ minWidth: 0 }}>
        <div className="ad-kpi-label">{label}</div>
        {loading ? <div className="ad-skel" style={{ height: 30, width: 110, marginTop: 8 }} />
          : <div className="ad-kpi-value ad-num ad-truncate">{value}</div>}
        {hint && (loading ? <div className="ad-skel" style={{ height: 14, width: 150, marginTop: 10 }} /> : <div className="ad-kpi-hint">{hint}</div>)}
      </div>
      {Icon && <div className="ad-icon-tile ad-tint"><Icon size={20} /></div>}
    </Tag>
  );
}

export function Button({ variant = "primary", size, icon: Icon, loading, children, className = "", tone, ...rest }) {
  return (
    <button type="button" {...rest} disabled={rest.disabled || loading}
      className={cx("ad-btn", `ad-btn-${variant}`, size === "sm" && "sm", tone && `ad-tone-${tone}`, className)}>
      {loading ? <Loader2 size={15} className="ad-spin" /> : Icon ? <Icon size={size === "sm" ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, tone, boxed, className = "", ...rest }) {
  return (
    <button type="button" title={label} aria-label={label} {...rest}
      className={cx("ad-iconbtn", boxed && "boxed", tone && `ad-tone-${tone}`, className)}>
      <Icon size={16} />
    </button>
  );
}

export function Pill({ tone = "gray", dot, children }) {
  return <span className={cx("ad-pill", `ad-tone-${tone}`, dot && "dot")}>{children}</span>;
}

const STATUS = {
  confirmed: ["Đã xác nhận", "green"], pending: ["Chờ xác nhận", "amber"], cancelled: ["Đã huỷ", "red"],
  completed: ["Hoàn thành", "violet"], no_show: ["Không đến", "gray"],
};
export const STATUS_LABEL = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v[0]]));
export function StatusPill({ status }) {
  const [label, tone] = STATUS[String(status).toLowerCase()] || STATUS.pending;
  return <Pill tone={tone} dot>{label}</Pill>;
}

export function Avatar({ name, size, tone }) {
  return <div className={cx("ad-avatar ad-tint", size === "sm" && "sm", `ad-tone-${tone || toneFor(name)}`)}>{initials(name)}</div>;
}

export function Alert({ tone = "red", children, onClose }) {
  const Icon = tone === "green" ? CheckCircle2 : tone === "red" ? AlertCircle : Info;
  return (
    <div role={tone === "red" ? "alert" : "status"} className={cx("ad-alert", `ad-tone-${tone}`)}>
      <Icon size={17} style={{ marginTop: 1, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>{children}</div>
      {onClose && <button type="button" onClick={onClose} aria-label="Đóng" style={{ border: 0, background: "none", color: "inherit", padding: 0 }}><X size={15} /></button>}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, children, action }) {
  return (
    <div className="ad-empty">
      <div className="ad-icon-tile ad-tint ad-tone-gray"><Icon size={22} /></div>
      <b>{title}</b>
      {children && <span style={{ maxWidth: 360 }}>{children}</span>}
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  );
}

export const Skeleton = ({ h = 16, w = "100%", style }) => <div className="ad-skel" style={{ height: h, width: w, ...style }} />;

/* ---------- form ---------- */
export function Field({ label, required, hint, full, children }) {
  return (
    <div className={full ? "full" : undefined}>
      {label && <label className="ad-label">{label}{required && <i>*</i>}</label>}
      {children}
      {hint && <div className="ad-hint">{hint}</div>}
    </div>
  );
}
export const Input = React.forwardRef((p, ref) => <input ref={ref} {...p} className={cx("ad-input", p.className)} />);
Input.displayName = "Input";
export const Select = (p) => <select {...p} className={cx("ad-select", p.className)} />;
export const Textarea = (p) => <textarea {...p} className={cx("ad-textarea", p.className)} />;

export function SearchInput({ value, onChange, placeholder = "Tìm kiếm…" }) {
  return (
    <div className="ad-search">
      <Search size={16} />
      <input className="ad-input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && <IconButton icon={X} label="Xoá tìm kiếm" className="ad-search-clear" style={{ width: 26, height: 26 }} onClick={() => onChange("")} />}
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }) {
  return <button type="button" role="switch" aria-checked={!!checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className="ad-switch" />;
}

export function Tabs({ value, onChange, items }) {
  return (
    <div className="ad-tabs" role="tablist">
      {items.map((it) => (
        <button key={it.id} role="tab" aria-selected={value === it.id} type="button" onClick={() => onChange(it.id)} className={cx("ad-tab", value === it.id && "is-active")}>
          {it.label}{it.count !== undefined && <span className="ad-tab-count ad-num">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- DataTable: sắp xếp + phân trang phía client ---------- */
export function DataTable({ columns, rows, rowKey = "id", loading, empty, pageSize = 10, pageSizes = [10, 20, 50], initialSort, onRowClick, noun = "dòng" }) {
  const [sort, setSort] = useState(initialSort || null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const val = col?.sortValue || ((r) => r[sort.key]);
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "vi");
      return sort.dir === "asc" ? c : -c;
    });
  }, [rows, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / size));
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const cur = Math.min(page, pages);
  const slice = sorted.slice((cur - 1) * size, cur * size);

  const toggleSort = (c) => {
    if (!c.sortable) return;
    setSort((s) => (s?.key === c.key ? (s.dir === "asc" ? { key: c.key, dir: "desc" } : null) : { key: c.key, dir: "asc" }));
  };

  const windowPages = useMemo(() => {
    const out = []; const from = Math.max(1, cur - 2); const to = Math.min(pages, from + 4);
    for (let i = Math.max(1, to - 4); i <= to; i++) out.push(i);
    return out;
  }, [cur, pages]);

  return (
    <>
      <div className="ad-table-wrap">
        <table className="ad-table">
          <thead>
            <tr>
              {columns.map((c) => {
                const Icon = sort?.key === c.key ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <th key={c.key} style={{ width: c.width }} className={cx(c.sortable && "sortable", sort?.key === c.key && "is-sorted", c.align === "right" && "t-right")}
                    onClick={() => toggleSort(c)} aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                    {c.header}{c.sortable && <span className="ad-sort"><Icon size={13} /></span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }, (_, i) => <tr key={i}>{columns.map((c) => <td key={c.key}><Skeleton h={14} w={c.key === columns[0].key ? "70%" : "55%"} /></td>)}</tr>)
              : slice.map((r) => (
                <tr key={r[rowKey]} className={onRowClick ? "is-clickable" : undefined} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                  {columns.map((c) => <td key={c.key} className={cx(c.align === "right" && "t-right", c.nowrap && "t-nowrap", c.className)}>{c.render ? c.render(r) : r[c.key] ?? "—"}</td>)}
                </tr>
              ))}
          </tbody>
        </table>
        {!loading && !sorted.length && (empty || <EmptyState title="Không có dữ liệu" />)}
      </div>
      {!loading && sorted.length > Math.min(...pageSizes) && (
        <div className="ad-pager">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="ad-num">{(cur - 1) * size + 1}–{Math.min(cur * size, sorted.length)} / {sorted.length} {noun}</span>
            <select className="ad-select" aria-label="Số dòng mỗi trang" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1); }} style={{ height: 30, width: 92, fontSize: 12.5 }}>
              {pageSizes.map((n) => <option key={n} value={n}>{n} / trang</option>)}
            </select>
          </div>
          <div className="ad-pages">
            <button className="ad-page-btn" disabled={cur === 1} onClick={() => setPage(1)} aria-label="Trang đầu"><ChevronsLeft size={15} /></button>
            <button className="ad-page-btn" disabled={cur === 1} onClick={() => setPage(cur - 1)} aria-label="Trang trước"><ChevronLeft size={15} /></button>
            {windowPages.map((n) => <button key={n} className={cx("ad-page-btn ad-num", n === cur && "is-active")} onClick={() => setPage(n)} aria-current={n === cur ? "page" : undefined}>{n}</button>)}
            <button className="ad-page-btn" disabled={cur === pages} onClick={() => setPage(cur + 1)} aria-label="Trang sau"><ChevronRight size={15} /></button>
            <button className="ad-page-btn" disabled={cur === pages} onClick={() => setPage(pages)} aria-label="Trang cuối"><ChevronsRight size={15} /></button>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Modal ---------- */
export function Modal({ open, onClose, title, subtitle, children, footer, wide, top, busy }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const opener = document.activeElement;
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) { e.stopPropagation(); onClose?.(); return; }
      // Giữ phím Tab xoay vòng trong hộp thoại (focus trap)
      if (e.key === "Tab" && ref.current) {
        const items = [...ref.current.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
        if (!items.length) { e.preventDefault(); return; }
        const first = items[0]; const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || !ref.current.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !ref.current.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => ref.current?.querySelector("input:not([disabled]),select,textarea,button.ad-btn-primary")?.focus(), 30);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); clearTimeout(t); try { opener?.focus?.(); } catch { /* phần tử đã bị gỡ */ } };
  }, [open, onClose, busy]);
  if (!open) return null;
  return (
    <div className={cx("ad-modal-wrap", top && "top")} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}>
      <div ref={ref} className={cx("ad-modal", wide && "wide")} role="dialog" aria-modal="true" aria-label={title}>
        {title && (
          <div className="ad-modal-head">
            <div><h3 style={{ fontSize: 16, fontWeight: 650 }}>{title}</h3>{subtitle && <p className="ad-card-sub">{subtitle}</p>}</div>
            <IconButton icon={X} label="Đóng" onClick={onClose} disabled={busy} />
          </div>
        )}
        <div className="ad-modal-body">{children}</div>
        {footer && <div className="ad-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- UI provider: toast + confirm + prompt (thay window.alert/confirm/prompt) ---------- */
const UICtx = createContext(null);
export const useUI = () => useContext(UICtx);
let toastSeq = 0;

export function AdminUIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dlg, setDlg] = useState(null);
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");

  const push = useCallback((type, message) => {
    const id = ++toastSeq;
    setToasts((t) => [...t.slice(-3), { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === "error" ? 6500 : 3800);
  }, []);
  const confirm = useCallback((o) => new Promise((resolve) => { setDlg({ kind: "confirm", ...o, resolve }); }), []);
  const prompt = useCallback((o) => new Promise((resolve) => { setVal(o.defaultValue || ""); setErr(""); setDlg({ kind: "prompt", ...o, resolve }); }), []);
  const api = useMemo(() => ({
    toast: { success: (m) => push("success", m), error: (m) => push("error", m), info: (m) => push("info", m) },
    confirm, prompt,
  }), [push, confirm, prompt]);

  const close = (result) => { dlg?.resolve(result); setDlg(null); };
  const submit = () => {
    if (dlg.kind === "confirm") return close(true);
    const v = val.trim();
    if (dlg.required !== false && !v) return setErr(dlg.requiredMessage || "Vui lòng nhập nội dung.");
    close(v);
  };
  const danger = dlg?.tone === "danger";

  return (
    <UICtx.Provider value={api}>
      {children}
      {/* Modal + toast render ngoài cây giao diện nên cần tự mang theo scope màu */}
      <div className="ad-scope" style={{ ...themeVars, display: "contents" }}>
      <Modal open={!!dlg} onClose={() => close(dlg?.kind === "confirm" ? false : null)} title={dlg?.title} top
        footer={dlg && <>
          <Button variant="ghost" onClick={() => close(dlg.kind === "confirm" ? false : null)}>{dlg.cancelText || "Huỷ"}</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={submit}>{dlg.confirmText || (dlg.kind === "confirm" ? "Xác nhận" : "Đồng ý")}</Button>
        </>}>
        {dlg?.message && <p style={{ color: "var(--ad-ink-2)", whiteSpace: "pre-line" }}>{dlg.message}</p>}
        {dlg?.kind === "prompt" && (
          <div style={{ marginTop: dlg.message ? 14 : 0 }}>
            {dlg.label && <label className="ad-label">{dlg.label}</label>}
            {dlg.multiline
              ? <Textarea value={val} onChange={(e) => { setVal(e.target.value); setErr(""); }} placeholder={dlg.placeholder} rows={3} />
              : <Input value={val} autoFocus placeholder={dlg.placeholder} onChange={(e) => { setVal(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && submit()} />}
            {err && <div className="ad-hint" style={{ color: "var(--ad-danger)" }}>{err}</div>}
          </div>
        )}
      </Modal>
      <div className="ad-toasts" aria-live="polite">
        {toasts.map((t) => {
          const tone = t.type === "success" ? "green" : t.type === "error" ? "red" : "violet";
          const Icon = t.type === "success" ? CheckCircle2 : t.type === "error" ? AlertCircle : Info;
          return (
            <div key={t.id} className={cx("ad-toast", `ad-tone-${tone}`)} role={t.type === "error" ? "alert" : "status"}>
              <div className="ad-icon-tile ad-tint"><Icon size={16} /></div>
              <div style={{ flex: 1, paddingTop: 3 }}>{t.message}</div>
              <IconButton icon={X} label="Đóng" onClick={() => setToasts((x) => x.filter((i) => i.id !== t.id))} style={{ width: 26, height: 26 }} />
            </div>
          );
        })}
      </div>
      </div>
    </UICtx.Provider>
  );
}

/* Chạy một thao tác bất đồng bộ: khoá nút khi đang chạy, báo thành công/lỗi bằng toast. */
export function useAction() {
  const ui = useUI();
  const [busy, setBusy] = useState(null);
  const run = useCallback(async (key, fn, successMsg) => {
    if (busy) return false;
    setBusy(key);
    try { await fn(); if (successMsg) ui.toast.success(successMsg); return true; }
    catch (e) { ui.toast.error(e?.message || "Có lỗi xảy ra."); return false; }
    finally { setBusy(null); }
  }, [busy, ui]);
  return { busy, run };
}
