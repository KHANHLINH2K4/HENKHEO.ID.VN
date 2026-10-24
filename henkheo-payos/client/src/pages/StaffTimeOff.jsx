import React, { useCallback, useEffect, useState } from "react";
import { CalendarOff, Send } from "lucide-react";
import { apiGet, apiSend } from "../lib/api.js";
import { dmLabel, todayISO } from "../lib/format.js";
import { Alert, Button, Card, EmptyState, Field, Input, Pill, Textarea, useAction } from "../components/admin/kit.jsx";

const TONE = { requested: "amber", approved: "green", rejected: "red", cancelled: "gray" };
const LABEL = { requested: "Chờ duyệt", approved: "Đã duyệt", rejected: "Bị từ chối", cancelled: "Đã hủy" };

/* Nhân viên tự gửi đơn xin nghỉ; quản trị viên duyệt thì ngày nghỉ tự áp vào lịch làm việc. */
export function StaffTimeOff() {
  const { busy, run } = useAction();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [f, setF] = useState({ dateFrom: todayISO(), dateTo: todayISO(), reason: "" });
  const load = useCallback(async () => { try { setRows(await apiGet("/time-off/my")); } catch (e) { setError(e.message); } }, []);
  useEffect(() => { load(); }, [load]);

  const submit = () => run("send", async () => {
    await apiSend("/time-off", "POST", f);
    setF({ dateFrom: todayISO(), dateTo: todayISO(), reason: "" });
    await load();
  }, "Đã gửi đơn xin nghỉ.");

  return (
    <div className="ad-grid main-side">
      <Card title="Đơn xin nghỉ của tôi" subtitle="Khi đơn được duyệt, khách sẽ không đặt được bạn trong các ngày đó." flush>
        {error && <div style={{ padding: 12 }}><Alert tone="red" onClose={() => setError("")}>{error}</Alert></div>}
        {rows.length ? rows.map((r) => (
          <div key={r.id} className="ad-list-row" style={{ padding: "14px 22px", justifyContent: "space-between", gap: 12 }}>
            <div>
              <b className="ad-num">{dmLabel(r.date_from)}{r.date_to !== r.date_from ? ` → ${dmLabel(r.date_to)}` : ""}</b>
              <div className="ad-muted" style={{ fontSize: 13 }}>{r.reason}</div>
              {r.review_note && <div className="ad-muted" style={{ fontSize: 12 }}>Phản hồi: {r.review_note}</div>}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Pill tone={TONE[r.status]} dot>{LABEL[r.status] || r.status}</Pill>
              {r.status === "requested" && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run(`c${r.id}`, async () => { await apiSend(`/time-off/my/${r.id}/cancel`, "PATCH", {}); await load(); }, "Đã hủy đơn.")}>Hủy đơn</Button>}
            </div>
          </div>
        )) : <EmptyState icon={CalendarOff} title="Chưa có đơn xin nghỉ" />}
      </Card>
      <Card title="Gửi đơn xin nghỉ">
        <div className="ad-form-grid">
          <Field label="Từ ngày" required><Input type="date" min={todayISO()} value={f.dateFrom} onChange={(e) => setF({ ...f, dateFrom: e.target.value, dateTo: e.target.value > f.dateTo ? e.target.value : f.dateTo })} /></Field>
          <Field label="Đến ngày" required><Input type="date" min={f.dateFrom} value={f.dateTo} onChange={(e) => setF({ ...f, dateTo: e.target.value })} /></Field>
          <Field label="Lý do" required full><Textarea rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        </div>
        <div style={{ marginTop: 16 }}><Button icon={Send} loading={busy === "send"} disabled={!f.reason.trim()} onClick={submit}>Gửi đơn</Button></div>
        <p className="ad-muted" style={{ fontSize: 12, marginTop: 10 }}>Nếu bạn còn lịch hẹn trong khoảng nghỉ, quản lý sẽ cần đổi hoặc hủy các lịch đó trước khi duyệt.</p>
      </Card>
    </div>
  );
}
