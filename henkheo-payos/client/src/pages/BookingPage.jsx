import React, { useEffect, useState } from "react";
import {
  Check, Users, Loader2, LogIn, CheckCircle2, AlertCircle, CreditCard
} from "lucide-react";
import { Badge, GradButton, CategoryChip } from "../components/ui.jsx";
import { apiGet, apiSend } from "../lib/api.js";
import { todayISO, formatVND, dmLabel } from "../lib/format.js";
import { C, displayFont, bodyFont, gradPrimary } from "../lib/theme.js";

export function BookingPage({ user, services, appointments, refreshAppointments, setView, preselectService }) {
  const [serviceId, setServiceId] = useState(preselectService || services[0]?.id || "");
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("AT_STORE");
  const [onlineEnabled, setOnlineEnabled] = useState(false);
  const [bookingOptions, setBookingOptions] = useState({ staff: [] });
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [policy, setPolicy] = useState(null);

  useEffect(() => {
    if (preselectService) {
      setServiceId(preselectService);
      setPaymentMethod("AT_STORE");
      setStaffId("");
      setTime("");
    }
  }, [preselectService]);

  const service = services.find(s => String(s.id) === String(serviceId));

  useEffect(() => {
    let active = true;
    apiGet("/appointments/policy").then((d) => { if (active) setPolicy(d); }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    apiGet("/payments/config")
      .then((data) => { if (active) setOnlineEnabled(Boolean(data?.online_enabled)); })
      .catch(() => { if (active) setOnlineEnabled(false); });
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    if (!serviceId || !date || !user || user.role_name !== "CUSTOMER") {
      setBookingOptions({ staff: [] });
      setStaffId("");
      setTime("");
      return;
    }

    let cancelled = false;
    setOptionsLoading(true);
    setError("");
    setTime("");

    apiGet(`/appointments/booking-options?serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(date)}`)
      .then((data) => {
        if (cancelled) return;
        setBookingOptions(data || { staff: [] });
        const availableStaff = (data?.staff || []).filter(st => st.available);
        setStaffId(prev => {
          if (prev === "ANY" && data?.any?.available) return prev;
          if (availableStaff.some(st => String(st.id) === String(prev))) return prev;
          return "";
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setBookingOptions({ staff: [] });
        setStaffId("");
        setError(e.message || "Không tải được nhân viên và khung giờ.");
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false);
      });

    return () => { cancelled = true; };
  }, [serviceId, date, user?.id, user?.role_name]);

  const anyMode = staffId === "ANY";
  const selectedStaff = bookingOptions.staff.find(st => String(st.id) === String(staffId));
  const hasChoice = anyMode || !!selectedStaff;
  const slots = (anyMode ? bookingOptions.any?.slots : selectedStaff?.slots) || [];

  useEffect(() => {
    if (!slots.includes(time)) {
      setTime("");
    }
  }, [staffId, bookingOptions]);

  const handleSubmit = async () => {
    setError("");
    setSuccess("");

    if (!user) {
      setView("login");
      return;
    }
    if (user.role_name !== "CUSTOMER") {
      setError("Tài khoản CUSTOMER mới được đặt lịch.");
      return;
    }
    if (!service || !hasChoice || !time) {
      setError("Vui lòng chọn đủ dịch vụ, nhân viên và khung giờ còn trống.");
      return;
    }
    if (paymentMethod === "ONLINE" && !onlineEnabled) {
      setError("Thanh toán online chưa được cấu hình. Vui lòng chọn thanh toán tại cơ sở hoặc cấu hình PayOS trước khi sử dụng.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiSend("/appointments", "POST", {
        serviceId: Number(serviceId),
        staffId: anyMode ? "ANY" : Number(staffId),
        date,
        time,
        note,
        paymentMethod,
      });

      await refreshAppointments();

      if (paymentMethod === "ONLINE") {
        // Sau khi tạo lịch online, chuyển thẳng khách tới màn hình thanh toán.
        localStorage.setItem("henkheo_open_payment_id", String(result.id));
        setSuccess(`Lịch ${result.appointment_code} đã được tạo. Đang chuyển tới bước thanh toán online...`);
        setTime("");
        setView("customer");
        return;
      }

      setSuccess(`Đặt lịch thành công — ${service.name}, ${time} ngày ${dmLabel(date)}${result.auto_assigned ? ` với ${result.staff_name} (hệ thống tự chọn)` : ""}. Mã lịch: ${result.appointment_code}. Bạn sẽ thanh toán tại cơ sở. Lịch sẽ được cơ sở xác nhận sớm.`);
      setTime("");

      const refreshed = await apiGet(
        `/appointments/booking-options?serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(date)}`
      );
      setBookingOptions(refreshed || { staff: [] });
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return <div className="max-w-4xl mx-auto px-5 py-20"><div className="glass rounded-[28px] p-8 text-center"><LogIn size={34} color={C.primary} className="mx-auto mb-4" /><h2 style={{ fontFamily: displayFont }} className="text-2xl font-bold mb-2">Bạn cần đăng nhập để đặt lịch</h2><p style={{ fontFamily: bodyFont, color: C.inkSoft }} className="text-sm mb-6">Tài khoản CUSTOMER giúp hệ thống gắn lịch hẹn đúng với hồ sơ khách hàng của bạn.</p><GradButton onClick={() => setView("login")} className="mx-auto">Đăng nhập / Đăng ký</GradButton></div></div>;

  return <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 fade-up">
    <div className="flex items-end justify-between gap-4 mb-10"><div><h1 style={{ fontFamily: displayFont, color: C.ink }} className="text-4xl font-bold mb-2">Đặt lịch hẹn</h1><p style={{ fontFamily: bodyFont, color: C.inkSoft }}>Hệ thống tự tìm nhân viên phù hợp, kiểm tra ca làm và chỉ hiển thị khung giờ còn trống.</p></div><div style={{ fontFamily: bodyFont }} className="hidden sm:flex items-center gap-2 text-xs"><CheckCircle2 size={16} color={C.success} /> Đang đặt bằng tài khoản <b>{user.full_name}</b></div></div>

    <div className="grid lg:grid-cols-[1.55fr,.7fr] gap-8">
      <div className="space-y-7">
        <div><label style={{ fontFamily: bodyFont }} className="font-bold text-sm block mb-3">1. Chọn dịch vụ</label><div className="grid sm:grid-cols-2 gap-3">{services.map(s => <button key={s.id} onClick={() => { setServiceId(s.id); setPaymentMethod("AT_STORE"); setStaffId(""); setTime(""); setSuccess(""); }} style={{ background: String(serviceId) === String(s.id) ? "rgba(108,76,240,.08)" : "rgba(255,255,255,.65)", border: `1.5px solid ${String(serviceId) === String(s.id) ? C.primary : C.line}` }} className="rounded-2xl p-4 text-left"><div className="flex items-center justify-between gap-3"><span style={{ fontFamily: bodyFont }} className="text-sm font-bold">{s.name}</span><CategoryChip id={s.category} size={30} /></div><div style={{ fontFamily: bodyFont, color: C.inkSoft }} className="text-xs mt-2">{s.duration} phút · {formatVND(s.price)}</div></button>)}</div></div>

        <div>
          <label style={{ fontFamily: bodyFont }} className="font-bold text-sm block mb-3">2. Chọn nhân viên phù hợp</label>
          {optionsLoading ? (
            <div style={{ fontFamily: bodyFont, color: C.inkSoft }} className="rounded-2xl px-4 py-4 bg-white/60 text-sm flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Đang kiểm tra chuyên môn và lịch làm việc...</div>
          ) : bookingOptions.staff.length ? (
            <div className="grid sm:grid-cols-2 gap-3">
              {bookingOptions.any?.available && bookingOptions.staff.length > 1 && (
                <button onClick={() => { setStaffId("ANY"); setTime(""); setError(""); }} style={{ background: anyMode ? gradPrimary : "rgba(255,255,255,.65)", color: anyMode ? "#fff" : C.ink, border: `1.5px solid ${anyMode ? "transparent" : C.line}` }} className="rounded-2xl p-4 text-left sm:col-span-2">
                  <div className="flex items-start justify-between gap-3"><div><div style={{ fontFamily: bodyFont }} className="text-sm font-bold">Bất kỳ nhân viên nào</div><div style={{ fontFamily: bodyFont }} className="text-xs mt-1 opacity-75">Hệ thống tự chọn người đang rảnh — nhiều khung giờ hơn</div></div><Users size={17} /></div>
                  <div style={{ fontFamily: bodyFont }} className="text-xs mt-3 font-semibold">Còn {bookingOptions.any.slots.length} khung giờ ({bookingOptions.any.staff_count} nhân viên có thể phục vụ)</div>
                </button>
              )}
              {bookingOptions.staff.map(st => {
                const selected = String(staffId) === String(st.id);
                const disabled = !st.available;
                return <button key={st.id} disabled={disabled} onClick={() => { setStaffId(String(st.id)); setTime(""); setError(""); }} style={{ background: selected ? gradPrimary : disabled ? "rgba(24,21,35,.04)" : "rgba(255,255,255,.65)", color: selected ? "#fff" : disabled ? C.inkSoft : C.ink, border: `1.5px solid ${selected ? "transparent" : C.line}`, opacity: disabled ? .75 : 1 }} className="rounded-2xl p-4 text-left disabled:cursor-not-allowed">
                  <div className="flex items-start justify-between gap-3"><div><div style={{ fontFamily: bodyFont }} className="text-sm font-bold">{st.name}</div><div style={{ fontFamily: bodyFont }} className="text-xs mt-1 opacity-75">{st.position || "Nhân viên dịch vụ"}</div></div><Users size={17} /></div>
                  <div style={{ fontFamily: bodyFont }} className="text-xs mt-3">{st.working ? `Ca: ${st.working_hours.map(h => `${h.start}–${h.end}`).join(", ")}` : "Nghỉ / chưa có ca làm"}</div>
                  <div style={{ fontFamily: bodyFont }} className="text-xs mt-1 font-semibold">{st.available ? `Còn ${st.slots.length} khung giờ có thể đặt` : "Không còn khung giờ phù hợp"}</div>
                </button>;
              })}
            </div>
          ) : (
            <div style={{ color: C.inkSoft, fontFamily: bodyFont }} className="rounded-2xl px-4 py-4 bg-white/60 text-sm">Chưa tìm thấy nhân viên phù hợp với dịch vụ này.</div>
          )}
        </div>

        <div><label style={{ fontFamily: bodyFont }} className="font-bold text-sm block mb-3">3. Chọn ngày & giờ</label><input type="date" min={todayISO()} value={date} onChange={e => { setDate(e.target.value); setStaffId(""); setTime(""); setSuccess(""); }} style={{ border: `1px solid ${C.line}`, fontFamily: bodyFont }} className="px-4 py-2.5 rounded-xl text-sm mb-4" />
          {hasChoice ? <>
            <div style={{ fontFamily: bodyFont, color: C.inkSoft }} className="text-xs mb-3">{anyMode ? <b style={{ color: C.ink }}>Bất kỳ nhân viên</b> : <>Nhân viên <b style={{ color: C.ink }}>{selectedStaff.name}</b></>} có {slots.length} khung giờ còn trống trong ngày {dmLabel(date)}.</div>
            {slots.length ? <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">{slots.map(slot => { const selected = time === slot; return <button key={slot} onClick={() => setTime(slot)} style={{ background: selected ? gradPrimary : "rgba(255,255,255,.65)", color: selected ? "#fff" : C.ink, border: `1px solid ${selected ? "transparent" : C.line}` }} className="py-2 rounded-xl text-xs font-semibold">{slot}</button>; })}</div> : <div style={{ color: C.inkSoft, fontFamily: bodyFont }} className="rounded-xl bg-white/60 px-4 py-3 text-xs">Nhân viên này không còn khung giờ đáp ứng đủ thời lượng dịch vụ.</div>}
          </> : <div style={{ color: C.inkSoft, fontFamily: bodyFont }} className="rounded-xl bg-white/60 px-4 py-3 text-xs">Hãy chọn một nhân viên còn khung giờ.</div>}
          <p style={{ fontFamily: bodyFont, color: C.inkSoft }} className="text-xs mt-3">Luồng kiểm tra: <b>dịch vụ → nhân viên phù hợp → ca làm → khung giờ → chống trùng lịch</b>.</p>
        </div>

        <div><label style={{ fontFamily: bodyFont }} className="font-bold text-sm block mb-3">4. Hình thức thanh toán</label><div className="grid sm:grid-cols-2 gap-3"><button type="button" onClick={() => setPaymentMethod("AT_STORE")} style={{ background: paymentMethod === "AT_STORE" ? "rgba(108,76,240,.08)" : "rgba(255,255,255,.65)", border: `1.5px solid ${paymentMethod === "AT_STORE" ? C.primary : C.line}` }} className="rounded-2xl p-4 text-left"><div className="flex items-center gap-2"><CreditCard size={17} color={C.primary}/><span style={{ fontFamily: bodyFont }} className="font-bold text-sm">Thanh toán tại cơ sở</span></div><div style={{ fontFamily: bodyFont, color: C.inkSoft }} className="text-xs mt-2">Thanh toán trực tiếp khi sử dụng dịch vụ.</div></button><button type="button" disabled={!onlineEnabled} onClick={() => onlineEnabled && setPaymentMethod("ONLINE")} style={{ background: paymentMethod === "ONLINE" ? "rgba(0,194,168,.09)" : "rgba(255,255,255,.65)", border: `1.5px solid ${paymentMethod === "ONLINE" ? C.secondary : C.line}`, opacity: onlineEnabled ? 1 : .6 }} className="rounded-2xl p-4 text-left disabled:cursor-not-allowed"><div className="flex items-center gap-2"><CreditCard size={17} color={C.secondary}/><span style={{ fontFamily: bodyFont }} className="font-bold text-sm">Thanh toán online</span>{onlineEnabled?<span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{fontFamily:bodyFont,color:C.success,background:"rgba(18,183,106,.10)"}}>PAYOS</span>:<span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{fontFamily:bodyFont,color:C.danger,background:"rgba(229,72,77,.10)"}}>Chưa cấu hình</span>}</div><div style={{ fontFamily: bodyFont, color: C.inkSoft }} className="text-xs mt-2">Thanh toán trước qua QR/VietQR động của payOS. Lịch được xác nhận khi giao dịch thành công.</div></button></div></div>

<div><label style={{ fontFamily: bodyFont }} className="font-bold text-sm block mb-3">5. Ghi chú</label><textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="Nhu cầu đặc biệt (không bắt buộc)" style={{ border: `1px solid ${C.line}`, fontFamily: bodyFont }} className="w-full px-4 py-3 rounded-xl text-sm resize-none" /></div>
        {error && <div style={{ color: C.danger, background: "rgba(229,72,77,.08)", fontFamily: bodyFont }} className="rounded-2xl px-4 py-3 text-sm flex items-start gap-2"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error}</div>}
        {success && <div style={{ color: C.success, background: "rgba(18,183,106,.08)", fontFamily: bodyFont }} className="rounded-2xl px-4 py-3 text-sm flex items-start gap-2"><Check size={16} className="mt-0.5 shrink-0" />{success}</div>}
        <GradButton onClick={handleSubmit} disabled={submitting || !hasChoice || !time}>{submitting && <Loader2 size={15} className="animate-spin" />} Xác nhận đặt lịch</GradButton>
      </div>

      <div className="space-y-5"><div className="glass rounded-[26px] p-6"><h3 style={{ fontFamily: displayFont }} className="font-bold mb-4">Tóm tắt</h3><div style={{ fontFamily: bodyFont, color: C.inkSoft }} className="text-sm space-y-3"><div className="flex justify-between gap-4"><span>Dịch vụ</span><b style={{ color: C.ink }}>{service?.name || "—"}</b></div><div className="flex justify-between gap-4"><span>Nhân viên</span><b style={{ color: C.ink }}>{anyMode ? "Tự động chọn" : selectedStaff?.name || "—"}</b></div><div className="flex justify-between"><span>Ngày</span><b style={{ color: C.ink }}>{dmLabel(date)}</b></div><div className="flex justify-between"><span>Giờ</span><b style={{ color: C.ink }}>{time || "—"}</b></div><div className="flex justify-between"><span>Thanh toán</span><b style={{ color: C.ink }}>{paymentMethod === "ONLINE" ? "Online · QR/VietQR" : "Tại cơ sở"}</b></div><div style={{ borderTop: `1px solid ${C.line}` }} className="pt-3 flex justify-between"><span>Chi phí</span><b style={{ color: C.primary, fontFamily: displayFont }}>{formatVND(service?.price)}</b></div></div></div>
        {policy && <div className="glass rounded-[26px] p-6"><h3 style={{ fontFamily: displayFont }} className="font-bold mb-3">Chính sách đặt lịch</h3><ul style={{ fontFamily: bodyFont, color: C.inkSoft }} className="text-xs space-y-2 list-disc pl-4"><li>Lịch đã xác nhận hoặc đã thanh toán: tự hủy/đổi được trước giờ hẹn tối thiểu <b style={{ color: C.ink }}>{policy.cancel_min_hours} giờ</b>.</li><li>Giữ tối đa <b style={{ color: C.ink }}>{policy.max_active_bookings} lịch</b> chờ/sắp tới cùng lúc.</li><li>Lịch trả tại cơ sở chưa được xác nhận sau <b style={{ color: C.ink }}>{Math.round(policy.store_pending_expire_minutes / 60)} giờ</b> sẽ tự hủy.</li>{policy.email_enabled && <li>Bạn sẽ nhận email xác nhận và nhắc lịch trước {policy.reminder_hours} giờ (nếu có email trong hồ sơ).</li>}</ul></div>}
        <div className="glass rounded-[26px] p-6"><h3 style={{ fontFamily: displayFont }} className="font-bold mb-4">Lịch hẹn của tôi</h3>{appointments.length ? <div className="space-y-3">{appointments.map(a => <div key={a.id} className="flex items-center justify-between gap-3"><div><div style={{ fontFamily: bodyFont }} className="text-sm font-semibold">{a.service_name}</div><div style={{ fontFamily: bodyFont, color: C.inkSoft }} className="text-xs">{dmLabel(a.date)} · {a.time} · {a.staff_name || "Chưa phân công"}</div></div><Badge status={a.status} /></div>)}</div> : <p style={{ fontFamily: bodyFont, color: C.inkSoft }} className="text-sm">Chưa có lịch hẹn.</p>}</div></div>
    </div>
  </div>;
}
