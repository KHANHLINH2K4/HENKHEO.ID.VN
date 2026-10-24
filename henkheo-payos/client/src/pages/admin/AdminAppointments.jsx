import React, { useMemo, useState } from "react";
import { Check, CheckCircle2, CalendarX2, X, Banknote, RefreshCw, RotateCcw, Plus, UserX, ArrowRightLeft } from "lucide-react";
import { apiSend } from "../../lib/api.js";
import { formatVND, dmLabel, todayISO } from "../../lib/format.js";
import { Alert, Avatar, Button, Card, DataTable, EmptyState, IconButton, Pill, SearchInput, Select, StatusPill, Tabs, norm, useAction, useUI } from "../../components/admin/kit.jsx";
import { ManualBookingModal } from "../../components/admin/ManualBookingModal.jsx";
import { ReassignModal } from "../../components/admin/ReassignModal.jsx";
import { AppointmentCalendar } from "../../components/admin/AppointmentCalendar.jsx";

const SOURCE_LABEL = { WALK_IN: "Khách đến quầy", PHONE: "Khách gọi điện", CHAT: "Chatbot" };

const up = (v) => String(v || "").toUpperCase();
const dayOf = (a) => String(a.date || "").slice(0, 10);
const STATUS_TABS = [["all", "Tất cả"], ["pending", "Chờ xác nhận"], ["confirmed", "Đã xác nhận"], ["completed", "Hoàn thành"], ["cancelled", "Đã huỷ"]];

function PaymentCell({ a, busy, onCollect, onRefund, onSync }) {
  const ps = up(a.payment?.payment_status);
  const pm = up(a.payment?.payment_method);
  const amount = a.payment?.amount || a.price_at_booking || a.price;
  if (ps === "PAID") return (
    <div><Pill tone="green" dot>Đã thu</Pill> <b className="ad-num" style={{ marginLeft: 4 }}>{formatVND(amount)}</b>
      {a.status === "cancelled" && <div><Pill tone="red" dot>Cần hoàn tiền</Pill><div><Button variant="soft" tone="red" size="sm" icon={RotateCcw} disabled={busy} onClick={onRefund} className="" style={{ marginTop: 6 }}>Ghi nhận đã hoàn tiền</Button></div></div>}</div>
  );
  if (ps === "REFUNDED") return <div><Pill tone="violet" dot>Đã hoàn tiền</Pill>{a.payment?.refund_reference && <div className="ad-muted" style={{ fontSize: 12, marginTop: 4 }}>Mã hoàn: {a.payment.refund_reference}</div>}</div>;
  if (ps === "CANCELLED") return <Pill tone="gray">Thanh toán đã huỷ</Pill>;
  if (pm === "AT_STORE") return <Button variant="soft" size="sm" icon={Banknote} disabled={busy} onClick={onCollect}>Thu {formatVND(amount)}</Button>;
  return (
    <div>
      <Pill tone={ps === "EXPIRED" ? "red" : "amber"} dot>{ps === "EXPIRED" ? "Hết hạn thanh toán" : "Online · chờ thanh toán"}</Pill>
      <div className="ad-muted ad-num" style={{ fontSize: 12, margin: "4px 0 6px" }}>{formatVND(amount)}</div>
      <Button variant="soft" tone="green" size="sm" icon={RefreshCw} disabled={busy} onClick={onSync}>Đồng bộ từ payOS</Button>
    </div>
  );
}

export function AdminAppointments({ appointments, refreshAppointments, initialStatus, services = [], staffList = [] }) {
  const ui = useUI();
  const { busy, run } = useAction();
  const [status, setStatus] = useState(STATUS_TABS.some(([id]) => id === initialStatus) ? initialStatus : "all");
  const [when, setWhen] = useState("all");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("list");
  const [manualOpen, setManualOpen] = useState(false);
  const [reassigning, setReassigning] = useState(null);
  const refundPending = useMemo(() => appointments.filter((a) => a.refund_pending), [appointments]);

  const counts = useMemo(() => {
    const c = { all: appointments.length };
    appointments.forEach((a) => { c[a.status] = (c[a.status] || 0) + 1; });
    return c;
  }, [appointments]);

  const rows = useMemo(() => {
    const today = todayISO();
    const q = norm(query.trim());
    return appointments.filter((a) => {
      if (status !== "all" && a.status !== status) return false;
      if (when === "today" && dayOf(a) !== today) return false;
      if (when === "upcoming" && dayOf(a) < today) return false;
      if (when === "past" && dayOf(a) >= today) return false;
      if (!q) return true;
      return norm([a.customer_name, a.customer_phone, a.service_name, a.staff_name, a.appointment_code].join(" ")).includes(q);
    });
  }, [appointments, status, when, query]);

  const after = async () => { await refreshAppointments(); };
  const collect = async (a) => {
    const amount = a.payment?.amount || a.price_at_booking || a.price;
    if (!(await ui.confirm({ title: "Xác nhận đã thu tiền?", message: `Ghi nhận đã thu ${formatVND(amount)} của ${a.customer_name} tại quầy.`, confirmText: "Đã thu tiền" }))) return;
    run(`${a.id}:collect`, async () => { await apiSend(`/payments/${a.id}/collect`, "PATCH", {}); await after(); }, "Đã ghi nhận thu tiền.");
  };
  const refund = async (a) => {
    const reference = await ui.prompt({ title: "Ghi nhận đã hoàn tiền", message: `Hệ thống KHÔNG tự chuyển tiền. Hãy chuyển ${formatVND(a.payment?.amount || a.price)} lại cho ${a.customer_name} (qua ngân hàng/payOS), rồi nhập mã giao dịch hoàn để đối soát.`, label: "Mã giao dịch hoàn tiền / ghi chú đối soát", requiredMessage: "Cần nhập mã giao dịch hoàn tiền (tối thiểu 3 ký tự).", confirmText: "Ghi nhận hoàn tiền", tone: "danger" });
    if (!reference) return;
    run(`${a.id}:refund`, async () => { await apiSend(`/payments/${a.id}/refund`, "PATCH", { reference }); await after(); }, "Đã ghi nhận hoàn tiền.");
  };
  const sync = (a) => run(`${a.id}:sync`, async () => { await apiSend(`/payments/${a.id}/confirm`, "PATCH", {}); await after(); }, "Đã đồng bộ trạng thái từ payOS.");
  const setStatusOf = async (a, next) => {
    const body = { status: next };
    if (next === "cancelled") {
      const reason = await ui.prompt({ title: "Huỷ lịch hẹn", message: `${a.customer_name} · ${a.service_name} · ${dmLabel(a.date)} ${a.time}`, label: "Lý do huỷ (khách sẽ nhận được thông báo)", multiline: true, requiredMessage: "Vui lòng nhập lý do huỷ lịch.", confirmText: "Huỷ lịch", tone: "danger", cancelText: "Giữ lịch" });
      if (!reason) return;
      body.cancellationReason = reason;
    }
    if (next === "no_show" && !(await ui.confirm({ title: "Khách không đến?", message: `Ghi nhận ${a.customer_name} không đến. Khách không đến nhiều lần trong thời gian ngắn sẽ bị tạm khóa đặt online.`, confirmText: "Ghi nhận không đến", tone: "danger" }))) return;
    if (next === "completed" && !(await ui.confirm({ title: "Đánh dấu hoàn thành?", message: `Lịch của ${a.customer_name} sẽ được tính vào doanh số.`, confirmText: "Hoàn thành" }))) return;
    run(`${a.id}:${next}`, async () => { await apiSend(`/appointments/${a.id}`, "PATCH", body); await after(); },
      next === "confirmed" ? "Đã xác nhận lịch hẹn." : next === "cancelled" ? "Đã huỷ lịch hẹn." : next === "no_show" ? "Đã ghi nhận khách không đến." : "Đã hoàn thành lịch hẹn.");
  };

  const onlineUnpaid = (a) => up(a.payment?.payment_method) === "ONLINE" && up(a.payment?.payment_status) !== "PAID";
  const rowBusy = (a) => !!busy && String(busy).startsWith(`${a.id}:`);

  return (
    <>
    {refundPending.length > 0 && <div style={{ marginBottom: 12 }}><Alert tone="amber">Có <b>{refundPending.length}</b> lịch đã huỷ sau khi khách thanh toán online — cần hoàn tiền: {refundPending.slice(0, 5).map((a) => a.appointment_code).join(", ")}{refundPending.length > 5 ? "…" : ""}. Lọc tab "Đã huỷ" để xử lý.</Alert></div>}
    <ReassignModal appointment={reassigning} staffList={staffList} onClose={() => setReassigning(null)} onDone={after} />
    <ManualBookingModal open={manualOpen} onClose={() => setManualOpen(false)} services={services} role="ADMIN" onCreated={after} />
    <Card flush>
      <div className="ad-toolbar">
        <Button icon={Plus} size="sm" onClick={() => setManualOpen(true)}>Tạo lịch hộ khách</Button>
        <Tabs value={mode} onChange={setMode} items={[{ id: "list", label: "Danh sách" }, { id: "calendar", label: "Lịch tuần" }]} />
        <SearchInput value={query} onChange={setQuery} placeholder="Tìm khách, SĐT, dịch vụ, nhân viên…" />
        <Select value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Lọc theo thời gian" style={{ width: 160 }}>
          <option value="all">Mọi thời gian</option><option value="today">Hôm nay</option><option value="upcoming">Từ hôm nay trở đi</option><option value="past">Đã qua</option>
        </Select>
        <div className="ad-spacer" />
        <Tabs value={status} onChange={setStatus} items={STATUS_TABS.map(([id, label]) => ({ id, label, count: counts[id] || 0 }))} />
      </div>
      {mode === "calendar" ? <AppointmentCalendar appointments={rows} /> :
      <DataTable rows={rows} noun="lịch" initialSort={{ key: "when", dir: "desc" }}
        empty={<EmptyState icon={CalendarX2} title="Không có lịch hẹn phù hợp">Thử đổi bộ lọc hoặc từ khoá tìm kiếm.</EmptyState>}
        columns={[
          { key: "customer", header: "Khách hàng", sortable: true, sortValue: (a) => a.customer_name, render: (a) => <div className="ad-cell-user"><Avatar name={a.customer_name} /><div><b>{a.customer_name}</b><small>{a.customer_phone}</small></div></div> },
          { key: "service", header: "Dịch vụ", sortable: true, sortValue: (a) => a.service_name, render: (a) => <><b style={{ fontWeight: 550 }}>{a.service_name}</b><div className="ad-muted" style={{ fontSize: 12 }}>{a.staff_name || "Chưa phân nhân viên"}{a.auto_assigned ? " (tự phân công)" : ""}</div>{SOURCE_LABEL[a.source] && <div style={{ marginTop: 3 }}><Pill tone="gray">{SOURCE_LABEL[a.source]}</Pill></div>}</> },
          { key: "when", header: "Ngày giờ", sortable: true, nowrap: true, sortValue: (a) => `${dayOf(a)} ${String(a.time).slice(0, 5)}`, render: (a) => <><b className="ad-num">{dmLabel(a.date)}</b> <span className="ad-muted ad-num">· {String(a.time).slice(0, 5)}</span></> },
          { key: "status", header: "Trạng thái", sortable: true, sortValue: (a) => a.status, render: (a) => <><StatusPill status={a.status} />{a.has_pending_reschedule && <div style={{ marginTop: 4 }}><Pill tone="amber">Có yêu cầu đổi lịch</Pill></div>}</> },
          { key: "pay", header: "Thanh toán", render: (a) => <PaymentCell a={a} busy={rowBusy(a)} onCollect={() => collect(a)} onRefund={() => refund(a)} onSync={() => sync(a)} /> },
          { key: "act", header: "", align: "right", width: 160, render: (a) => (
            <div className="ad-row-actions">
              {a.status === "pending" && !onlineUnpaid(a) && <IconButton icon={Check} tone="green" label="Xác nhận lịch" disabled={rowBusy(a)} onClick={() => setStatusOf(a, "confirmed")} />}
              {a.status === "confirmed" && dayOf(a) <= todayISO() && <IconButton icon={UserX} tone="gray" label="Khách không đến" disabled={rowBusy(a)} onClick={() => setStatusOf(a, "no_show")} />}
              {a.status === "confirmed" && <IconButton icon={CheckCircle2} tone="violet" label="Đánh dấu hoàn thành" disabled={rowBusy(a)} onClick={() => setStatusOf(a, "completed")} />}
              {["pending", "confirmed"].includes(a.status) && <IconButton icon={ArrowRightLeft} tone="gray" label="Chuyển nhân viên / giờ" disabled={rowBusy(a)} onClick={() => setReassigning(a)} />}
              {["pending", "confirmed"].includes(a.status) && <IconButton icon={X} tone="red" label="Huỷ lịch" disabled={rowBusy(a)} onClick={() => setStatusOf(a, "cancelled")} />}
            </div>) },
        ]} />}
    </Card>
    </>
  );
}
