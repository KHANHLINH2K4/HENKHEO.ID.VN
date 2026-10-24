import React, { useEffect, useMemo, useState } from "react";
import { Plus, AlertCircle, Briefcase, CalendarCheck, CalendarDays, Check, CheckCircle2, Clock, CreditCard, LayoutDashboard, Save, UserRound, Wallet, X, CalendarX2 } from "lucide-react";
import { apiGet, apiSend } from "../lib/api.js";
import { todayISO, formatVND, dmLabel, addDays } from "../lib/format.js";
import { AdminUIProvider, Alert, Avatar, Button, Card, DataTable, EmptyState, Field, IconButton, Input, Pill, SearchInput, Skeleton, StatCard, StatusPill, Tabs, norm, useAction, useUI } from "../components/admin/kit.jsx";
import { PortalShell } from "../components/admin/PortalShell.jsx";
import { ManualBookingModal } from "../components/admin/ManualBookingModal.jsx";
import { AppointmentCalendar } from "../components/admin/AppointmentCalendar.jsx";
import { StaffTimeOff } from "./StaffTimeOff.jsx";

const GROUPS = [
  { title: "Công việc", items: [
    { id: "overview", label: "Tổng quan", icon: LayoutDashboard, description: "Lịch trong ngày và doanh số cá nhân của bạn." },
    { id: "appointments", label: "Lịch hẹn của tôi", icon: CalendarCheck, badge: "pending", description: "Chỉ hiển thị những lịch được phân công cho tài khoản nhân viên này." },
    { id: "schedule", label: "Lịch làm việc", icon: CalendarDays, description: "14 ngày tới, do quản lý thiết lập (lịch tuần + ngày nghỉ / ca đặc biệt)." },
    { id: "timeoff", label: "Xin nghỉ", icon: CalendarX2, description: "Gửi đơn xin nghỉ; quản lý duyệt thì ngày nghỉ tự áp vào lịch làm việc." },
  ]},
  { title: "Cá nhân", items: [
    { id: "services", label: "Dịch vụ được giao", icon: Briefcase, description: "Những dịch vụ bạn có thể nhận lịch." },
    { id: "profile", label: "Hồ sơ", icon: UserRound, description: "Cập nhật thông tin liên hệ. Mã nhân viên và quyền truy cập do quản trị viên quản lý." },
  ]},
];
const VALID = new Set(GROUPS.flatMap((g) => g.items.map((i) => i.id)));
const up = (v) => String(v || "").toUpperCase();
const dayOf = (a) => String(a.date || "").slice(0, 10);
const TABS = [["all", "Tất cả"], ["pending", "Chờ xác nhận"], ["confirmed", "Đã xác nhận"], ["completed", "Hoàn thành"], ["cancelled", "Đã huỷ"]];

function StaffInner({ user, appointments, refreshAppointments, setView, initialTab = "overview", onTabChange, onLogout, unreadCount, onRefreshNotifications, onOpenNotification }) {
  const ui = useUI();
  const { busy, run } = useAction();
  const [tab, setTab] = useState(VALID.has(initialTab) ? initialTab : "overview");
  useEffect(() => { if (initialTab && VALID.has(initialTab)) setTab(initialTab); }, [initialTab]);
  const go = (id) => { setTab(id); onTabChange?.(id); };

  const [reportDate, setReportDate] = useState(todayISO());
  const [profile, setProfile] = useState(null);
  const [assigned, setAssigned] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [apptMode, setApptMode] = useState("list");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [me, services, rows, st] = await Promise.all([
        apiGet("/staff-portal/me"), apiGet("/staff-portal/services"),
        apiGet(`/staff-portal/schedule?from=${encodeURIComponent(reportDate)}&to=${encodeURIComponent(addDays(13, reportDate))}`),
        apiGet(`/staff-portal/stats?date=${encodeURIComponent(reportDate)}`),
      ]);
      setProfile(me); setAssigned(services); setSchedule(rows); setStats(st);
      await refreshAppointments();
    } catch (e) { setError(e.message || "Không tải được khu vực nhân viên."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [user?.id, reportDate]);

  const updateStatus = async (a, next) => {
    const body = { status: next };
    if (next === "cancelled") {
      const reason = await ui.prompt({ title: "Huỷ lịch hẹn", message: `${a.customer_name} · ${a.service_name} · ${dmLabel(a.date)} ${a.time}`, label: "Lý do huỷ (khách sẽ nhận được thông báo)", multiline: true, requiredMessage: "Vui lòng nhập lý do huỷ lịch.", confirmText: "Huỷ lịch", tone: "danger", cancelText: "Giữ lịch" });
      if (!reason) return;
      body.cancellationReason = reason;
    }
    if (next === "completed" && !(await ui.confirm({ title: "Đánh dấu hoàn thành?", message: `Lịch của ${a.customer_name} sẽ được tính vào doanh số của bạn.`, confirmText: "Hoàn thành" }))) return;
    if (next === "no_show" && !(await ui.confirm({ title: "Khách không đến?", message: `Ghi nhận ${a.customer_name} không đến lịch này.`, confirmText: "Ghi nhận", tone: "danger" }))) return;
    run(`${a.id}:${next}`, async () => {
      await apiSend(`/appointments/${a.id}`, "PATCH", body);
      await refreshAppointments();
      setStats(await apiGet(`/staff-portal/stats?date=${encodeURIComponent(reportDate)}`));
    }, "Đã cập nhật lịch hẹn.");
  };
  const collect = async (a) => {
    if (!(await ui.confirm({ title: "Xác nhận đã thu tiền?", message: `Ghi nhận thanh toán tại cơ sở của ${a.customer_name}.`, confirmText: "Đã thu tiền" }))) return;
    run(`${a.id}:collect`, async () => { await apiSend(`/payments/${a.id}/collect`, "PATCH", {}); await refreshAppointments(); }, "Đã ghi nhận thanh toán tại cơ sở.");
  };
  const saveProfile = () => run("profile", async () => {
    await apiSend("/staff-portal/profile", "PATCH", { phone: profile?.phone || "", email: profile?.email || "", avatarUrl: profile?.avatar_url || "" });
    await load();
  }, "Cập nhật hồ sơ thành công.");

  const rowBusy = (a) => !!busy && String(busy).startsWith(`${a.id}:`);
  const actions = (a) => {
    const onlineUnpaid = up(a.payment?.payment_method) === "ONLINE" && up(a.payment?.payment_status) !== "PAID";
    return (
      <div className="ad-row-actions">
        {a.status === "pending" && !onlineUnpaid && <IconButton icon={Check} tone="green" label="Xác nhận lịch" disabled={rowBusy(a)} onClick={() => updateStatus(a, "confirmed")} />}
        {a.status === "confirmed" && <IconButton icon={CheckCircle2} tone="violet" label="Đánh dấu hoàn thành" disabled={rowBusy(a)} onClick={() => updateStatus(a, "completed")} />}
        {a.status === "confirmed" && <IconButton icon={AlertCircle} tone="gray" label="Khách không đến" disabled={rowBusy(a)} onClick={() => updateStatus(a, "no_show")} />}
        {up(a.payment?.payment_method) === "AT_STORE" && up(a.payment?.payment_status) === "PENDING" && <IconButton icon={CreditCard} tone="violet" label="Thu tiền tại cơ sở" disabled={rowBusy(a)} onClick={() => collect(a)} />}
        {["pending", "confirmed"].includes(a.status) && <IconButton icon={X} tone="red" label="Huỷ lịch" disabled={rowBusy(a)} onClick={() => updateStatus(a, "cancelled")} />}
      </div>
    );
  };

  const dayList = useMemo(() => appointments.filter((a) => dayOf(a) === reportDate).sort((a, b) => String(a.time || "").localeCompare(String(b.time || ""))), [appointments, reportDate]);
  const counts = useMemo(() => ({ pending: appointments.filter((a) => a.status === "pending").length }), [appointments]);
  const tabCounts = useMemo(() => { const c = { all: appointments.length }; appointments.forEach((a) => { c[a.status] = (c[a.status] || 0) + 1; }); return c; }, [appointments]);
  const rows = useMemo(() => {
    const q = norm(query.trim());
    return appointments.filter((a) => (status === "all" || a.status === status) && (!q || norm(`${a.customer_name} ${a.customer_phone} ${a.service_name}`).includes(q)));
  }, [appointments, status, query]);
  const isToday = reportDate === todayISO();
  const name = profile?.full_name || user?.full_name;

  const dateField = (
    <div>
      <label className="ad-label" htmlFor="st-date">Ngày xem</label>
      <Input id="st-date" type="date" value={reportDate} onChange={(e) => e.target.value && setReportDate(e.target.value)} style={{ width: 170 }} />
    </div>
  );

  return (
    <PortalShell groups={GROUPS} tab={tab} onNavigate={go} counts={counts} brandSub="NHÂN VIÊN" crumbRoot="Nhân viên" roleText={profile?.position || "Nhân viên"} miniKey="henkheo_staff_sidebar_mini"
      user={user} onLogout={onLogout} onExit={() => setView("home")} unreadCount={unreadCount} onRefreshNotifications={onRefreshNotifications} onOpenNotification={onOpenNotification}
      headerExtra={(tab === "overview" || tab === "schedule") ? dateField : null}>
      {error && <div style={{ marginBottom: 16 }}><Alert tone="red" onClose={() => setError("")}>{error}</Alert></div>}

      {tab === "overview" && (
        <div className="ad-stack">
          <div className="ad-hero-card">
            <div style={{ fontSize: 13, opacity: .85, fontWeight: 600 }}>{isToday ? "Hôm nay" : `Ngày ${dmLabel(reportDate)}`}</div>
            <h2 className="ad-display" style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>Xin chào, {name || "bạn"} 👋</h2>
            <p style={{ opacity: .9, marginTop: 6, maxWidth: "60ch" }}>{dayList.length ? `Bạn có ${dayList.length} lịch hẹn trong ngày${dayList.filter((a) => a.status === "pending").length ? `, ${dayList.filter((a) => a.status === "pending").length} lịch đang chờ xác nhận` : ""}.` : "Hôm nay bạn chưa có lịch hẹn nào."}</p>
          </div>
          <div className="ad-grid c3">
            <StatCard label="Doanh số ngày" value={formatVND(stats?.daily_revenue)} icon={Wallet} tone="teal" loading={loading} hint={<><b>{stats?.daily_completed || 0}</b> hoàn thành · thu {formatVND(stats?.daily_collected)}</>} />
            <StatCard label="Doanh số tháng" value={formatVND(stats?.monthly_revenue)} icon={Wallet} tone="violet" loading={loading} hint={<><b>{stats?.monthly_completed || 0}</b> hoàn thành · thu {formatVND(stats?.monthly_collected)}</>} />
            <StatCard label="Doanh số năm" value={formatVND(stats?.yearly_revenue)} icon={Wallet} tone="amber" loading={loading} hint={<><b>{stats?.yearly_completed || 0}</b> hoàn thành · thu {formatVND(stats?.yearly_collected)}</>} />
          </div>
          <div className="ad-grid main-side">
            <Card title={`Lịch hẹn ngày ${dmLabel(reportDate)}`} subtitle={`${dayList.length} lịch`} flush>
              {dayList.length ? dayList.map((a) => (
                <div key={a.id} className="ad-list-row" style={{ padding: "14px 22px" }}>
                  <b className="ad-num" style={{ width: 52 }}>{String(a.time).slice(0, 5)}</b>
                  <div className="ad-cell-user" style={{ flex: 1 }}><Avatar name={a.customer_name} size="sm" /><div><b>{a.customer_name}</b><small>{a.service_name} · {a.customer_phone || "—"}</small></div></div>
                  <StatusPill status={a.status} />{actions(a)}
                </div>
              )) : <EmptyState icon={CalendarX2} title="Chưa có lịch hẹn trong ngày" />}
            </Card>
            <Card title="Thông tin nhân viên">
              {[["Mã nhân viên", profile?.employee_code], ["Chức vụ", profile?.position], ["Tài khoản", profile?.username || user?.username], ["Dịch vụ được giao", assigned.length]].map(([l, v]) => (
                <div key={l} className="ad-list-row" style={{ justifyContent: "space-between" }}><span className="ad-muted">{l}</span><b>{v ?? "—"}</b></div>
              ))}
              <Button variant="ghost" style={{ marginTop: 16, width: "100%" }} onClick={() => go("appointments")}>Xem toàn bộ lịch hẹn</Button>
            </Card>
          </div>
        </div>
      )}

      <ManualBookingModal open={manualOpen} onClose={() => setManualOpen(false)} services={assigned} role="STAFF" onCreated={refreshAppointments} />
      {tab === "timeoff" && <StaffTimeOff />}
      {tab === "appointments" && (
        <Card flush>
          <div className="ad-toolbar">
            <Button icon={Plus} size="sm" onClick={() => setManualOpen(true)} disabled={!assigned.length}>Tạo lịch hộ khách</Button>
            <Tabs value={apptMode} onChange={setApptMode} items={[{ id: "list", label: "Danh sách" }, { id: "calendar", label: "Lịch tuần" }]} />
            <SearchInput value={query} onChange={setQuery} placeholder="Tìm khách, SĐT, dịch vụ…" />
            <div className="ad-spacer" />
            <Tabs value={status} onChange={setStatus} items={TABS.map(([id, label]) => ({ id, label, count: tabCounts[id] || 0 }))} />
          </div>
          {apptMode === "calendar" ? <AppointmentCalendar appointments={rows} /> :
          <DataTable rows={rows} noun="lịch" initialSort={{ key: "when", dir: "desc" }} empty={<EmptyState icon={CalendarX2} title="Không có lịch hẹn phù hợp" />}
            columns={[
              { key: "when", header: "Ngày giờ", sortable: true, nowrap: true, sortValue: (a) => `${dayOf(a)} ${String(a.time).slice(0, 5)}`, render: (a) => <><b className="ad-num">{dmLabel(a.date)}</b> <span className="ad-muted ad-num">· {String(a.time).slice(0, 5)}</span></> },
              { key: "customer", header: "Khách hàng", sortable: true, sortValue: (a) => a.customer_name, render: (a) => <div className="ad-cell-user"><Avatar name={a.customer_name} /><div><b>{a.customer_name}</b><small>{a.customer_phone || "—"}</small></div></div> },
              { key: "service", header: "Dịch vụ", render: (a) => a.service_name },
              { key: "status", header: "Trạng thái", sortable: true, sortValue: (a) => a.status, render: (a) => <StatusPill status={a.status} /> },
              { key: "act", header: "", align: "right", width: 170, render: actions },
            ]} />}
        </Card>
      )}

      {tab === "schedule" && (
        <div className="ad-stack">
          <div className="ad-muted">{schedule.filter((r) => r.is_working).length} ngày làm · {schedule.filter((r) => !r.is_working).length} ngày nghỉ. Liên hệ quản lý nếu cần thay đổi.</div>
          <div className="ad-grid c3" style={{ gap: 16 }}>
            {loading && !schedule.length ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={120} style={{ borderRadius: 14 }} />) : schedule.map((row) => {
              const wd = ["", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"][row.weekday] || "";
              const isTd = row.work_date === todayISO();
              return (
                <div key={row.work_date} className={`ad-card ad-hoverable ad-tone-${row.is_working ? "green" : "gray"}`} style={{ padding: 18, borderColor: isTd ? "var(--ad-primary)" : undefined, borderWidth: isTd ? 1.5 : 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <b>{wd} · {dmLabel(row.work_date)}{isTd && <span style={{ color: "var(--ad-primary)", fontSize: 10.5, marginLeft: 8, letterSpacing: ".06em" }}>HÔM NAY</span>}</b>
                    <Pill tone={row.is_working ? "green" : "gray"} dot>{row.is_working ? "Làm việc" : "Nghỉ"}</Pill>
                  </div>
                  {row.is_working ? <div style={{ marginTop: 12 }}>{row.shifts.map((sh, i) => <div key={i} className="ad-display ad-num" style={{ fontSize: 24, fontWeight: 700 }}>{sh.start_time} – {sh.end_time}</div>)}</div>
                    : <div className="ad-display ad-muted" style={{ fontSize: 22, fontWeight: 700, marginTop: 12 }}>Nghỉ</div>}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 10 }}>
                    <span className="ad-muted" style={{ fontSize: 12.5 }}>{row.note || (row.is_working ? "Ca làm việc" : "Không làm việc")}{row.source === "EXCEPTION" && <b style={{ color: "#B8730B" }}> · Điều chỉnh riêng</b>}</span>
                    {row.appointment_count > 0 && <span className="ad-pill ad-tint ad-tone-violet ad-num">{row.appointment_count} lịch hẹn</span>}
                  </div>
                </div>
              );
            })}
          </div>
          {!loading && !schedule.length && <Card><EmptyState icon={Clock} title="Chưa có lịch làm việc">Hãy liên hệ quản lý để thiết lập lịch.</EmptyState></Card>}
        </div>
      )}

      {tab === "services" && (
        <div className="ad-grid c3" style={{ gap: 16 }}>
          {assigned.map((s) => (
            <div key={s.id} className="ad-card ad-hoverable" style={{ padding: 20 }}>
              <span className="ad-pill ad-tint ad-tone-violet">{s.category_name}</span>
              <div className="ad-display" style={{ fontSize: 18, fontWeight: 700, marginTop: 10 }}>{s.name}</div>
              <div className="ad-muted ad-num" style={{ marginTop: 4 }}>{s.duration} phút · <b style={{ color: "var(--ad-ink)" }}>{formatVND(s.price)}</b></div>
              <p className="ad-muted" style={{ marginTop: 10, fontSize: 13 }}>{s.description || "—"}</p>
            </div>
          ))}
          {!assigned.length && <div style={{ gridColumn: "1 / -1" }}><Card><EmptyState icon={Briefcase} title="Chưa được phân công dịch vụ nào">Quản lý sẽ phân công dịch vụ cho bạn.</EmptyState></Card></div>}
        </div>
      )}

      {tab === "profile" && (
        <Card title="Hồ sơ nhân viên" subtitle="Các trường màu xám do quản trị viên quản lý." className="" style={{ maxWidth: 760 }}>
          <div className="ad-form-grid">
            <Field label="Mã nhân viên"><Input value={profile?.employee_code || ""} disabled /></Field>
            <Field label="Tài khoản"><Input value={profile?.username || ""} disabled /></Field>
            <Field label="Họ và tên"><Input value={profile?.full_name || ""} disabled /></Field>
            <Field label="Chức vụ"><Input value={profile?.position || ""} disabled /></Field>
            <Field label="Số điện thoại"><Input value={profile?.phone || ""} inputMode="tel" onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={profile?.email || ""} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></Field>
          </div>
          <div style={{ marginTop: 20 }}><Button icon={Save} loading={busy === "profile"} onClick={saveProfile}>Lưu hồ sơ</Button></div>
        </Card>
      )}
    </PortalShell>
  );
}

export function StaffPage(props) {
  return <AdminUIProvider><StaffInner {...props} /></AdminUIProvider>;
}
