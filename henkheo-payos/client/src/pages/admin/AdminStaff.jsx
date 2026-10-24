import React, { useMemo, useState } from "react";
import { Edit3, KeyRound, Plus, Save, Trash2, UserCog } from "lucide-react";
import { apiSend } from "../../lib/api.js";
import { Avatar, Button, Card, DataTable, EmptyState, Field, IconButton, Input, Modal, Pill, SearchInput, Tabs, norm, useAction, useUI } from "../../components/admin/kit.jsx";

const EMPTY = { employeeCode: "", fullName: "", phone: "", email: "", position: "", specialties: "", hireDate: "" };
const specText = (st) => (Array.isArray(st.specialties) ? st.specialties.join(", ") : st.specialties || "");

export function AdminStaff({ staffList, refreshStaff }) {
  const ui = useUI();
  const { busy, run } = useAction();
  const [query, setQuery] = useState("");
  const [acc, setAcc] = useState("all");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [account, setAccount] = useState(null); // { st, username, password }
  const [accountErr, setAccountErr] = useState("");

  const counts = useMemo(() => ({ all: staffList.length, linked: staffList.filter((s) => s.user_id).length, none: staffList.filter((s) => !s.user_id).length }), [staffList]);
  const rows = useMemo(() => {
    const q = norm(query.trim());
    return staffList.filter((s) => {
      if (acc === "linked" && !s.user_id) return false;
      if (acc === "none" && s.user_id) return false;
      return !q || norm([s.employee_code, s.full_name || s.name, s.phone, s.email, s.position, specText(s)].join(" ")).includes(q);
    });
  }, [staffList, query, acc]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const openAdd = () => { setEditingId(null); setForm(EMPTY); setError(""); setOpen(true); };
  const openEdit = (st) => {
    setEditingId(st.id); setError("");
    setForm({ employeeCode: st.employee_code || "", fullName: st.full_name || st.name || "", phone: st.phone || "", email: st.email || "", position: st.position || "", specialties: specText(st), hireDate: st.hire_date ? String(st.hire_date).slice(0, 10) : "" });
    setOpen(true);
  };

  const save = async () => {
    if (!form.employeeCode.trim() || !form.fullName.trim()) return setError("Mã nhân viên và họ tên là bắt buộc.");
    setError("");
    const payload = { ...form, employeeCode: form.employeeCode.trim(), fullName: form.fullName.trim() };
    const ok = await run("save", async () => {
      if (editingId) await apiSend(`/staff/${editingId}`, "PATCH", payload); else await apiSend("/staff", "POST", payload);
      await refreshStaff();
    }, editingId ? "Cập nhật nhân viên thành công." : "Thêm nhân viên thành công.");
    if (ok) setOpen(false);
  };

  const openAccount = (st) => {
    if (st.user_id) return ui.toast.info(`Nhân viên ${st.full_name || st.name} đã có tài khoản STAFF.`);
    setAccountErr(""); setAccount({ st, username: String(st.employee_code || "").toLowerCase(), password: "" });
  };
  const createAccount = async () => {
    const username = account.username.trim();
    if (!username) return setAccountErr("Nhập username đăng nhập.");
    if (account.password.length < 8 || !/[A-Za-z]/.test(account.password) || !/\d/.test(account.password)) return setAccountErr("Mật khẩu cần ít nhất 8 ký tự, gồm cả chữ và số.");
    setAccountErr("");
    const ok = await run("acc", async () => { await apiSend(`/staff/${account.st.id}/account`, "POST", { username, password: account.password }); await refreshStaff(); }, `Đã tạo tài khoản STAFF: ${username}`);
    if (ok) setAccount(null);
  };

  const remove = async (st) => {
    const name = st.full_name || st.name;
    if (!(await ui.confirm({ title: `Xoá nhân viên ${name}?`, message: "Nhân viên sẽ không còn xuất hiện khi khách đặt lịch.", confirmText: "Xoá nhân viên", tone: "danger" }))) return;
    run(`d${st.id}`, async () => { await apiSend(`/staff/${st.id}`, "DELETE"); await refreshStaff(); }, `Đã xoá nhân viên ${name}.`);
  };

  return (
    <>
      <Card flush>
        <div className="ad-toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Tìm tên, mã NV, chuyên môn…" />
          <div className="ad-spacer" />
          <Tabs value={acc} onChange={setAcc} items={[{ id: "all", label: "Tất cả", count: counts.all }, { id: "linked", label: "Có tài khoản", count: counts.linked }, { id: "none", label: "Chưa có tài khoản", count: counts.none }]} />
          <Button icon={Plus} onClick={openAdd}>Thêm nhân viên</Button>
        </div>
        <DataTable rows={rows} noun="nhân viên" initialSort={{ key: "code", dir: "asc" }}
          empty={<EmptyState icon={UserCog} title="Chưa có nhân viên phù hợp" action={<Button icon={Plus} onClick={openAdd}>Thêm nhân viên</Button>} />}
          columns={[
            { key: "code", header: "Mã NV", sortable: true, sortValue: (s) => s.employee_code, nowrap: true, render: (s) => <b className="ad-num">{s.employee_code}</b> },
            { key: "name", header: "Nhân viên", sortable: true, sortValue: (s) => s.full_name || s.name, render: (s) => <div className="ad-cell-user"><Avatar name={s.full_name || s.name} /><div><b>{s.full_name || s.name}</b><small>{s.email || "—"}</small></div></div> },
            { key: "phone", header: "Điện thoại", nowrap: true, render: (s) => s.phone || "—" },
            { key: "position", header: "Chức vụ", render: (s) => s.position || "—" },
            { key: "spec", header: "Chuyên môn", render: (s) => specText(s) || "—" },
            { key: "acc", header: "Tài khoản", render: (s) => (s.user_id ? <Pill tone="green" dot>Đã liên kết</Pill> : <Button variant="soft" size="sm" icon={KeyRound} disabled={!!busy} onClick={() => openAccount(s)}>Tạo tài khoản</Button>) },
            { key: "act", header: "", align: "right", width: 100, render: (s) => (
              <div className="ad-row-actions"><IconButton icon={Edit3} label="Sửa nhân viên" onClick={() => openEdit(s)} /><IconButton icon={Trash2} tone="red" label="Xoá nhân viên" disabled={!!busy} onClick={() => remove(s)} /></div>) },
          ]} />
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} busy={busy === "save"} wide title={editingId ? "Sửa nhân viên" : "Thêm nhân viên"}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)} disabled={busy === "save"}>Huỷ</Button><Button icon={Save} loading={busy === "save"} onClick={save}>{editingId ? "Lưu thay đổi" : "Thêm nhân viên"}</Button></>}>
        <div className="ad-form-grid">
          <Field label="Mã nhân viên" required><Input value={form.employeeCode} onChange={set("employeeCode")} placeholder="NV001" /></Field>
          <Field label="Họ và tên" required><Input value={form.fullName} onChange={set("fullName")} /></Field>
          <Field label="Số điện thoại"><Input value={form.phone} onChange={set("phone")} inputMode="tel" /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={set("email")} /></Field>
          <Field label="Chức vụ"><Input value={form.position} onChange={set("position")} /></Field>
          <Field label="Ngày vào làm"><Input type="date" value={form.hireDate} onChange={set("hireDate")} /></Field>
          <Field label="Chuyên môn" full hint="Ngăn cách bằng dấu phẩy. Ví dụ: Cắt tóc, tạo kiểu"><Input value={form.specialties} onChange={set("specialties")} /></Field>
        </div>
        {error && <div role="alert" className="ad-hint" style={{ color: "var(--ad-danger)", marginTop: 12 }}>{error}</div>}
      </Modal>

      <Modal open={!!account} onClose={() => setAccount(null)} busy={busy === "acc"} title="Tạo tài khoản STAFF" subtitle={account && `Cho nhân viên ${account.st.full_name || account.st.name}`}
        footer={<><Button variant="ghost" onClick={() => setAccount(null)} disabled={busy === "acc"}>Huỷ</Button><Button icon={KeyRound} loading={busy === "acc"} onClick={createAccount}>Tạo tài khoản</Button></>}>
        {account && <div className="ad-form-grid">
          <Field label="Username" required full><Input value={account.username} onChange={(e) => setAccount({ ...account, username: e.target.value })} autoComplete="off" /></Field>
          <Field label="Mật khẩu" required full hint="Ít nhất 8 ký tự, gồm cả chữ và số."><Input type="password" value={account.password} onChange={(e) => setAccount({ ...account, password: e.target.value })} autoComplete="new-password" onKeyDown={(e) => e.key === "Enter" && createAccount()} /></Field>
        </div>}
        {accountErr && <div role="alert" className="ad-hint" style={{ color: "var(--ad-danger)", marginTop: 12 }}>{accountErr}</div>}
      </Modal>
    </>
  );
}
