import React, { useMemo, useState } from "react";
import { BriefcaseBusiness, Edit3, EyeOff, Plus, Save } from "lucide-react";
import { apiSend } from "../../lib/api.js";
import { CATEGORIES } from "../../lib/categories.jsx";
import { formatVND } from "../../lib/format.js";
import { Button, Card, DataTable, EmptyState, Field, IconButton, Input, Modal, SearchInput, Select, Textarea, norm, useAction, useUI } from "../../components/admin/kit.jsx";

const EMPTY = { name: "", category: "toc", duration: 30, price: 100000, description: "" };

export function AdminServices({ services, refreshServices }) {
  const ui = useUI();
  const { busy, run } = useAction();
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");

  const rows = useMemo(() => {
    const q = norm(query.trim());
    return services.filter((s) => (cat === "all" || s.category === cat) && (!q || norm(`${s.name} ${s.description || ""}`).includes(q)));
  }, [services, query, cat]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const openAdd = () => { setEditingId(null); setForm(EMPTY); setError(""); setOpen(true); };
  const openEdit = (s) => {
    setEditingId(s.id); setError("");
    setForm({ name: s.name || "", category: s.category || "toc", duration: Number(s.duration || 30), price: Number(s.price || 0), description: s.description || "" });
    setOpen(true);
  };

  const save = async () => {
    const duration = Number(form.duration), price = Number(form.price);
    if (!form.name.trim()) return setError("Nhập tên dịch vụ.");
    if (!form.category) return setError("Chọn danh mục dịch vụ.");
    if (!Number.isFinite(duration) || duration <= 0) return setError("Thời lượng phải lớn hơn 0 phút.");
    if (!Number.isFinite(price) || price < 0) return setError("Giá dịch vụ không được âm.");
    setError("");
    const payload = { name: form.name.trim(), category: form.category, duration, price, description: form.description.trim() };
    const ok = await run("save", async () => {
      if (editingId) await apiSend(`/services/${editingId}`, "PATCH", payload); else await apiSend("/services", "POST", payload);
      await refreshServices();
    }, editingId ? "Cập nhật dịch vụ thành công." : "Thêm dịch vụ thành công.");
    if (ok) setOpen(false);
  };

  const hide = async (s) => {
    if (!(await ui.confirm({ title: `Ẩn dịch vụ “${s.name}”?`, message: "Dịch vụ sẽ không còn hiển thị khi khách đặt lịch. Các lịch hẹn cũ vẫn được giữ nguyên.", confirmText: "Ẩn dịch vụ", tone: "danger" }))) return;
    run(`h${s.id}`, async () => { await apiSend(`/services/${s.id}`, "DELETE"); await refreshServices(); }, "Đã ẩn dịch vụ.");
  };

  const catOf = (s) => CATEGORIES.find((c) => c.id === s.category);

  return (
    <>
      <Card flush>
        <div className="ad-toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Tìm dịch vụ…" />
          <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Lọc theo nhóm" style={{ width: 170 }}>
            <option value="all">Tất cả nhóm</option>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
          <div className="ad-spacer" />
          <span className="ad-muted ad-hide-sm">Giá mới chỉ áp dụng cho lịch đặt sau đó</span>
          <Button icon={Plus} onClick={openAdd}>Thêm dịch vụ</Button>
        </div>
        <DataTable rows={rows} noun="dịch vụ" initialSort={{ key: "name", dir: "asc" }}
          empty={<EmptyState icon={BriefcaseBusiness} title="Chưa có dịch vụ phù hợp" action={<Button icon={Plus} onClick={openAdd}>Thêm dịch vụ</Button>} />}
          columns={[
            { key: "name", header: "Dịch vụ", sortable: true, sortValue: (s) => s.name, render: (s) => <div className="ad-cell-user"><div className="ad-avatar ad-tint" style={{ "--t": catOf(s)?.color, borderRadius: 12 }}>{(catOf(s)?.label || "?")[0]}</div><div><b>{s.name}</b><small className="ad-truncate" style={{ maxWidth: 320 }}>{s.description || "Chưa có mô tả"}</small></div></div> },
            { key: "category", header: "Nhóm", sortable: true, sortValue: (s) => catOf(s)?.label || "", render: (s) => <span className="ad-pill ad-tint" style={{ "--t": catOf(s)?.color }}>{catOf(s)?.label || s.category_name || "—"}</span> },
            { key: "duration", header: "Thời lượng", sortable: true, sortValue: (s) => Number(s.duration), nowrap: true, render: (s) => <span className="ad-num">{s.duration} phút</span> },
            { key: "price", header: "Giá", sortable: true, sortValue: (s) => Number(s.price), align: "right", nowrap: true, render: (s) => <b className="ad-num">{formatVND(s.price)}</b> },
            { key: "act", header: "", align: "right", width: 100, render: (s) => (
              <div className="ad-row-actions"><IconButton icon={Edit3} label="Sửa dịch vụ" onClick={() => openEdit(s)} /><IconButton icon={EyeOff} tone="red" label="Ẩn dịch vụ" disabled={!!busy} onClick={() => hide(s)} /></div>) },
          ]} />
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} busy={busy === "save"} title={editingId ? "Sửa dịch vụ" : "Thêm dịch vụ mới"} subtitle="Thay đổi giá chỉ áp dụng cho lịch đặt mới; lịch cũ giữ giá đã chốt."
        footer={<><Button variant="ghost" onClick={() => setOpen(false)} disabled={busy === "save"}>Huỷ</Button><Button icon={Save} loading={busy === "save"} onClick={save}>{editingId ? "Lưu thay đổi" : "Thêm dịch vụ"}</Button></>}>
        <div className="ad-form-grid">
          <Field label="Tên dịch vụ" required full><Input value={form.name} onChange={set("name")} placeholder="Ví dụ: Cắt tóc nữ" /></Field>
          <Field label="Nhóm dịch vụ" required><Select value={form.category} onChange={set("category")}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field>
          <Field label="Thời lượng (phút)" required><Input type="number" min="1" step="5" value={form.duration} onChange={set("duration")} /></Field>
          <Field label="Giá (VNĐ)" required hint={Number(form.price) > 0 ? formatVND(form.price) : "Nhập 0 nếu miễn phí"}><Input type="number" min="0" step="1000" value={form.price} onChange={set("price")} /></Field>
          <Field label="Mô tả" full><Textarea rows={3} value={form.description} onChange={set("description")} placeholder="Mô tả ngắn hiển thị cho khách" /></Field>
        </div>
        {error && <div role="alert" className="ad-hint" style={{ color: "var(--ad-danger)", marginTop: 12 }}>{error}</div>}
      </Modal>
    </>
  );
}
