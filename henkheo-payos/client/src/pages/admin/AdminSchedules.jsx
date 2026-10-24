import React, { useEffect, useState } from "react";
import { CalendarOff, Copy, Plus, Save, Trash2 } from "lucide-react";
import { apiGet, apiSend } from "../../lib/api.js";
import { todayISO, dmLabel, addDays } from "../../lib/format.js";
import { Alert, Avatar, Button, Card, EmptyState, Field, IconButton, Input, Pill, Select, Skeleton, Switch, useAction, useUI } from "../../components/admin/kit.jsx";

const DAYS = [
  { value: 1, label: "Thứ 2" }, { value: 2, label: "Thứ 3" }, { value: 3, label: "Thứ 4" }, { value: 4, label: "Thứ 5" },
  { value: 5, label: "Thứ 6" }, { value: 6, label: "Thứ 7" }, { value: 7, label: "Chủ nhật" },
];
const blank = () => DAYS.map((d) => ({ day_of_week: d.value, is_working: false, start_time: "08:00", end_time: "18:00", note: "" }));

export function AdminSchedules({ staffList }) {
  const ui = useUI();
  const { busy, run } = useAction();
  const [staffId, setStaffId] = useState(staffList[0]?.id || "");
  const [week, setWeek] = useState(blank());
  const [dirty, setDirty] = useState(false);
  const [exceptions, setExceptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ex, setEx] = useState({ date: todayISO(), off: true, start: "08:00", end: "18:00", reason: "" });

  const load = async (id = staffId) => {
    if (!id) return;
    setLoading(true); setError("");
    try {
      const [tpl, exc] = await Promise.all([
        apiGet(`/staff-schedules/templates?staffId=${encodeURIComponent(id)}`),
        apiGet(`/staff-schedules/exceptions?staffId=${encodeURIComponent(id)}&from=${encodeURIComponent(todayISO())}&to=${encodeURIComponent(addDays(60))}`),
      ]);
      setExceptions(exc || []);
      setWeek(DAYS.map((d) => { const r = (tpl || []).find((x) => Number(x.day_of_week) === d.value); return { day_of_week: d.value, is_working: !!r?.is_working, start_time: r?.start_time || "08:00", end_time: r?.end_time || "18:00", note: r?.note || "" }; }));
      setDirty(false);
    } catch (e) { setError(e.message || "Không tải được lịch làm việc."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(staffId); }, [staffId]);

  const update = (day, key, value) => { setWeek((p) => p.map((x) => (x.day_of_week === day ? { ...x, [key]: value } : x))); setDirty(true); };
  const applyFirstToAll = () => {
    const src = week.find((w) => w.is_working);
    if (!src) return ui.toast.info("Hãy bật ít nhất một ngày làm việc để làm mẫu.");
    setWeek((p) => p.map((x) => (x.is_working ? { ...x, start_time: src.start_time, end_time: src.end_time } : x)));
    setDirty(true);
    ui.toast.info(`Đã áp dụng ${src.start_time}–${src.end_time} cho mọi ngày làm việc. Nhớ bấm Lưu.`);
  };

  const changeStaff = async (e) => {
    if (dirty && !(await ui.confirm({ title: "Bỏ thay đổi chưa lưu?", message: "Lịch tuần của nhân viên hiện tại có thay đổi chưa lưu.", confirmText: "Bỏ thay đổi", tone: "danger" }))) return;
    setStaffId(e.target.value);
  };

  const saveWeek = async () => {
    const bad = week.find((r) => r.is_working && r.start_time >= r.end_time);
    if (bad) return ui.toast.error(`${DAYS.find((d) => d.value === bad.day_of_week).label}: giờ bắt đầu phải trước giờ kết thúc.`);
    run("week", async () => {
      for (const r of week) {
        await apiSend("/staff-schedules/templates", "PUT", { staffId: Number(staffId), dayOfWeek: Number(r.day_of_week), isWorking: !!r.is_working, startTime: r.start_time, endTime: r.end_time, note: r.note || "" });
      }
      await load();
    }, "Đã lưu lịch làm việc mặc định theo tuần.");
  };

  const saveException = async () => {
    if (!ex.date) return ui.toast.error("Chọn ngày ngoại lệ.");
    if (!ex.off && ex.start >= ex.end) return ui.toast.error("Giờ bắt đầu phải trước giờ kết thúc.");
    run("ex", async () => {
      await apiSend("/staff-schedules/exceptions", "PUT", { staffId: Number(staffId), workDate: ex.date, isDayOff: ex.off, startTime: ex.start, endTime: ex.end, reason: ex.reason.trim() });
      await load(); setEx((p) => ({ ...p, reason: "" }));
    }, ex.off ? "Đã ghi nhận ngày nghỉ ngoại lệ." : "Đã ghi nhận ca làm ngoại lệ.");
  };

  const delException = async (r) => {
    if (!(await ui.confirm({ title: "Xoá ngoại lệ này?", message: `Ngày ${dmLabel(r.work_date)} sẽ quay về lịch mặc định theo tuần.`, confirmText: "Xoá ngoại lệ", tone: "danger" }))) return;
    run(`x${r.id}`, async () => { await apiSend(`/staff-schedules/exceptions/${r.id}`, "DELETE", {}); await load(); }, "Đã xoá ngày ngoại lệ.");
  };

  const staff = staffList.find((s) => String(s.id) === String(staffId));
  if (!staffList.length) return <Card><EmptyState icon={CalendarOff} title="Chưa có nhân viên">Hãy thêm nhân viên trước khi thiết lập lịch làm việc.</EmptyState></Card>;

  return (
    <div className="ad-stack">
      {error && <Alert tone="red">{error}</Alert>}
      <Card title="Lịch mặc định theo tuần" subtitle="Booking luôn ưu tiên ngày ngoại lệ nếu có."
        action={<div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {staff && <Avatar name={staff.full_name} size="sm" />}
          <Select value={staffId} onChange={changeStaff} aria-label="Chọn nhân viên" style={{ width: 230 }}>{staffList.map((s) => <option key={s.id} value={s.id}>{s.employee_code} · {s.full_name}</option>)}</Select>
        </div>}>
        <div style={{ margin: "-4px -22px -22px" }}>
          {loading ? <div style={{ padding: "8px 22px 22px", display: "grid", gap: 10 }}>{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} h={44} />)}</div> : week.map((r) => {
            const day = DAYS.find((d) => d.value === r.day_of_week);
            return (
              <div key={r.day_of_week} className={`ad-day-row ${r.is_working ? "" : "is-off"}`}>
                <b>{day.label}</b>
                <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 500 }}>
                  <Switch checked={r.is_working} onChange={(v) => update(r.day_of_week, "is_working", v)} label={`${day.label}: làm việc`} />
                  <span style={{ color: r.is_working ? "var(--ad-success)" : "var(--ad-ink-3)" }}>{r.is_working ? "Làm việc" : "Nghỉ"}</span>
                </label>
                <Input disabled={!r.is_working} type="time" aria-label={`${day.label} giờ bắt đầu`} value={r.start_time} onChange={(e) => update(r.day_of_week, "start_time", e.target.value)} />
                <Input disabled={!r.is_working} type="time" aria-label={`${day.label} giờ kết thúc`} value={r.end_time} onChange={(e) => update(r.day_of_week, "end_time", e.target.value)} />
                <Input value={r.note} aria-label={`${day.label} ghi chú`} placeholder={r.is_working ? "Ghi chú ca" : "Ví dụ: Nghỉ Chủ nhật"} onChange={(e) => update(r.day_of_week, "note", e.target.value)} />
              </div>
            );
          })}
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, padding: "14px 22px", borderTop: "1px solid var(--ad-line-2)", background: "var(--ad-surface-2)", borderRadius: "0 0 14px 14px" }}>
            <Button variant="ghost" icon={Copy} onClick={applyFirstToAll} disabled={loading}>Áp dụng giờ ca đầu tiên cho mọi ngày làm</Button>
            <Button icon={Save} loading={busy === "week"} disabled={loading || !dirty} onClick={saveWeek}>{dirty ? "Lưu lịch tuần" : "Đã lưu"}</Button>
          </div>
        </div>
      </Card>

      <Card title="Ngày nghỉ / ca ngoại lệ" subtitle="Dùng cho nghỉ phép, nghỉ đột xuất, đi muộn hoặc làm nửa ngày. Ngày này ghi đè lịch mặc định.">
        <div className="ad-grid c4" style={{ alignItems: "end", gap: 14 }}>
          <Field label="Ngày"><Input type="date" min={todayISO()} value={ex.date} onChange={(e) => setEx({ ...ex, date: e.target.value })} /></Field>
          <Field label="Nghỉ cả ngày"><div style={{ height: 40, display: "flex", alignItems: "center", gap: 10 }}><Switch checked={ex.off} onChange={(v) => setEx({ ...ex, off: v })} label="Nghỉ cả ngày" /><span>{ex.off ? "Nghỉ cả ngày" : "Làm theo ca"}</span></div></Field>
          <Field label="Bắt đầu"><Input disabled={ex.off} type="time" value={ex.start} onChange={(e) => setEx({ ...ex, start: e.target.value })} /></Field>
          <Field label="Kết thúc"><Input disabled={ex.off} type="time" value={ex.end} onChange={(e) => setEx({ ...ex, end: e.target.value })} /></Field>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 14 }}>
          <div style={{ flex: "1 1 280px" }}><Input value={ex.reason} aria-label="Lý do" placeholder={ex.off ? "Ví dụ: Nghỉ phép cá nhân" : "Ví dụ: Làm nửa ngày"} onChange={(e) => setEx({ ...ex, reason: e.target.value })} /></div>
          <Button icon={Plus} loading={busy === "ex"} onClick={saveException}>Lưu ngoại lệ</Button>
        </div>

        <div style={{ marginTop: 22 }}>
          <div className="ad-label">Sắp tới trong 60 ngày ({exceptions.length})</div>
          {exceptions.length ? exceptions.map((r) => (
            <div key={r.id} className={`ad-list-row ad-tone-${r.is_day_off ? "red" : "amber"}`}>
              <div className="ad-icon-tile ad-tint" style={{ width: 38, height: 38 }}><CalendarOff size={17} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{dmLabel(r.work_date)} · <span style={{ textTransform: "capitalize" }}>{new Date(`${r.work_date}T00:00:00`).toLocaleDateString("vi-VN", { weekday: "long" })}</span></div>
                <div className="ad-muted" style={{ fontSize: 12.5 }}>{r.reason || "Không có lý do"}</div>
              </div>
              <Pill tone={r.is_day_off ? "red" : "amber"}>{r.is_day_off ? "Nghỉ cả ngày" : `${r.start_time}–${r.end_time}`}</Pill>
              <IconButton icon={Trash2} tone="red" label="Xoá ngoại lệ" disabled={!!busy} onClick={() => delException(r)} />
            </div>
          )) : <div className="ad-muted" style={{ padding: "6px 0" }}>Chưa có ngày ngoại lệ trong 60 ngày tới.</div>}
        </div>
      </Card>
    </div>
  );
}
