import React, { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { apiGet, apiSend } from "../../lib/api.js";
import { todayISO, formatVND } from "../../lib/format.js";
import { Alert, Button, Field, Input, Modal, Select, Textarea, useUI } from "./kit.jsx";

/*
 * Tạo lịch hộ khách (khách đến trực tiếp hoặc gọi điện).
 *  - ADMIN: chọn nhân viên hoặc "Bất kỳ nhân viên", có thể tìm khách cũ theo tên/SĐT.
 *  - STAFF: chỉ tạo cho chính mình, nhập SĐT để tự khớp khách cũ.
 * Lịch được xác nhận ngay (cơ sở đã trực tiếp nhận khách), thanh toán tại cơ sở.
 */
export function ManualBookingModal({ open, onClose, services, role, onCreated }) {
  const ui = useUI();
  const isAdmin = role === "ADMIN";
  const empty = { source: "WALK_IN", customerId: null, fullName: "", phone: "", email: "", serviceId: "", staffId: "", date: todayISO(), time: "", note: "" };
  const [f, setF] = useState(empty);
  const [matches, setMatches] = useState([]);
  const [options, setOptions] = useState(null);
  const [loadingOpts, setLoadingOpts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch) => setF((v) => ({ ...v, ...patch }));

  useEffect(() => { if (open) { setF({ ...empty, serviceId: services?.[0]?.id ? String(services[0].id) : "" }); setMatches([]); setOptions(null); setError(""); } }, [open]);

  // Tra khách cũ (admin: theo tên/SĐT; staff: đúng SĐT).
  useEffect(() => {
    if (!open || f.customerId) return undefined;
    const q = isAdmin ? (f.phone || f.fullName) : f.phone;
    if (!q || q.trim().length < 2) { setMatches([]); return undefined; }
    const t = setTimeout(() => {
      apiGet(`/appointments/manual/customers?q=${encodeURIComponent(q.trim())}`).then(setMatches).catch(() => setMatches([]));
    }, 300);
    return () => clearTimeout(t);
  }, [open, f.phone, f.fullName, f.customerId, isAdmin]);

  // Khung giờ trống theo dịch vụ + ngày.
  useEffect(() => {
    if (!open || !f.serviceId || !f.date) return undefined;
    let cancelled = false;
    setLoadingOpts(true);
    apiGet(`/appointments/manual/options?serviceId=${encodeURIComponent(f.serviceId)}&date=${encodeURIComponent(f.date)}`)
      .then((d) => { if (!cancelled) { setOptions(d); setF((v) => ({ ...v, time: "", staffId: isAdmin ? (v.staffId && (v.staffId === "ANY" || d.staff.some((s) => String(s.id) === String(v.staffId))) ? v.staffId : "") : String(d.staff[0]?.id || "") })); } })
      .catch((e) => { if (!cancelled) { setOptions(null); setError(e.message); } })
      .finally(() => { if (!cancelled) setLoadingOpts(false); });
    return () => { cancelled = true; };
  }, [open, f.serviceId, f.date, isAdmin]);

  const anyMode = f.staffId === "ANY";
  const staffOpt = options?.staff.find((s) => String(s.id) === String(f.staffId));
  const slots = (anyMode ? options?.any?.slots : staffOpt?.slots) || [];
  const service = services?.find((s) => String(s.id) === String(f.serviceId));

  const pick = (c) => set({ customerId: c.id, fullName: c.full_name, phone: c.phone, email: c.email || "" });

  const submit = async () => {
    setError("");
    if (!f.customerId && (!f.fullName.trim() || !f.phone.trim())) { setError("Vui lòng nhập họ tên và số điện thoại khách."); return; }
    if (!f.serviceId || !f.staffId || !f.time) { setError("Vui lòng chọn dịch vụ, nhân viên và khung giờ."); return; }
    setBusy(true);
    try {
      const r = await apiSend("/appointments/manual", "POST", {
        source: f.source, customerId: f.customerId || undefined, fullName: f.fullName, phone: f.phone, email: f.email || undefined,
        serviceId: Number(f.serviceId), staffId: f.staffId === "ANY" ? "ANY" : Number(f.staffId), date: f.date, time: f.time, note: f.note,
      });
      ui.toast.success(`Đã tạo lịch ${r.appointment_code} cho ${r.customer?.full_name}${r.auto_assigned ? ` (nhân viên: ${r.staff_name})` : ""}.`);
      onCreated?.();
      onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} busy={busy} wide title="Tạo lịch hộ khách" subtitle="Khách đến trực tiếp hoặc gọi điện — lịch được xác nhận ngay, thanh toán tại cơ sở."
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Đóng</Button><Button icon={UserPlus} loading={busy} onClick={submit} disabled={!f.time}>Tạo & xác nhận lịch</Button></>}>
      {error && <div style={{ marginBottom: 12 }}><Alert tone="red" onClose={() => setError("")}>{error}</Alert></div>}
      <div className="ad-form-grid">
        <Field label="Nguồn khách"><Select value={f.source} onChange={(e) => set({ source: e.target.value })}><option value="WALK_IN">Khách đến trực tiếp</option><option value="PHONE">Khách gọi điện</option></Select></Field>
        <Field label="Số điện thoại" required hint={f.customerId ? "Đã chọn khách cũ" : "Nhập SĐT để tự tìm khách đã có"}>
          <Input value={f.phone} onChange={(e) => set({ phone: e.target.value, customerId: null })} placeholder="0912345678" inputMode="tel" />
        </Field>
        <Field label="Họ tên khách" required><Input value={f.fullName} onChange={(e) => set({ fullName: e.target.value, customerId: null })} disabled={!!f.customerId && !isAdmin} /></Field>
        <Field label="Email (nhận xác nhận & nhắc lịch)"><Input value={f.email} onChange={(e) => set({ email: e.target.value })} type="email" placeholder="Không bắt buộc" /></Field>
        {matches.length > 0 && !f.customerId && (
          <div className="full ad-muted" style={{ fontSize: 13 }}>
            Khách đã có: {matches.map((c) => <button key={c.id} type="button" onClick={() => pick(c)} className="ad-btn ad-btn-soft sm" style={{ margin: "4px 6px 0 0" }}>{c.full_name} · {c.phone}</button>)}
          </div>
        )}
        <Field label="Dịch vụ" required><Select value={f.serviceId} onChange={(e) => set({ serviceId: e.target.value, time: "" })}>{services.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.duration} phút · {formatVND(s.price)}</option>)}</Select></Field>
        <Field label="Ngày" required><Input type="date" min={todayISO()} value={f.date} onChange={(e) => set({ date: e.target.value, time: "" })} /></Field>
        <Field label="Nhân viên" required hint={!isAdmin ? "Nhân viên chỉ tạo lịch cho chính mình." : undefined}>
          <Select value={f.staffId} onChange={(e) => set({ staffId: e.target.value, time: "" })} disabled={!isAdmin || loadingOpts}>
            <option value="">{loadingOpts ? "Đang tải…" : "— Chọn nhân viên —"}</option>
            {isAdmin && options?.any?.available && <option value="ANY">Bất kỳ nhân viên (tự chọn người rảnh)</option>}
            {options?.staff.map((s) => <option key={s.id} value={s.id} disabled={!s.available}>{s.name}{s.available ? ` · ${s.slots.length} giờ trống` : " · hết giờ"}</option>)}
          </Select>
        </Field>
        <Field label="Khung giờ" required hint={f.staffId && !slots.length && !loadingOpts ? "Không còn khung giờ phù hợp." : undefined}>
          <Select value={f.time} onChange={(e) => set({ time: e.target.value })} disabled={!slots.length}>
            <option value="">— Chọn giờ —</option>{slots.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Ghi chú" full><Textarea rows={2} value={f.note} onChange={(e) => set({ note: e.target.value })} placeholder="Yêu cầu đặc biệt (không bắt buộc)" /></Field>
      </div>
      {service && <div className="ad-muted" style={{ fontSize: 12, marginTop: 10 }}>Giá chốt: {formatVND(service.price)} · thanh toán tại cơ sở.</div>}
    </Modal>
  );
}
