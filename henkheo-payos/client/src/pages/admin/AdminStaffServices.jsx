import React, { useEffect, useMemo, useState } from "react";
import { Check, Save, Users } from "lucide-react";
import { apiGet, apiSend } from "../../lib/api.js";
import { Alert, Avatar, Button, Card, EmptyState, Field, Select, Skeleton, SearchInput, norm, useAction, useUI } from "../../components/admin/kit.jsx";

export function AdminStaffServices({ services, staffList }) {
  const ui = useUI();
  const { busy, run } = useAction();
  const [selectedService, setSelectedService] = useState(services[0]?.id || "");
  const [saved, setSaved] = useState([]);        // đã lưu trên server
  const [ids, setIds] = useState([]);            // đang chọn
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => { if (!selectedService && services[0]?.id) setSelectedService(services[0].id); }, [services, selectedService]);

  useEffect(() => {
    if (!selectedService) return;
    let cancelled = false;
    setLoading(true); setError("");
    apiGet(`/staff-services/service/${encodeURIComponent(selectedService)}`)
      .then((r) => { if (!cancelled) { const n = (r || []).map(Number); setSaved(n); setIds(n); } })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedService]);

  const dirty = useMemo(() => ids.length !== saved.length || ids.some((i) => !saved.includes(i)), [ids, saved]);
  const toggle = (id) => setIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const service = services.find((s) => String(s.id) === String(selectedService));
  const list = useMemo(() => { const q = norm(query.trim()); return staffList.filter((s) => !q || norm(`${s.full_name || s.name} ${s.position || ""} ${s.employee_code || ""}`).includes(q)); }, [staffList, query]);

  const changeService = async (e) => {
    const next = e.target.value;
    if (dirty && !(await ui.confirm({ title: "Bỏ thay đổi chưa lưu?", message: "Phân công của dịch vụ hiện tại có thay đổi chưa lưu.", confirmText: "Bỏ thay đổi", tone: "danger" }))) return;
    setSelectedService(next);
  };
  const save = () => run("save", async () => { await apiSend(`/staff-services/service/${encodeURIComponent(selectedService)}`, "PUT", { staffIds: ids }); setSaved(ids); }, `Đã lưu ${ids.length} nhân viên cho dịch vụ.`);

  if (!services.length) return <Card><EmptyState icon={Users} title="Chưa có dịch vụ nào">Hãy thêm dịch vụ trước khi phân công nhân viên.</EmptyState></Card>;

  return (
    <div className="ad-stack">
      <Card title="Chọn dịch vụ" subtitle={service ? `${service.duration} phút · ${ids.length}/${staffList.length} nhân viên được phân công` : undefined}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 280px", maxWidth: 420 }}>
            <Field label="Dịch vụ"><Select value={selectedService} onChange={changeService}>{services.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.duration} phút</option>)}</Select></Field>
          </div>
          <SearchInput value={query} onChange={setQuery} placeholder="Lọc nhân viên…" />
        </div>
      </Card>

      {error && <Alert tone="red">{error}</Alert>}

      <div className="ad-grid c3" style={{ gap: 14 }}>
        {loading ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={72} style={{ borderRadius: 14 }} />)
          : list.map((st) => {
            const id = Number(st.id); const on = ids.includes(id);
            return (
              <button key={id} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(id)} className={`ad-tile ${on ? "is-on" : ""}`}>
                <Avatar name={st.full_name || st.name} />
                <div style={{ minWidth: 0 }}><div className="ad-truncate" style={{ fontWeight: 600 }}>{st.full_name || st.name}</div><div className="ad-muted ad-truncate" style={{ fontSize: 12 }}>{st.position || "Nhân viên dịch vụ"}</div></div>
                <span className="ad-check"><Check size={14} strokeWidth={3} /></span>
              </button>
            );
          })}
      </div>
      {!loading && !list.length && <Card><EmptyState icon={Users} title="Không có nhân viên phù hợp" /></Card>}

      {dirty && (
        <div className="ad-savebar" role="status">
          <span>Có thay đổi chưa lưu · <b className="ad-num">{ids.length}</b> nhân viên được chọn</span>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" size="sm" style={{ background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,.3)" }} onClick={() => setIds(saved)} disabled={!!busy}>Hoàn tác</Button>
            <Button size="sm" icon={Save} loading={busy === "save"} onClick={save}>Lưu phân công</Button>
          </div>
        </div>
      )}
    </div>
  );
}
