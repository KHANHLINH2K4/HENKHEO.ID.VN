import React, { useMemo, useState } from "react";
import { Edit3, Lock, Save, Unlock, UserX } from "lucide-react";
import { apiSend } from "../../lib/api.js";
import { formatVND, dmLabel } from "../../lib/format.js";
import { Avatar, Button, Card, DataTable, EmptyState, Field, IconButton, Input, Modal, Pill, SearchInput, Tabs, Textarea, norm, useAction, useUI } from "../../components/admin/kit.jsx";

const EMPTY = { fullName: "", phone: "", email: "", address: "", note: "" };

export function AdminCustomers({ customers, refreshCustomers }) {
  const ui = useUI();
  const { busy, run } = useAction();
  const [query, setQuery] = useState("");
  const [state, setState] = useState("all");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [formErr, setFormErr] = useState("");

  const counts = useMemo(() => ({ all: customers.length, active: customers.filter((c) => c.is_active).length, locked: customers.filter((c) => !c.is_active).length }), [customers]);
  const rows = useMemo(() => {
    const q = norm(query.trim());
    return customers.filter((c) => {
      if (state === "active" && !c.is_active) return false;
      if (state === "locked" && c.is_active) return false;
      return !q || [c.full_name, c.phone, c.email].some((v) => norm(v).includes(q));
    });
  }, [customers, query, state]);

  const openEdit = (c) => { setEditing(c); setFormErr(""); setForm({ fullName: c.full_name || "", phone: c.phone || "", email: c.email || "", address: c.address || "", note: c.note || "" }); };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.fullName.trim()) return setFormErr("Vui lòng nhập họ tên khách hàng.");
    setFormErr("");
    const ok = await run("save", async () => { await apiSend(`/customers/${editing.id}`, "PATCH", form); await refreshCustomers?.(); }, "Đã cập nhật khách hàng.");
    if (ok) setEditing(null);
  };
  const disable = async (c) => {
    if (!(await ui.confirm({ title: `Khoá khách hàng ${c.full_name}?`, message: "Khách sẽ không đăng nhập hoặc đặt lịch được cho đến khi kích hoạt lại. Lịch sử đặt lịch vẫn được giữ nguyên.", confirmText: "Khoá khách hàng", tone: "danger" }))) return;
    run(`d${c.id}`, async () => { await apiSend(`/customers/${c.id}`, "DELETE", {}); await refreshCustomers?.(); }, "Đã khoá khách hàng.");
  };
  const restore = (c) => run(`r${c.id}`, async () => { await apiSend(`/customers/${c.id}/restore`, "PATCH", {}); await refreshCustomers?.(); }, "Đã kích hoạt lại khách hàng.");

  return (
    <>
      <Card flush>
        <div className="ad-toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Tìm tên, SĐT, email…" />
          <div className="ad-spacer" />
          <Tabs value={state} onChange={setState} items={[{ id: "all", label: "Tất cả", count: counts.all }, { id: "active", label: "Đang hoạt động", count: counts.active }, { id: "locked", label: "Đã khoá", count: counts.locked }]} />
        </div>
        <DataTable rows={rows} noun="khách" initialSort={{ key: "spent", dir: "desc" }}
          empty={<EmptyState icon={UserX} title="Không có khách hàng phù hợp">Thử tìm bằng số điện thoại hoặc email.</EmptyState>}
          columns={[
            { key: "name", header: "Khách hàng", sortable: true, sortValue: (c) => c.full_name, render: (c) => <div className="ad-cell-user"><Avatar name={c.full_name} /><div><b>{c.full_name}</b><small>{c.email || "—"}</small></div></div> },
            { key: "phone", header: "Số điện thoại", nowrap: true, render: (c) => c.phone || "—" },
            { key: "state", header: "Trạng thái", render: (c) => <Pill tone={c.is_active ? "green" : "red"} dot>{c.is_active ? "Đang hoạt động" : "Đã khoá"}</Pill> },
            { key: "count", header: "Số lịch", sortable: true, sortValue: (c) => Number(c.appointment_count || 0), align: "right", render: (c) => <span className="ad-num">{c.appointment_count || 0}</span> },
            { key: "spent", header: "Tổng chi tiêu", sortable: true, sortValue: (c) => Number(c.total_spent || 0), align: "right", nowrap: true, render: (c) => <b className="ad-num">{formatVND(c.total_spent || 0)}</b> },
            { key: "last", header: "Lần gần nhất", sortable: true, nowrap: true, sortValue: (c) => c.last_appointment || "", render: (c) => (c.last_appointment ? <span className="ad-num">{dmLabel(c.last_appointment)}</span> : "—") },
            { key: "act", header: "", align: "right", width: 120, render: (c) => (
              <div className="ad-row-actions">
                <IconButton icon={Edit3} label="Sửa thông tin" onClick={() => openEdit(c)} />
                {c.is_active
                  ? <IconButton icon={Lock} tone="red" label="Khoá khách hàng" disabled={!!busy} onClick={() => disable(c)} />
                  : <Button variant="soft" tone="green" size="sm" icon={Unlock} disabled={!!busy} onClick={() => restore(c)}>Kích hoạt</Button>}
              </div>) },
          ]} />
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} busy={busy === "save"} title="Sửa khách hàng" subtitle={editing?.email || editing?.phone}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)} disabled={busy === "save"}>Huỷ</Button><Button icon={Save} loading={busy === "save"} onClick={save}>Lưu thay đổi</Button></>}>
        <div className="ad-form-grid">
          <Field label="Họ tên" required><Input value={form.fullName} onChange={set("fullName")} /></Field>
          <Field label="Số điện thoại"><Input value={form.phone} onChange={set("phone")} inputMode="tel" /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={set("email")} /></Field>
          <Field label="Địa chỉ"><Input value={form.address} onChange={set("address")} /></Field>
          <Field label="Ghi chú nội bộ" full><Textarea value={form.note} onChange={set("note")} rows={3} /></Field>
        </div>
        {formErr && <div className="ad-hint" style={{ color: "var(--ad-danger)", marginTop: 12 }}>{formErr}</div>}
      </Modal>
    </>
  );
}
