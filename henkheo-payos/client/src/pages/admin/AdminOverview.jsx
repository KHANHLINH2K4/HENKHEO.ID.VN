import React, { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { ArrowUpRight, BriefcaseBusiness, CalendarDays, CheckCircle2, ChevronRight, Clock, CreditCard, RefreshCcw, TrendingUp, UserCog, Users, Wallet } from "lucide-react";
import { apiGet } from "../../lib/api.js";
import { C } from "../../lib/theme.js";
import { todayISO, formatVND, dmLabel, addDays, dowLabel } from "../../lib/format.js";
import { Alert, Avatar, Button, Card, DataTable, EmptyState, Input, Pill, Skeleton, StatusPill, cx, fmtCompact } from "../../components/admin/kit.jsx";

const TONES = ["violet", "teal", "coral", "amber", "green"];
const pct = (a, b) => (Number(b) > 0 ? Math.min(100, Math.round((Number(a || 0) / Number(b)) * 100)) : 0);
const up = (v) => String(v || "").toUpperCase();

function ChartTip({ active, payload, label, money }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#181523", color: "#fff", padding: "8px 12px", borderRadius: 10, fontSize: 12.5, boxShadow: "0 10px 24px -8px rgba(0,0,0,.4)" }}>
      <div style={{ opacity: .7, marginBottom: 2 }}>{label}</div>
      <b className="ad-num">{money ? formatVND(payload[0].value) : `${payload[0].value} lịch`}</b>
    </div>
  );
}

function BarsChart({ data, dataKey, money, height = 260, highlightLast }) {
  // SVG không resolve được var() trong thuộc tính stopColor, nên lấy màu thật từ theme.js
  const primary = C.primary, secondary = C.secondary;
  const gid = money ? "adBarMoney" : "adBarCount"; // id ASCII, tránh lỗi url(#...) khi tên có dấu/khoảng trắng
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barCategoryGap="28%">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={money ? primary : secondary} stopOpacity={1} />
              <stop offset="100%" stopColor={money ? primary : secondary} stopOpacity={0.45} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#EEF0F6" />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#8A869C" }} />
          <YAxis tickLine={false} axisLine={false} width={48} allowDecimals={false} tick={{ fontSize: 12, fill: "#8A869C" }} tickFormatter={money ? fmtCompact : undefined} />
          <Tooltip cursor={{ fill: "rgba(108,76,240,.06)" }} content={<ChartTip money={money} />} />
          <Bar dataKey={dataKey} radius={[8, 8, 3, 3]} maxBarSize={44}>
            {data.map((_, i) => <Cell key={i} fill={`url(#${gid})`} fillOpacity={highlightLast && i !== data.length - 1 ? 0.55 : 1} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AdminOverview({ services, appointments, customers = [], staffList = [], onNavigate }) {
  const [reportDate, setReportDate] = useState(todayISO());
  const [sales, setSales] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [section, setSection] = useState("appointments");

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    apiGet(`/admin/stats/sales?date=${encodeURIComponent(reportDate)}`)
      .then((d) => { if (!cancelled) setSales(d); })
      .catch((e) => { if (!cancelled) setError(e.message || "Không tải được thống kê doanh số."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reportDate]);

  const today = todayISO();
  const day = (a) => String(a.date || "").slice(0, 10);
  const todayList = useMemo(() => appointments.filter((a) => day(a) === today && a.status !== "cancelled").sort((a, b) => String(a.time).localeCompare(String(b.time))), [appointments, today]);
  const stats = useMemo(() => ({
    total: appointments.length,
    pending: appointments.filter((a) => a.status === "pending").length,
    confirmed: appointments.filter((a) => a.status === "confirmed").length,
    completed: appointments.filter((a) => a.status === "completed").length,
    reschedule: appointments.filter((a) => a.has_pending_reschedule && !["cancelled", "completed"].includes(a.status)).length,
    awaitingOnline: appointments.filter((a) => a.status === "pending" && up(a.payment?.payment_method) === "ONLINE" && up(a.payment?.payment_status) !== "PAID").length,
  }), [appointments]);
  const next7 = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(i)).map((d) => ({ day: `${dowLabel(d)} ${dmLabel(d)}`, "Lịch hẹn": appointments.filter((a) => day(a) === d && a.status !== "cancelled").length })), [appointments]);

  const s = sales?.summary || {};
  const staffSales = sales?.staff || [];
  const last7 = (sales?.last_7_days || []).map((r) => ({ day: dmLabel(r.date), "Doanh số": Number(r.revenue || 0) }));
  const svcSales = sales?.services || [];
  const svcMax = Math.max(1, ...svcSales.map((r) => Number(r.yearly_revenue || 0)));
  const cust = sales?.customers || {};
  const isToday = reportDate === today;
  const topStaff = [...staffSales].sort((a, b) => Number(b.monthly_revenue || 0) - Number(a.monthly_revenue || 0))[0];
  const topSvc = svcSales[0];
  const topCustomers = useMemo(() => [...customers].sort((a, b) => Number(b.total_spent || 0) - Number(a.total_spent || 0)).slice(0, 8), [customers]);
  const svcRows = useMemo(() => services.map((sv) => { const r = svcSales.find((x) => String(x.service_id) === String(sv.id)); return { ...sv, year_rev: Number(r?.yearly_revenue || 0), year_n: Number(r?.completed_count_year || 0) }; }), [services, svcSales]);

  const attention = [
    { key: "p", n: stats.pending, label: "Lịch chờ xác nhận", tone: "amber", icon: Clock, go: () => onNavigate?.("appointments", { status: "pending" }) },
    { key: "r", n: stats.reschedule, label: "Yêu cầu đổi lịch chờ duyệt", tone: "violet", icon: RefreshCcw, go: () => onNavigate?.("reschedules") },
    { key: "o", n: stats.awaitingOnline, label: "Trong đó chờ khách thanh toán online", tone: "coral", icon: CreditCard, sub: true, go: () => onNavigate?.("appointments", { status: "pending" }) },
  ];
  const attentionTotal = attention.reduce((t, i) => t + (i.sub ? 0 : i.n), 0);

  /* ===== Thanh tổng ngang: bấm vào phần nào thì xem chi tiết phần đó ===== */
  const SEGMENTS = [
    { id: "appointments", label: "Lịch hẹn hôm nay", icon: CalendarDays, tone: "violet", value: todayList.length, hint: <><b>{stats.pending}</b> chờ xác nhận</>, badge: stats.pending, link: "appointments", linkLabel: "Mở quản lý lịch hẹn" },
    { id: "revenue", label: isToday ? "Doanh số hôm nay" : `Doanh số ${dmLabel(reportDate)}`, icon: Wallet, tone: "teal", value: formatVND(s.daily_revenue), hint: <>Tháng này <b>{fmtCompact(s.monthly_revenue)}đ</b></>, loading, link: null },
    { id: "customers", label: "Khách hàng", icon: Users, tone: "coral", value: Number(cust.active_customers ?? customers.length ?? 0).toLocaleString("vi-VN"), hint: <><b>{cust.new_customers_30_days || 0}</b> khách mới / 30 ngày</>, loading, link: "customers", linkLabel: "Mở danh sách khách hàng" },
    { id: "staff", label: "Nhân viên", icon: UserCog, tone: "amber", value: staffList.length, hint: topStaff ? <>Dẫn đầu: <b>{topStaff.full_name}</b></> : "Chưa có doanh số", loading, link: "staff", linkLabel: "Mở quản lý nhân viên" },
    { id: "services", label: "Dịch vụ", icon: BriefcaseBusiness, tone: "green", value: services.length, hint: topSvc ? <>Cao nhất: <b>{topSvc.service_name}</b></> : "Đang cung cấp", loading, link: "services", linkLabel: "Mở quản lý dịch vụ" },
  ];
  const cur = SEGMENTS.find((x) => x.id === section) || SEGMENTS[0];

  return (
    <div className="ad-stack">
      {error && <Alert tone="red">{error}</Alert>}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <p className="ad-muted" style={{ maxWidth: "62ch" }}>Bấm vào từng mục trên thanh tổng để xem chi tiết. Doanh số tính từ các lịch <b>Hoàn thành</b>, theo mức giá đã chốt khi đặt.</p>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <div>
            <label className="ad-label" htmlFor="ad-report-date">Ngày báo cáo</label>
            <Input id="ad-report-date" type="date" value={reportDate} max={today} onChange={(e) => e.target.value && setReportDate(e.target.value)} style={{ width: 170 }} />
          </div>
          {!isToday && <Button variant="ghost" onClick={() => setReportDate(today)}>Hôm nay</Button>}
        </div>
      </div>

      <div className="ad-sumbar" role="tablist" aria-label="Thanh tổng quan">
        {SEGMENTS.map((g) => { const Icon = g.icon; const on = g.id === section; return (
          <button key={g.id} type="button" role="tab" aria-selected={on} aria-controls="ad-sum-panel" onClick={() => setSection(g.id)} className={cx("ad-seg", `ad-tone-${g.tone}`, on && "is-active")}>
            <div className="ad-seg-top">
              <div className="ad-icon-tile ad-tint"><Icon size={19} /></div>
              {g.badge > 0 && <span className="ad-pill ad-num" style={{ background: "var(--ad-accent)", color: "#fff" }}>{g.badge} mới</span>}
              <ArrowUpRight size={16} className="ad-seg-arrow" />
            </div>
            <div className="ad-kpi-label">{g.label}</div>
            {g.loading ? <div className="ad-skel" style={{ height: 28, width: 110, marginTop: 6 }} /> : <div className="ad-kpi-value ad-num ad-truncate">{g.value}</div>}
            <div className="ad-kpi-hint ad-truncate">{g.hint}</div>
          </button>); })}
      </div>

      <div id="ad-sum-panel" role="tabpanel" key={section} className="ad-stack" style={{ animation: "ad-fade .3s var(--ad-ease) both" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 17, fontWeight: 650, display: "flex", alignItems: "center", gap: 10 }}><span className={`ad-dot ad-tone-${cur.tone}`} />Chi tiết · {cur.id === "revenue" ? "Doanh số" : cur.id === "appointments" ? "Lịch hẹn" : cur.label}</h2>
          {cur.link && <Button variant="ghost" size="sm" onClick={() => onNavigate?.(cur.link)}>{cur.linkLabel}<ChevronRight size={14} /></Button>}
        </div>

        {section === "appointments" && <>
          <div className="ad-grid main-side">
            <Card title="Lịch hẹn hôm nay" subtitle={`${todayList.length} lịch, sắp xếp theo giờ`} flush>
              <DataTable rows={todayList} pageSize={6} pageSizes={[6]} noun="lịch" empty={<EmptyState icon={CalendarDays} title="Hôm nay chưa có lịch hẹn" />}
                columns={[
                  { key: "time", header: "Giờ", width: 80, nowrap: true, render: (a) => <b className="ad-num">{String(a.time).slice(0, 5)}</b> },
                  { key: "customer", header: "Khách hàng", render: (a) => <div className="ad-cell-user"><Avatar name={a.customer_name} size="sm" /><div><b>{a.customer_name}</b><small>{a.customer_phone}</small></div></div> },
                  { key: "service", header: "Dịch vụ", render: (a) => a.service_name },
                  { key: "staff", header: "Nhân viên", render: (a) => a.staff_name || "—" },
                  { key: "status", header: "Trạng thái", render: (a) => <StatusPill status={a.status} /> },
                ]} />
            </Card>
            <Card title="Cần xử lý" subtitle={attentionTotal ? `${attentionTotal} việc đang chờ bạn` : "Bạn đã xử lý hết"}>
              {attentionTotal === 0
                ? <EmptyState icon={CheckCircle2} title="Mọi thứ đều ổn">Không có lịch chờ xác nhận hay yêu cầu đổi lịch nào.</EmptyState>
                : attention.filter((i) => !i.sub || i.n > 0).map((i) => { const Icon = i.icon; return (
                  <button key={i.key} type="button" className={`ad-list-row ad-tone-${i.tone}`} onClick={i.go} disabled={!i.n} style={{ opacity: i.n ? 1 : 0.5 }}>
                    <div className="ad-icon-tile ad-tint" style={{ width: 38, height: 38 }}><Icon size={18} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600 }}>{i.label}</div></div>
                    <b className="ad-display ad-num" style={{ fontSize: 20, color: i.n ? "var(--t)" : "inherit" }}>{i.n}</b>
                    <ChevronRight size={16} className="ad-chev" />
                  </button>); })}
            </Card>
          </div>
          <Card title="Lịch hẹn 7 ngày tới" subtitle="Không tính lịch đã huỷ">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
              {[["Tổng lịch", stats.total, "violet", null], ["Chờ xác nhận", stats.pending, "amber", "pending"], ["Đã xác nhận", stats.confirmed, "green", "confirmed"], ["Hoàn thành", stats.completed, "teal", "completed"]].map(([l, v, t, st]) => (
                <button key={l} type="button" onClick={() => onNavigate?.("appointments", st ? { status: st } : null)} className={`ad-chip-stat ad-tone-${t} ad-tint`}>
                  <div style={{ fontSize: 12, color: "var(--ad-ink-2)" }}>{l}</div>
                  <div className="ad-display ad-num" style={{ fontSize: 22, fontWeight: 700 }}>{v}</div>
                </button>
              ))}
            </div>
            <BarsChart data={next7} dataKey="Lịch hẹn" height={220} />
          </Card>
        </>}

        {section === "revenue" && <>
          <div className="ad-grid c3">
            {[["Ngày", s.daily_revenue, s.daily_collected, s.daily_completed, "teal"], ["Tháng", s.monthly_revenue, s.monthly_collected, s.monthly_completed, "violet"], ["Năm", s.yearly_revenue, s.yearly_collected, s.yearly_completed, "amber"]].map(([label, rev, col, n, tone]) => (
              <div key={label} className={`ad-card ad-hoverable ad-tone-${tone}`} style={{ padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span className="ad-muted" style={{ fontWeight: 500 }}>Doanh số {label.toLowerCase()}</span><span className="ad-pill ad-num">{n || 0} lịch</span></div>
                {loading ? <Skeleton h={30} w={140} style={{ marginTop: 10 }} /> : <div className="ad-display ad-num" style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>{formatVND(rev)}</div>}
                <div className="ad-bar" style={{ marginTop: 14 }}><span style={{ width: `${pct(col, rev)}%` }} /></div>
                <div className="ad-muted ad-num" style={{ fontSize: 12.5, marginTop: 8 }}>Đã thu {formatVND(col)} · {pct(col, rev)}%</div>
              </div>
            ))}
          </div>
          <Card title="Doanh số 7 ngày gần nhất" subtitle="Tính theo ngày hoàn thành lịch hẹn" action={<TrendingUp size={19} className="ad-muted" />}>
            {loading ? <Skeleton h={260} /> : last7.length ? <BarsChart data={last7} dataKey="Doanh số" money highlightLast /> : <EmptyState icon={TrendingUp} title="Chưa có dữ liệu doanh số" />}
          </Card>
        </>}

        {section === "customers" && <>
          <div className="ad-grid c4">
            {[["Khách đang hoạt động", cust.active_customers, "violet", Users], ["Khách mới 30 ngày", cust.new_customers_30_days, "teal", TrendingUp], ["Khách quay lại 30 ngày", cust.returning_customers_30_days, "coral", RefreshCcw], [`Lịch hoàn thành ${isToday ? "hôm nay" : dmLabel(reportDate)}`, cust.completed_appointments_day, "amber", CheckCircle2]].map(([l, v, t, Icon]) => (
              <div key={l} className={`ad-card ad-hoverable ad-tone-${t}`} style={{ padding: 18 }}>
                <div className="ad-icon-tile ad-tint" style={{ width: 36, height: 36, borderRadius: 10 }}><Icon size={17} /></div>
                {loading ? <Skeleton h={28} w={70} style={{ marginTop: 12 }} /> : <div className="ad-display ad-num" style={{ fontSize: 28, fontWeight: 700, marginTop: 10 }}>{Number(v || 0).toLocaleString("vi-VN")}</div>}
                <div className="ad-muted" style={{ fontSize: 12.5 }}>{l}</div>
              </div>
            ))}
          </div>
          <Card title="Khách chi tiêu cao nhất" subtitle="Top 8 theo tổng chi tiêu" flush>
            <DataTable rows={topCustomers} pageSize={8} pageSizes={[8]} noun="khách" empty={<EmptyState icon={Users} title="Chưa có dữ liệu khách hàng" />}
              columns={[
                { key: "name", header: "Khách hàng", render: (c) => <div className="ad-cell-user"><Avatar name={c.full_name} /><div><b>{c.full_name}</b><small>{c.phone || c.email || "—"}</small></div></div> },
                { key: "n", header: "Số lịch", align: "right", render: (c) => <span className="ad-num">{c.appointment_count || 0}</span> },
                { key: "spent", header: "Tổng chi tiêu", align: "right", render: (c) => <b className="ad-num">{formatVND(c.total_spent)}</b> },
                { key: "state", header: "", render: (c) => <Pill tone={c.is_active ? "green" : "red"} dot>{c.is_active ? "Hoạt động" : "Đã khoá"}</Pill> },
              ]} />
          </Card>
        </>}

        {section === "staff" && (
          <Card title="Doanh số từng nhân viên" subtitle="Nhấn tiêu đề cột để sắp xếp" flush>
            <DataTable rows={staffSales} rowKey="staff_id" loading={loading} pageSize={10} noun="nhân viên" initialSort={{ key: "monthly", dir: "desc" }} empty={<EmptyState icon={UserCog} title="Chưa có dữ liệu nhân viên" />}
              columns={[
                { key: "name", header: "Nhân viên", sortable: true, sortValue: (r) => r.full_name, render: (r) => <div className="ad-cell-user"><Avatar name={r.full_name} /><div><b>{r.full_name}</b><small>{r.employee_code}</small></div></div> },
                { key: "daily", header: "Hôm nay", sortable: true, sortValue: (r) => Number(r.daily_revenue || 0), render: (r) => <span className="ad-num">{formatVND(r.daily_revenue)}</span> },
                { key: "monthly", header: "Tháng này", sortable: true, sortValue: (r) => Number(r.monthly_revenue || 0), render: (r) => <b className="ad-num">{formatVND(r.monthly_revenue)}</b> },
                { key: "yearly", header: "Năm này", sortable: true, sortValue: (r) => Number(r.yearly_revenue || 0), render: (r) => <span className="ad-num">{formatVND(r.yearly_revenue)}</span> },
                { key: "collected", header: "Đã thu năm", sortable: true, sortValue: (r) => Number(r.yearly_collected || 0), render: (r) => <span className="ad-num">{formatVND(r.yearly_collected)}</span> },
                { key: "done", header: "Lịch HT / năm", sortable: true, sortValue: (r) => Number(r.yearly_completed || 0), align: "right", render: (r) => <span className="ad-num">{r.yearly_completed || 0}</span> },
              ]} />
          </Card>
        )}

        {section === "services" && (
          <div className="ad-grid main-side">
            <Card title="Dịch vụ" subtitle="Doanh thu lũy kế trong năm của ngày báo cáo" flush>
              <DataTable rows={svcRows} pageSize={8} pageSizes={[8]} noun="dịch vụ" initialSort={{ key: "rev", dir: "desc" }} empty={<EmptyState icon={BriefcaseBusiness} title="Chưa có dịch vụ" />}
                columns={[
                  { key: "name", header: "Dịch vụ", sortable: true, sortValue: (r) => r.name, render: (r) => <b>{r.name}</b> },
                  { key: "dur", header: "Thời lượng", sortable: true, sortValue: (r) => Number(r.duration), render: (r) => <span className="ad-num">{r.duration} phút</span> },
                  { key: "price", header: "Giá", sortable: true, sortValue: (r) => Number(r.price), render: (r) => <span className="ad-num">{formatVND(r.price)}</span> },
                  { key: "n", header: "Lượt HT", sortable: true, sortValue: (r) => r.year_n, align: "right", render: (r) => <span className="ad-num">{r.year_n}</span> },
                  { key: "rev", header: "Doanh thu năm", sortable: true, sortValue: (r) => r.year_rev, align: "right", render: (r) => <b className="ad-num">{formatVND(r.year_rev)}</b> },
                ]} />
            </Card>
            <Card title="Xếp hạng doanh thu" subtitle="Top 6 dịch vụ">
              {loading ? <Skeleton h={200} /> : svcSales.length ? svcSales.slice(0, 6).map((r, i) => (
                <div key={r.service_id} className="ad-list-row" style={{ alignItems: "stretch", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ minWidth: 0 }}><div className="ad-truncate" style={{ fontWeight: 600 }}>{r.service_name}</div><div className="ad-muted" style={{ fontSize: 12 }}>{r.completed_count_year || 0} lượt hoàn thành</div></div>
                    <b className="ad-num" style={{ whiteSpace: "nowrap", color: "var(--ad-ink-2)" }}>{formatVND(r.yearly_revenue)}</b>
                  </div>
                  <div className={`ad-bar ad-tone-${TONES[i % TONES.length]}`}><span style={{ width: `${pct(r.yearly_revenue, svcMax)}%` }} /></div>
                </div>
              )) : <EmptyState icon={Wallet} title="Chưa có doanh số theo dịch vụ" />}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
