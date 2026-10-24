import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Inbox, RefreshCcw, X } from "lucide-react";
import { apiGet, apiSend } from "../../lib/api.js";
import { dmLabel } from "../../lib/format.js";
import { Alert, Avatar, Button, Card, EmptyState, Pill, Skeleton, Tabs, useAction, useUI } from "../../components/admin/kit.jsx";

const ST = { REQUESTED: ["Chờ duyệt", "amber"], APPROVED: ["Đã duyệt", "green"], REJECTED: ["Từ chối", "red"], CANCELLED: ["Khách đã huỷ", "gray"] };
const hm = (t) => String(t || "").slice(0, 5);

function Slot({ label, staff, date, start, end, tone }) {
  return (
    <div className={`ad-tone-${tone}`} style={{ flex: "1 1 200px", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--ad-line)", background: tone === "violet" ? "color-mix(in srgb, var(--ad-primary) 5%, #fff)" : "var(--ad-surface-2)" }}>
      <div className="ad-muted" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>{label}</div>
      <div className="ad-display ad-num" style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{dmLabel(date)} · {hm(start)}{end ? `–${hm(end)}` : ""}</div>
      <div className="ad-muted" style={{ fontSize: 12.5 }}>{staff || "Chưa phân nhân viên"}</div>
    </div>
  );
}

export function AdminRescheduleRequests() {
  const ui = useUI();
  const { busy, run } = useAction();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("REQUESTED");

  const load = async () => {
    try { setLoading(true); setError(""); setRows(await apiGet("/reschedule-requests")); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => { const c = { ALL: rows.length }; rows.forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; }); return c; }, [rows]);
  const shown = useMemo(() => (filter === "ALL" ? rows : rows.filter((r) => r.status === filter)), [rows, filter]);

  const approve = async (r) => {
    if (!(await ui.confirm({ title: "Duyệt yêu cầu đổi lịch?", message: `Lịch ${r.appointment_code} của ${r.customer_name} sẽ chuyển sang ${dmLabel(r.requested_date)} · ${hm(r.requested_start_time)} và khách được thông báo.`, confirmText: "Duyệt đổi lịch" }))) return;
    run(`a${r.id}`, async () => { await apiSend(`/reschedule-requests/${r.id}/approve`, "PATCH", {}); await load(); }, "Đã duyệt yêu cầu đổi lịch.");
  };
  const reject = async (r) => {
    const reason = await ui.prompt({ title: "Từ chối yêu cầu đổi lịch", message: `${r.appointment_code} · ${r.customer_name}`, label: "Lý do từ chối (khách sẽ nhận được)", defaultValue: "Khung giờ không còn phù hợp.", multiline: true, requiredMessage: "Vui lòng nhập lý do từ chối.", confirmText: "Từ chối", tone: "danger" });
    if (!reason) return;
    run(`r${r.id}`, async () => { await apiSend(`/reschedule-requests/${r.id}/reject`, "PATCH", { reason }); await load(); }, "Đã từ chối yêu cầu.");
  };

  const tabs = [["REQUESTED", "Chờ duyệt"], ["APPROVED", "Đã duyệt"], ["REJECTED", "Từ chối"], ["ALL", "Tất cả"]];

  return (
    <div className="ad-stack">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <Tabs value={filter} onChange={setFilter} items={tabs.map(([id, label]) => ({ id, label, count: counts[id] || 0 }))} />
        <Button variant="ghost" icon={RefreshCcw} loading={loading} onClick={load}>Tải lại</Button>
      </div>
      {error && <Alert tone="red">{error}</Alert>}

      {loading && !rows.length ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} h={130} style={{ borderRadius: 14 }} />)
        : shown.map((r) => {
          const [label, tone] = ST[r.status] || [r.status, "gray"];
          const pending = r.status === "REQUESTED";
          return (
            <Card key={r.id} className={pending ? "ad-tone-amber" : ""} style={pending ? { borderColor: "color-mix(in srgb, var(--ad-amber) 45%, #fff)" } : undefined}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div className="ad-cell-user"><Avatar name={r.customer_name} /><div><b>{r.customer_name}</b><small>{r.appointment_code} · {r.service_name}</small></div></div>
                <Pill tone={tone} dot>{label}</Pill>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "stretch" }}>
                <Slot label="Lịch hiện tại" staff={r.current_staff_name} date={r.current_date} start={r.current_start_time} end={r.current_end_time} tone="gray" />
                <div style={{ display: "grid", placeItems: "center", color: "var(--ad-ink-3)" }}><ArrowRight size={18} /></div>
                <Slot label="Lịch đề nghị" staff={r.requested_staff_name} date={r.requested_date} start={r.requested_start_time} end={r.requested_end_time} tone="violet" />
              </div>
              {r.reason && <p className="ad-muted" style={{ marginTop: 12 }}>Lý do của khách: <span style={{ color: "var(--ad-ink)" }}>{r.reason}</span></p>}
              {pending && (
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <Button icon={Check} loading={busy === `a${r.id}`} disabled={!!busy} onClick={() => approve(r)}>Duyệt</Button>
                  <Button variant="soft" tone="red" icon={X} loading={busy === `r${r.id}`} disabled={!!busy} onClick={() => reject(r)}>Từ chối</Button>
                </div>
              )}
            </Card>
          );
        })}
      {!loading && !shown.length && <Card><EmptyState icon={Inbox} title={filter === "REQUESTED" ? "Không có yêu cầu nào đang chờ" : "Chưa có yêu cầu đổi lịch"}>{filter === "REQUESTED" && rows.length ? "Chuyển sang “Tất cả” để xem các yêu cầu đã xử lý." : "Khi khách xin đổi lịch, yêu cầu sẽ hiện ở đây."}</EmptyState></Card>}
    </div>
  );
}
