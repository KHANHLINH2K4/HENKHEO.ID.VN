import React, { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { apiDownload, apiGet } from "../../lib/api.js";
import { formatVND } from "../../lib/format.js";
import { Alert, Button, Card, DataTable, Field, Input, Skeleton, StatCard } from "../../components/admin/kit.jsx";

const iso = (d) => d.toLocaleDateString("en-CA");
const shiftDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const PRESETS = [["7 ngày", 6], ["30 ngày", 29], ["90 ngày", 89], ["12 tháng", 364]];

/* Báo cáo theo khoảng ngày tùy chọn: doanh thu, tỉ lệ hủy/không đến, theo dịch vụ, theo nhân viên; xuất CSV mở bằng Excel. */
export function AdminReports() {
  const [from, setFrom] = useState(shiftDays(-29));
  const [to, setTo] = useState(iso(new Date()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (f = from, t = to) => {
    setLoading(true); setError("");
    try { setData(await apiGet(`/reports/summary?from=${f}&to=${t}`)); }
    catch (e) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { load(); }, []); // tải lần đầu

  const preset = (n) => { const f = shiftDays(-n); const t = iso(new Date()); setFrom(f); setTo(t); load(f, t); };
  const exportCsv = async () => { try { await apiDownload(`/reports/export.csv?from=${from}&to=${to}`, "lich-hen.csv"); } catch (e) { setError(e.message); } };
  const t = data?.totals;
  const maxRevenue = Math.max(1, ...(data?.daily || []).map((d) => d.revenue));

  return (
    <>
      <Card>
        <div className="ad-toolbar" style={{ flexWrap: "wrap", gap: 12, alignItems: "end" }}>
          <Field label="Từ ngày"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Đến ngày"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          <Button icon={RefreshCw} loading={loading} onClick={() => load()}>Xem báo cáo</Button>
          {PRESETS.map(([label, n]) => <Button key={label} variant="ghost" size="sm" onClick={() => preset(n)}>{label}</Button>)}
          <div className="ad-spacer" />
          <Button icon={Download} variant="ghost" onClick={exportCsv}>Xuất CSV</Button>
        </div>
      </Card>
      {error && <div style={{ margin: "12px 0" }}><Alert tone="red">{error}</Alert></div>}
      {loading && !data && <Skeleton h={120} />}
      {t && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, margin: "14px 0" }}>
            <StatCard label="Doanh thu (hoàn thành)" value={formatVND(t.revenue)} tone="teal" hint={`${t.completed} lịch hoàn thành`} />
            <StatCard label="Đã thu" value={formatVND(t.collected)} tone="violet" hint="Theo ngày ghi nhận thanh toán" />
            <StatCard label="Tổng lịch hẹn" value={t.total} tone="amber" hint={`${t.customers} khách · ${t.open} đang chờ/sắp tới`} />
            <StatCard label="Tỉ lệ hủy / không đến" value={`${t.cancel_rate}% / ${t.no_show_rate}%`} tone="violet" hint={`${t.cancelled} hủy · ${t.no_show} không đến`} />
          </div>
          <Card title="Doanh thu theo ngày" subtitle={`${data.from} → ${data.to}`}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 120, overflowX: "auto" }} role="img" aria-label="Biểu đồ cột doanh thu theo ngày">
              {data.daily.map((d) => (
                <div key={d.date} title={`${d.date}: ${formatVND(d.revenue)} · ${d.completed} lịch`} style={{ flex: "1 0 6px", minWidth: 6, height: `${Math.max(2, (d.revenue / maxRevenue) * 100)}%`, background: d.revenue ? "var(--ad-primary, #7c5cff)" : "var(--ad-line, #e5e7eb)", borderRadius: 3 }} />
              ))}
            </div>
          </Card>
          <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
            <Card title="Theo dịch vụ" flush>
              <DataTable rows={data.by_service} noun="dịch vụ" pageSize={10} columns={[
                { key: "name", header: "Dịch vụ", sortable: true, sortValue: (r) => r.name, render: (r) => <b>{r.name}</b> },
                { key: "bookings", header: "Lượt đặt", sortable: true, sortValue: (r) => r.bookings, render: (r) => r.bookings },
                { key: "completed", header: "Hoàn thành", sortable: true, sortValue: (r) => r.completed, render: (r) => r.completed },
                { key: "revenue", header: "Doanh thu", sortable: true, sortValue: (r) => r.revenue, render: (r) => <span className="ad-num">{formatVND(r.revenue)}</span> },
              ]} />
            </Card>
            <Card title="Theo nhân viên" flush>
              <DataTable rows={data.by_staff} noun="nhân viên" pageSize={10} columns={[
                { key: "name", header: "Nhân viên", sortable: true, sortValue: (r) => r.name, render: (r) => <b>{r.name}</b> },
                { key: "bookings", header: "Lượt đặt", sortable: true, sortValue: (r) => r.bookings, render: (r) => r.bookings },
                { key: "completed", header: "Hoàn thành", sortable: true, sortValue: (r) => r.completed, render: (r) => r.completed },
                { key: "no_show", header: "Không đến", sortable: true, sortValue: (r) => r.no_show, render: (r) => r.no_show },
                { key: "revenue", header: "Doanh thu", sortable: true, sortValue: (r) => r.revenue, render: (r) => <span className="ad-num">{formatVND(r.revenue)}</span> },
              ]} />
            </Card>
          </div>
        </>
      )}
    </>
  );
}
