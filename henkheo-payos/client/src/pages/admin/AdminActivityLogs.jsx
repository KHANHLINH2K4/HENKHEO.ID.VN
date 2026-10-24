import React, { useEffect, useMemo, useState } from "react";
import { History, RefreshCcw } from "lucide-react";
import { apiGet } from "../../lib/api.js";
import { Alert, Button, Card, DataTable, EmptyState, Pill, SearchInput, Select, norm } from "../../components/admin/kit.jsx";

const toneOf = (a = "") => { const s = a.toUpperCase(); return /DELETE|CANCEL|REFUND|LOCK|REJECT|FAIL/.test(s) ? "red" : /CREATE|ADD|APPROVE|CONFIRM|PAID|COMPLETE/.test(s) ? "green" : /UPDATE|EDIT|CHANGE|RESCHEDULE/.test(s) ? "amber" : "violet"; };

export function AdminActivityLogs() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [user, setUser] = useState("all");

  const load = async () => { setLoading(true); try { setRows(await apiGet("/activity-logs?limit=300")); setError(""); } catch (e) { setError(e.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const users = useMemo(() => [...new Set(rows.map((r) => r.username || "system"))].sort(), [rows]);
  const shown = useMemo(() => {
    const q = norm(query.trim());
    return rows.filter((r) => (user === "all" || (r.username || "system") === user) && (!q || norm(`${r.action} ${r.description} ${r.username}`).includes(q)));
  }, [rows, query, user]);

  return (
    <div className="ad-stack">
      {error && <Alert tone="red">{error}</Alert>}
      <Card flush>
        <div className="ad-toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Tìm hành động, mô tả…" />
          <Select value={user} onChange={(e) => setUser(e.target.value)} aria-label="Lọc theo người dùng" style={{ width: 180 }}>
            <option value="all">Mọi người dùng</option>{users.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select>
          <div className="ad-spacer" />
          <span className="ad-muted ad-hide-sm">300 thao tác gần nhất</span>
          <Button variant="ghost" icon={RefreshCcw} loading={loading} onClick={load}>Tải lại</Button>
        </div>
        <DataTable rows={shown} loading={loading && !rows.length} pageSize={20} pageSizes={[20, 50, 100]} noun="thao tác" initialSort={{ key: "time", dir: "desc" }}
          empty={<EmptyState icon={History} title="Không có nhật ký phù hợp" />}
          columns={[
            { key: "time", header: "Thời gian", sortable: true, nowrap: true, width: 190, sortValue: (r) => new Date(r.created_at).getTime(), render: (r) => <span className="ad-num">{new Date(r.created_at).toLocaleString("vi-VN")}</span> },
            { key: "user", header: "Người dùng", sortable: true, sortValue: (r) => r.username || "system", render: (r) => <span style={{ fontWeight: 550 }}>{r.username || "system"}</span> },
            { key: "action", header: "Hành động", sortable: true, sortValue: (r) => r.action, render: (r) => <Pill tone={toneOf(r.action)}>{r.action}</Pill> },
            { key: "desc", header: "Mô tả", render: (r) => <span style={{ color: "var(--ad-ink-2)" }}>{r.description || "—"}</span> },
          ]} />
      </Card>
    </div>
  );
}
