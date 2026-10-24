import React, { useCallback, useEffect, useState } from "react";
import { Check, X, CalendarOff } from "lucide-react";
import { apiGet, apiSend } from "../../lib/api.js";
import { dmLabel } from "../../lib/format.js";
import { Alert, Card, DataTable, EmptyState, IconButton, Pill, Tabs, useAction, useUI } from "../../components/admin/kit.jsx";

const TABS = [["requested", "Chờ duyệt"], ["approved", "Đã duyệt"], ["rejected", "Từ chối"], ["all", "Tất cả"]];
const TONE = { requested: "amber", approved: "green", rejected: "red", cancelled: "gray" };
const LABEL = { requested: "Chờ duyệt", approved: "Đã duyệt", rejected: "Từ chối", cancelled: "Đã hủy" };

/* Admin duyệt đơn xin nghỉ của nhân viên -> tự tạo ngày nghỉ ngoại lệ, lịch trống của khách cập nhật theo. */
export function AdminTimeOff() {
  const ui = useUI();
  const { busy, run } = useAction();
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState("requested");
  const [error, setError] = useState("");
  const load = useCallback(async () => { try { setRows(await apiGet("/time-off")); setError(""); } catch (e) { setError(e.message); } }, []);
  useEffect(() => { load(); }, [load]);

  const approve = async (r) => {
    if (!(await ui.confirm({ title: "Duyệt đơn nghỉ?", message: `${r.staff_name} nghỉ ${dmLabel(r.date_from)}${r.date_to !== r.date_from ? ` → ${dmLabel(r.date_to)}` : ""}. Khách sẽ không đặt được nhân viên này trong các ngày đó.`, confirmText: "Duyệt" }))) return;
    run(`${r.id}:a`, async () => { await apiSend(`/time-off/${r.id}/approve`, "PATCH", {}); await load(); }, "Đã duyệt đơn nghỉ.");
  };
  const reject = async (r) => {
    const note = await ui.prompt({ title: "Từ chối đơn nghỉ", message: `${r.staff_name} · ${dmLabel(r.date_from)} → ${dmLabel(r.date_to)}`, label: "Lý do từ chối (nhân viên sẽ nhận được thông báo)", multiline: true, requiredMessage: "Vui lòng nhập lý do.", confirmText: "Từ chối", tone: "danger" });
    if (!note) return;
    run(`${r.id}:r`, async () => { await apiSend(`/time-off/${r.id}/reject`, "PATCH", { note }); await load(); }, "Đã từ chối đơn nghỉ.");
  };

  const shown = rows.filter((r) => tab === "all" || r.status === tab);
  const counts = { requested: rows.filter((r) => r.status === "requested").length };
  return (
    <Card flush>
      {error && <div style={{ padding: 12 }}><Alert tone="red">{error}</Alert></div>}
      <div className="ad-toolbar"><div className="ad-spacer" /><Tabs value={tab} onChange={setTab} items={TABS.map(([id, label]) => ({ id, label, count: id === "requested" ? counts.requested : undefined }))} /></div>
      <DataTable rows={shown} noun="đơn" empty={<EmptyState icon={CalendarOff} title="Không có đơn nghỉ">Đơn xin nghỉ của nhân viên sẽ hiện ở đây.</EmptyState>}
        columns={[
          { key: "staff", header: "Nhân viên", render: (r) => <b>{r.staff_name}</b> },
          { key: "range", header: "Thời gian nghỉ", nowrap: true, render: (r) => <span className="ad-num">{dmLabel(r.date_from)}{r.date_to !== r.date_from ? ` → ${dmLabel(r.date_to)}` : ""}</span> },
          { key: "reason", header: "Lý do", render: (r) => <>{r.reason || "—"}{r.review_note && <div className="ad-muted" style={{ fontSize: 12 }}>Phản hồi: {r.review_note}</div>}</> },
          { key: "clash", header: "Lịch hẹn trong khoảng nghỉ", render: (r) => r.status === "requested" ? (r.active_appointments > 0 ? <Pill tone="red" dot>{r.active_appointments} lịch cần xử lý trước</Pill> : <Pill tone="green" dot>Không vướng lịch</Pill>) : "—" },
          { key: "status", header: "Trạng thái", render: (r) => <Pill tone={TONE[r.status]} dot>{LABEL[r.status] || r.status}</Pill> },
          { key: "act", header: "", align: "right", width: 100, render: (r) => r.status === "requested" ? <div className="ad-row-actions"><IconButton icon={Check} tone="green" label="Duyệt" disabled={!!busy} onClick={() => approve(r)} /><IconButton icon={X} tone="red" label="Từ chối" disabled={!!busy} onClick={() => reject(r)} /></div> : null },
        ]} />
    </Card>
  );
}
