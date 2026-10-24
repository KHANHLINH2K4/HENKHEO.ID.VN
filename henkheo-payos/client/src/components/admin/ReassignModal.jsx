import React, { useEffect, useState } from "react";
import { apiSend } from "../../lib/api.js";
import { Alert, Button, Field, Input, Modal, Select, Textarea, useUI } from "./kit.jsx";

/* Admin chuyển lịch sang nhân viên khác và/hoặc giờ khác (vd: nhân viên nghỉ đột xuất).
   Máy chủ kiểm tra lại ca làm, trùng giờ và phân công dịch vụ nên mọi lỗi được hiển thị nguyên văn. */
export function ReassignModal({ appointment, staffList = [], onClose, onDone }) {
  const ui = useUI();
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!appointment) return;
    setStaffId(String(appointment.staff_id || ""));
    setDate(String(appointment.date || "").slice(0, 10));
    setTime(String(appointment.time || "").slice(0, 5));
    setReason(""); setError("");
  }, [appointment]);

  if (!appointment) return null;
  const submit = async () => {
    setBusy(true); setError("");
    try {
      await apiSend(`/appointments/${appointment.id}/reassign`, "PATCH", { staffId: Number(staffId), date, time, reason });
      ui?.toast?.("Đã chuyển lịch hẹn và thông báo cho khách.");
      await onDone?.();
      onClose?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} busy={busy} title="Chuyển lịch hẹn" subtitle={`${appointment.appointment_code} · ${appointment.customer_name} · ${appointment.service_name}`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Đóng</Button><Button loading={busy} onClick={submit}>Chuyển lịch</Button></>}>
      {error && <div style={{ marginBottom: 12 }}><Alert tone="red">{error}</Alert></div>}
      <div className="ad-form-grid">
        <Field label="Nhân viên" required>
          <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            {staffList.map((s) => <option key={s.id} value={s.id}>{s.full_name || s.name}</option>)}
          </Select>
        </Field>
        <Field label="Ngày" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Giờ bắt đầu" required><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        <Field label="Lý do (khách sẽ nhận được thông báo)" full><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Vd: nhân viên nghỉ đột xuất" /></Field>
      </div>
    </Modal>
  );
}
