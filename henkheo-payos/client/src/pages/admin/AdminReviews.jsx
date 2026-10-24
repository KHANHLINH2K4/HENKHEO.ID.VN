import React, { useEffect, useMemo, useState } from "react";
import { MessageSquareText, Star } from "lucide-react";
import { apiGet, apiSend } from "../../lib/api.js";
import { Alert, Avatar, Card, EmptyState, Pill, SearchInput, Select, Skeleton, StatCard, Switch, Tabs, norm, useAction } from "../../components/admin/kit.jsx";

const Stars = ({ n }) => (
  <span aria-label={`${n} trên 5 sao`} style={{ display: "inline-flex", gap: 2, color: "#F5A623" }}>
    {[1, 2, 3, 4, 5].map((i) => <Star key={i} size={15} fill={i <= n ? "currentColor" : "none"} color={i <= n ? "#F5A623" : "#D5D7E3"} />)}
  </span>
);

export function AdminReviews() {
  const { busy, run } = useAction();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [vis, setVis] = useState("all");
  const [rating, setRating] = useState("all");
  const [query, setQuery] = useState("");

  const load = async () => { try { setRows(await apiGet("/reviews/admin")); setError(""); } catch (e) { setError(e.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const toggle = (r) => run(`v${r.id}`, async () => { await apiSend(`/reviews/${r.id}/visibility`, "PATCH", { isVisible: !r.is_visible }); await load(); }, r.is_visible ? "Đã ẩn đánh giá." : "Đã hiển thị đánh giá.");

  const avg = rows.length ? rows.reduce((s, r) => s + Number(r.rating || 0), 0) / rows.length : 0;
  const shown = useMemo(() => {
    const q = norm(query.trim());
    return rows.filter((r) => (vis === "all" || (vis === "shown" ? r.is_visible : !r.is_visible)) && (rating === "all" || Number(r.rating) === Number(rating))
      && (!q || norm(`${r.customer_name} ${r.service_name} ${r.staff_name} ${r.comment}`).includes(q)));
  }, [rows, vis, rating, query]);

  return (
    <div className="ad-stack">
      <div className="ad-grid c3">
        <StatCard label="Điểm trung bình" value={rows.length ? avg.toFixed(1) : "—"} icon={Star} tone="amber" hint={<>{rows.length} đánh giá</>} loading={loading} />
        <StatCard label="Đang hiển thị" value={rows.filter((r) => r.is_visible).length} icon={MessageSquareText} tone="green" loading={loading} hint="Khách khác nhìn thấy" />
        <StatCard label="Đã ẩn" value={rows.filter((r) => !r.is_visible).length} icon={MessageSquareText} tone="gray" loading={loading} hint="Chỉ quản trị viên thấy" />
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      <Card flush>
        <div className="ad-toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Tìm khách, dịch vụ, nội dung…" />
          <Select value={rating} onChange={(e) => setRating(e.target.value)} aria-label="Lọc theo số sao" style={{ width: 150 }}>
            <option value="all">Mọi số sao</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} sao</option>)}
          </Select>
          <div className="ad-spacer" />
          <Tabs value={vis} onChange={setVis} items={[{ id: "all", label: "Tất cả" }, { id: "shown", label: "Đang hiện" }, { id: "hidden", label: "Đã ẩn" }]} />
        </div>
        <div style={{ padding: "6px 22px 10px" }}>
          {loading ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} h={72} style={{ margin: "14px 0" }} />)
            : shown.map((r) => (
              <div key={r.id} className="ad-list-row" style={{ alignItems: "flex-start", padding: "16px 0", opacity: r.is_visible ? 1 : 0.62 }}>
                <Avatar name={r.customer_name} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", alignItems: "center" }}><b>{r.customer_name}</b><Stars n={Number(r.rating)} />{!r.is_visible && <Pill tone="gray">Đã ẩn</Pill>}</div>
                  <div className="ad-muted" style={{ fontSize: 12.5 }}>{r.service_name} · Nhân viên: {r.staff_name || "—"}</div>
                  {r.comment && <p style={{ marginTop: 8, color: "var(--ad-ink-2)" }}>{r.comment}</p>}
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ad-ink-3)" }}>
                  <span className="ad-hide-sm">{r.is_visible ? "Hiện" : "Ẩn"}</span>
                  <Switch checked={!!r.is_visible} disabled={!!busy} onChange={() => toggle(r)} label={r.is_visible ? "Ẩn đánh giá" : "Hiện đánh giá"} />
                </label>
              </div>
            ))}
          {!loading && !shown.length && <EmptyState icon={Star} title={rows.length ? "Không có đánh giá phù hợp" : "Chưa có đánh giá"}>{rows.length ? "Thử bỏ bớt bộ lọc." : "Đánh giá của khách sau khi hoàn thành dịch vụ sẽ hiện ở đây."}</EmptyState>}
        </div>
      </Card>
    </div>
  );
}
