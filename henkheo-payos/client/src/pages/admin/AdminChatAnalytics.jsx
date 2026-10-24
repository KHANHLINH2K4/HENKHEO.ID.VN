import React, { useEffect, useState } from "react";
import { Bot, MessageSquare, MessagesSquare, Target, HelpCircle, RefreshCcw } from "lucide-react";
import { apiGet } from "../../lib/api.js";
import { Alert, Button, Card, DataTable, EmptyState, StatCard } from "../../components/admin/kit.jsx";

const pc = (v) => `${(Number(v || 0) * 100).toFixed(1)}%`;
const tone = (v) => (Number(v) >= 0.8 ? "green" : Number(v) >= 0.5 ? "amber" : "red");

export function AdminChatAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async () => { setLoading(true); try { setData(await apiGet("/chat/admin/analytics")); setError(""); } catch (e) { setError(e.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  const sm = data?.summary || {};

  return (
    <div className="ad-stack">
      {error && <Alert tone="red">{error}</Alert>}
      <div className="ad-grid c3">
        <StatCard label="Tin nhắn" value={Number(sm.total_messages || 0).toLocaleString("vi-VN")} icon={MessageSquare} tone="violet" loading={loading} hint="Tổng số tin khách gửi" />
        <StatCard label="Cuộc hội thoại" value={Number(sm.total_conversations || 0).toLocaleString("vi-VN")} icon={MessagesSquare} tone="teal" loading={loading} hint="Số phiên chat" />
        <StatCard label="Confidence trung bình" value={pc(sm.avg_confidence)} icon={Target} tone={tone(sm.avg_confidence)} loading={loading} hint="Độ chắc chắn khi nhận diện ý định" />
      </div>
      <div className="ad-grid main-side">
        <Card title="Phân tích intent" subtitle="Ý định chatbot nhận diện được" flush action={<Button variant="ghost" size="sm" icon={RefreshCcw} loading={loading} onClick={load}>Tải lại</Button>}>
          <DataTable rows={data?.intents || []} rowKey="intent" loading={loading} noun="intent" initialSort={{ key: "count", dir: "desc" }}
            empty={<EmptyState icon={Bot} title="Chưa có dữ liệu intent" />}
            columns={[
              { key: "intent", header: "Intent", sortable: true, render: (r) => <b>{r.intent}</b> },
              { key: "count", header: "Tin nhắn", sortable: true, sortValue: (r) => Number(r.message_count), align: "right", render: (r) => <span className="ad-num">{r.message_count}</span> },
              { key: "conf", header: "Confidence TB", sortable: true, sortValue: (r) => Number(r.avg_confidence), width: 240, render: (r) => (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div className={`ad-bar ad-tone-${tone(r.avg_confidence)}`} style={{ flex: 1 }}><span style={{ width: pc(r.avg_confidence) }} /></div><span className="ad-num" style={{ width: 48, textAlign: "right" }}>{pc(r.avg_confidence)}</span></div>) },
            ]} />
        </Card>
        <Card title="Bot chưa chắc chắn" subtitle="Câu hỏi nên bổ sung huấn luyện">
          {(data?.unresolved || []).length ? data.unresolved.map((r, i) => (
            <div key={i} className="ad-list-row ad-tone-red" style={{ alignItems: "flex-start" }}>
              <div className="ad-icon-tile ad-tint" style={{ width: 34, height: 34, borderRadius: 10 }}><HelpCircle size={16} /></div>
              <div style={{ minWidth: 0 }}><div>{r.message}</div><div className="ad-muted" style={{ fontSize: 12 }}>{r.intent} · confidence {pc(r.confidence)}</div></div>
            </div>
          )) : <EmptyState icon={Bot} title="Chưa có câu hỏi cần xử lý" />}
        </Card>
      </div>
    </div>
  );
}
