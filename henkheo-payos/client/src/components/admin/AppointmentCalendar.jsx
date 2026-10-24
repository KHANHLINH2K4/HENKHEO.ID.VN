import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, dmLabel, dowLabel, todayISO } from "../../lib/format.js";
import { Button, Select } from "./kit.jsx";

/* Lịch tuần: mỗi cột là một ngày, các lịch xếp theo giờ, màu theo trạng thái. */
const COLORS = { pending: "#FFB84C", confirmed: "#12B76A", completed: "#6C4CF0", cancelled: "#E5484D", no_show: "#8A869C" };
const mondayOf = (iso) => { const d = new Date(`${iso}T00:00:00`); const shift = (d.getDay() + 6) % 7; return addDays(-shift, iso); };

export function AppointmentCalendar({ appointments, onPick }) {
  const [anchor, setAnchor] = useState(() => mondayOf(todayISO()));
  const [staff, setStaff] = useState("all");
  const [showCancelled, setShowCancelled] = useState(false);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(i, anchor)), [anchor]);
  const staffNames = useMemo(() => [...new Set(appointments.map((a) => a.staff_name).filter(Boolean))].sort(), [appointments]);
  const byDay = useMemo(() => {
    const m = Object.fromEntries(days.map((d) => [d, []]));
    appointments.forEach((a) => {
      const d = String(a.date).slice(0, 10);
      if (!m[d]) return;
      if (staff !== "all" && a.staff_name !== staff) return;
      if (!showCancelled && ["cancelled", "no_show"].includes(a.status)) return;
      m[d].push(a);
    });
    Object.values(m).forEach((list) => list.sort((x, y) => String(x.time).localeCompare(String(y.time))));
    return m;
  }, [appointments, days, staff, showCancelled]);
  const today = todayISO();

  return (
    <div style={{ padding: 16 }}>
      <div className="ad-toolbar" style={{ padding: 0, marginBottom: 12 }}>
        <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={() => setAnchor(addDays(-7, anchor))}>Tuần trước</Button>
        <Button variant="ghost" size="sm" onClick={() => setAnchor(mondayOf(todayISO()))}>Tuần này</Button>
        <Button variant="ghost" size="sm" icon={ChevronRight} onClick={() => setAnchor(addDays(7, anchor))}>Tuần sau</Button>
        <b style={{ marginLeft: 8 }}>{dmLabel(days[0])} – {dmLabel(days[6])}</b>
        <div className="ad-spacer" />
        <label className="ad-muted" style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Hiện lịch huỷ / không đến</label>
        <Select value={staff} onChange={(e) => setStaff(e.target.value)} aria-label="Lọc theo nhân viên" style={{ width: 180 }}>
          <option value="all">Tất cả nhân viên</option>{staffNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
      </div>
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(150px, 1fr))", gap: 8, minWidth: 1100 }}>
          {days.map((d) => (
            <div key={d} style={{ border: "1px solid var(--ad-line, #e6e6ef)", borderRadius: 12, background: d === today ? "rgba(108,76,240,.05)" : "#fff", minHeight: 160 }}>
              <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--ad-line, #e6e6ef)", fontWeight: 600, fontSize: 13 }}>
                {dowLabel(d)} · {dmLabel(d)} <span className="ad-muted" style={{ fontWeight: 400 }}>({byDay[d].length})</span>
              </div>
              <div style={{ padding: 6, display: "grid", gap: 6 }}>
                {byDay[d].length === 0 && <div className="ad-muted" style={{ fontSize: 12, padding: 6 }}>Trống</div>}
                {byDay[d].map((a) => (
                  <button key={a.id} type="button" onClick={() => onPick?.(a)} title={`${a.customer_name} · ${a.service_name}`}
                    style={{ textAlign: "left", border: 0, borderLeft: `4px solid ${COLORS[a.status] || "#999"}`, background: "#f7f7fb", borderRadius: 8, padding: "6px 8px", cursor: "pointer", fontSize: 12, lineHeight: 1.35 }}>
                    <b className="ad-num">{String(a.time).slice(0, 5)}–{String(a.end_time).slice(0, 5)}</b>
                    <div>{a.customer_name}</div>
                    <div className="ad-muted">{a.service_name} · {a.staff_name || "—"}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="ad-muted" style={{ fontSize: 12, marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap" }}>
        {[["pending", "Chờ xác nhận"], ["confirmed", "Đã xác nhận"], ["completed", "Hoàn thành"], ["cancelled", "Đã huỷ"], ["no_show", "Không đến"]].map(([k, l]) => <span key={k}><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: COLORS[k], marginRight: 5 }} />{l}</span>)}
      </div>
    </div>
  );
}
