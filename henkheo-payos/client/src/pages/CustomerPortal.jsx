import React, { useEffect, useState } from "react";
import { ExternalLink, Loader2, Plus, QrCode, RefreshCcw, Save, Star, ArrowRight, CalendarX2, Clock, CalendarPlus } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { apiDownload, apiGet, apiSend, clearAuth, TOKEN_KEY } from "../lib/api.js";
import { todayISO, formatVND, dmLabel } from "../lib/format.js";
import { AdminUIProvider, Avatar, Button, Card, EmptyState, Field, Input, Modal, Pill, StatusPill, Tabs, Textarea, cx, themeVars, useUI } from "../components/admin/kit.jsx";
import "../components/admin/admin.css";

function CustomerInner({ appointments, refreshAppointments, user, setView, initialTab="appointments" }) {
  const [tab,setTab]=useState("appointments");
  const [reviews,setReviews]=useState([]); const [profile,setProfile]=useState(null);
  const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [message,setMessage]=useState("");
  const [rescheduleRequests,setRescheduleRequests]=useState([]);
  const [rescheduleTarget,setRescheduleTarget]=useState(null);
  const [rescheduleDate,setRescheduleDate]=useState(todayISO()); const [rescheduleStaffId,setRescheduleStaffId]=useState("");
  const [rescheduleTime,setRescheduleTime]=useState(""); const [rescheduleReason,setRescheduleReason]=useState("");
  const [rescheduleOptions,setRescheduleOptions]=useState({staff:[]}); const [rescheduleLoading,setRescheduleLoading]=useState(false); const [rescheduleSaving,setRescheduleSaving]=useState(false);
  const [paymentTarget,setPaymentTarget]=useState(null); const [payment,setPayment]=useState(null); const [paymentInfo,setPaymentInfo]=useState(null); const [paymentLoading,setPaymentLoading]=useState(false); const [paymentChecking,setPaymentChecking]=useState(false); const [paymentSecondsLeft,setPaymentSecondsLeft]=useState(null);
  const [pwOld,setPwOld]=useState(""); const [pwNew,setPwNew]=useState(""); const [pwConfirm,setPwConfirm]=useState(""); const [pwBusy,setPwBusy]=useState(false); const [pwMessage,setPwMessage]=useState(""); const [pwError,setPwError]=useState("");

  const ui=useUI();
  // Chuyển thông báo cũ (message/error) sang toast để đồng bộ với khu vực admin
  useEffect(()=>{if(message){ui.toast.success(message);setMessage("");}},[message]);
  useEffect(()=>{if(error){ui.toast.error(error);setError("");}},[error]);
  useEffect(()=>{if(pwMessage){ui.toast.success(pwMessage);setPwMessage("");}},[pwMessage]);

  const load=async()=>{
    try{
      const [profileData, reviewData, requestData]=await Promise.all([apiGet("/customers/me"),apiGet("/reviews/my"),apiGet("/reschedule-requests/my")]);
      setProfile(profileData);setReviews(reviewData);setRescheduleRequests(requestData||[]);
    }catch(e){setError(e.message);}
  };
  useEffect(()=>{load();},[user?.id]);
  useEffect(()=>{ if(initialTab) setTab(initialTab); },[initialTab]);

  const [delOpen,setDelOpen]=useState(false),[delPw,setDelPw]=useState(""),[delBusy,setDelBusy]=useState(false),[delError,setDelError]=useState("");
  const deleteAccount=async()=>{
    setDelBusy(true);setDelError("");
    try{await apiSend("/customers/me/delete-account","POST",{password:delPw});clearAuth();window.location.reload();}
    catch(e){setDelError(e.message);}finally{setDelBusy(false);}
  };
  const addToCalendar=async(a)=>{ try{await apiDownload(`/appointments/${a.id}/ics`,`${a.appointment_code}.ics`);}catch(e){setError(e.message);} };
  const cancel=async(a)=>{
    const reason=await ui.prompt({title:"Hủy lịch hẹn",message:`${a.service_name} · ${dmLabel(a.date)} ${a.time}`,label:"Lý do hủy lịch",multiline:true,requiredMessage:"Vui lòng nhập lý do hủy lịch.",confirmText:"Hủy lịch",cancelText:"Giữ lịch",tone:"danger"});
    if(!reason)return;
    try{const r=await apiSend(`/appointments/my/${a.id}/cancel`,"POST",{reason});setMessage(r?.message||"Đã hủy lịch.");await refreshAppointments();}
    catch(e){setError(e.message);}
  };

  const openReschedule=async(a)=>{
    setError("");setMessage("");setRescheduleTarget(a);setRescheduleDate(a.date||todayISO());setRescheduleStaffId("");setRescheduleTime("");setRescheduleReason("");setRescheduleOptions({staff:[]});
    try{
      setRescheduleLoading(true);
      const data=await apiGet(`/appointments/booking-options?serviceId=${encodeURIComponent(a.service_id)}&date=${encodeURIComponent(a.date||todayISO())}`);
      setRescheduleOptions(data||{staff:[]});
      const current=data?.staff?.find(st=>String(st.id)===String(a.staff_id)&&st.available);
      if(current){setRescheduleStaffId(String(current.id));setRescheduleTime(current.slots?.[0]||"");}
    }catch(e){setError(e.message);}
    finally{setRescheduleLoading(false);}
  };

  useEffect(()=>{
    if(!rescheduleTarget||!rescheduleDate)return;
    let cancelled=false;
    (async()=>{
      try{
        setRescheduleLoading(true);
        setRescheduleTime("");
        const data=await apiGet(`/appointments/booking-options?serviceId=${encodeURIComponent(rescheduleTarget.service_id)}&date=${encodeURIComponent(rescheduleDate)}`);
        if(cancelled)return;
        setRescheduleOptions(data||{staff:[]});
        const same=rescheduleTarget.staff_id && data?.staff?.find(st=>String(st.id)===String(rescheduleTarget.staff_id)&&st.available);
        const chosen=data?.staff?.find(st=>String(st.id)===String(rescheduleStaffId)&&st.available);
        if(!chosen){
          const fallback=same||data?.staff?.find(st=>st.available);
          setRescheduleStaffId(fallback?.id?String(fallback.id):"");
          setRescheduleTime(fallback?.slots?.[0]||"");
        }
      }catch(e){if(!cancelled)setError(e.message);}
      finally{if(!cancelled)setRescheduleLoading(false);}
    })();
    return()=>{cancelled=true;};
  },[rescheduleTarget?.id,rescheduleDate]);

  const selectedRescheduleStaff=rescheduleOptions.staff.find(st=>String(st.id)===String(rescheduleStaffId));
  useEffect(()=>{
    if(selectedRescheduleStaff && !selectedRescheduleStaff.slots?.includes(rescheduleTime))setRescheduleTime("");
  },[rescheduleStaffId,rescheduleOptions]);

  const submitReschedule=async()=>{
    if(!rescheduleTarget||!rescheduleStaffId||!rescheduleTime){setError("Vui lòng chọn nhân viên và khung giờ mới.");return;}
    try{
      setRescheduleSaving(true);setError("");
      await apiSend(`/reschedule-requests/my/${rescheduleTarget.id}`,"POST",{
        requestedStaffId:Number(rescheduleStaffId),requestedDate:rescheduleDate,requestedStartTime:rescheduleTime,reason:rescheduleReason.trim()||"Khách hàng yêu cầu đổi lịch."
      });
      setMessage("Đã gửi yêu cầu đổi lịch. Lịch hiện tại vẫn được giữ nguyên cho đến khi được duyệt.");
      setRescheduleTarget(null);await refreshAppointments();
      try{setRescheduleRequests(await apiGet("/reschedule-requests/my"));}catch{}
    }catch(e){setError(e.message);}
    finally{setRescheduleSaving(false);}
  };

  const openPayment=async(a)=>{
    setPaymentTarget(a);
    setPayment(null);
    setPaymentInfo(null);
    setPaymentSecondsLeft(null);
    setError("");
    try{
      setPaymentLoading(true);
      const data=await apiSend(`/payments/${a.id}/qr`,"POST",{});
      setPayment(data.payment);
      setPaymentInfo(data);
    }catch(e){
      setError(e.message);
      setPaymentTarget(null);
    }finally{setPaymentLoading(false);}
  };

  const checkPayment=async()=>{
    if(!paymentTarget||paymentChecking)return;
    try{
      setPaymentChecking(true);
      const data=await apiGet(`/payments/${paymentTarget.id}/status?sync=1`);
      setPayment(data.payment);
      if(String(data.payment?.payment_status||"").toUpperCase()==="PAID"){
        setMessage("Thanh toán thành công. Lịch hẹn đã được xác nhận.");
        setPaymentTarget(null);
        await refreshAppointments();
      } else if(String(data.payment?.payment_status||"").toUpperCase()==="EXPIRED"){
        setError("Phiên thanh toán đã hết hạn. Lịch chưa được xác nhận; vui lòng đặt lịch mới.");
      }
    }catch(e){setError(e.message);}finally{setPaymentChecking(false);}
  };

  useEffect(()=>{
    if(!paymentTarget)return;
    checkPayment();
    const timer=setInterval(checkPayment,5000);
    return()=>clearInterval(timer);
  },[paymentTarget?.id]);

  useEffect(()=>{
    if(!payment?.qr_expires_at){setPaymentSecondsLeft(null);return;}
    const tick=()=>{
      const sec=Math.max(0,Math.floor((new Date(payment.qr_expires_at).getTime()-Date.now())/1000));
      setPaymentSecondsLeft(sec);
    };
    tick();
    const timer=setInterval(tick,1000);
    return()=>clearInterval(timer);
  },[payment?.qr_expires_at]);

  useEffect(()=>{
    const pendingId=localStorage.getItem("henkheo_open_payment_id");
    if(!pendingId||!appointments.length)return;
    const a=appointments.find(x=>Number(x.id)===Number(pendingId));
    if(a){
      localStorage.removeItem("henkheo_open_payment_id");
      if(String(a.payment?.payment_method||"").toUpperCase()==="ONLINE" && String(a.payment?.payment_status||"").toUpperCase()!=="PAID") openPayment(a);
    }
  },[appointments.length,user?.id]);

  useEffect(()=>{
    const r=sessionStorage.getItem("henkheo_payment_return"); if(!r)return;
    sessionStorage.removeItem("henkheo_payment_return");
    if(r==="cancel")setMessage("Bạn đã thoát trang thanh toán mà chưa hoàn tất. Lịch sẽ tự hủy nếu quá hạn thanh toán; bạn vẫn có thể mở lại mã QR khi còn hiệu lực.");
    else setMessage("Đang xác nhận thanh toán với payOS, vui lòng đợi vài giây...");
  },[]);

  const openPaymentFromRow=async(a)=>{
    localStorage.removeItem("henkheo_open_payment_id");
    await openPayment(a);
  };

  const cancelRescheduleRequest=async(id)=>{
    if(!(await ui.confirm({title:"Hủy yêu cầu đổi lịch?",message:"Lịch hiện tại sẽ không thay đổi.",confirmText:"Hủy yêu cầu",cancelText:"Giữ lại",tone:"danger"})))return;
    try{await apiSend(`/reschedule-requests/${id}/cancel`,"PATCH",{});setMessage("Đã hủy yêu cầu đổi lịch.");setRescheduleRequests(await apiGet("/reschedule-requests/my"));}catch(e){setError(e.message);}
  };

  const [reviewTarget,setReviewTarget]=useState(null); const [reviewRating,setReviewRating]=useState(5); const [reviewComment,setReviewComment]=useState(""); const [reviewBusy,setReviewBusy]=useState(false);
  const review=(a)=>{setReviewTarget(a);setReviewRating(5);setReviewComment("");};
  const submitReview=async()=>{
    setReviewBusy(true);
    try{await apiSend("/reviews","POST",{appointmentId:reviewTarget.id,rating:reviewRating,comment:reviewComment.trim()});setMessage("Cảm ơn bạn đã đánh giá.");setReviewTarget(null);await load();}
    catch(e){setError(e.message);}finally{setReviewBusy(false);}
  };

  const saveProfile=async()=>{
    setBusy(true);setError("");
    try{
      await apiSend("/customers/me","PATCH",{fullName:profile?.full_name,phone:profile?.phone,email:profile?.email,address:profile?.address,note:profile?.note,gender:profile?.gender,dateOfBirth:profile?.date_of_birth?String(profile.date_of_birth).slice(0,10):null});
      setMessage("Đã cập nhật hồ sơ.");await load();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };

  const changePassword=async()=>{
    setPwError("");setPwMessage("");
    if(!pwOld||!pwNew){setPwError("Vui lòng nhập mật khẩu hiện tại và mật khẩu mới.");return;}
    if(pwNew.length<8||!/[A-Za-z]/.test(pwNew)||!/\d/.test(pwNew)){setPwError("Mật khẩu mới phải có ít nhất 8 ký tự, gồm cả chữ và số.");return;}
    if(pwNew!==pwConfirm){setPwError("Xác nhận mật khẩu mới không khớp.");return;}
    setPwBusy(true);
    try{
      const pwRes=await apiSend("/auth/change-password","POST",{oldPassword:pwOld,newPassword:pwNew}); if(pwRes?.token)localStorage.setItem(TOKEN_KEY,pwRes.token);
      setPwMessage("Đã đổi mật khẩu thành công.");setPwOld("");setPwNew("");setPwConfirm("");
    }catch(e){setPwError(e.message);}finally{setPwBusy(false);}
  };

  const paymentPill=(a)=>{
    const status=String(a.payment?.payment_status||"").toUpperCase(); const method=String(a.payment?.payment_method||"").toUpperCase();
    if(status==="PAID"&&a.status==="cancelled") return <Pill tone="amber" dot>Đã hủy · cửa hàng sẽ hoàn tiền cho bạn</Pill>;
    if(status==="PAID") return <Pill tone="green" dot>Đã thanh toán</Pill>;
    if(status==="EXPIRED") return <Pill tone="red" dot>Hết hạn thanh toán · lịch đã được hủy</Pill>;
    if(status==="FAILED") return <Pill tone="red" dot>Thanh toán lỗi · liên hệ cửa hàng</Pill>;
    if(status==="REFUNDED") return <Pill tone="violet" dot>Đã hoàn tiền{a.payment?.refund_reference?` · mã ${a.payment.refund_reference}`:""}</Pill>;
    if(method==="ONLINE") return <Pill tone="amber" dot>Chờ thanh toán online</Pill>;
    return <Pill tone="gray" dot>Thanh toán tại cơ sở</Pill>;
  };
  const RES={REQUESTED:["Chờ duyệt","amber"],APPROVED:["Đã duyệt","green"],REJECTED:["Từ chối","red"],CANCELLED:["Đã hủy","gray"]};
  const upcoming=appointments.filter(a=>["pending","confirmed"].includes(a.status)).length;
  const pwField=(label,val,set,ph)=><Field label={label}><Input type="password" value={val} onChange={e=>set(e.target.value)} placeholder={ph} autoComplete="off"/></Field>;

  return <div className="ad-scope" style={{...themeVars,fontFamily:"inherit"}}>
    <div className="max-w-6xl mx-auto px-5 sm:px-8 py-10 fade-up">
      <div className="ad-hero-card" style={{marginBottom:22}}>
        <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",justifyContent:"space-between",gap:16,position:"relative",zIndex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:16}}>
            <div className="ad-avatar" style={{width:56,height:56,fontSize:18,background:"rgba(255,255,255,.22)",color:"#fff"}}>{(user?.full_name||"?").trim().split(/\s+/).slice(-2).map(w=>w[0]).join("").toUpperCase()}</div>
            <div><div style={{fontSize:13,opacity:.85,fontWeight:600}}>Khu vực khách hàng</div><h1 className="ad-display" style={{fontSize:28,fontWeight:700}}>Xin chào, {user?.full_name||"bạn"}</h1>
              <p style={{opacity:.9,marginTop:2}}>{upcoming?`Bạn có ${upcoming} lịch hẹn sắp tới.`:"Bạn chưa có lịch hẹn sắp tới."}</p></div>
          </div>
          <Button variant="ghost" icon={Plus} onClick={()=>setView("booking")} style={{border:0}}>Đặt lịch mới</Button>
        </div>
      </div>

      <div style={{marginBottom:18}}><Tabs value={tab} onChange={setTab} items={[{id:"appointments",label:"Lịch hẹn",count:appointments.length},{id:"reviews",label:"Đánh giá",count:reviews.length},{id:"profile",label:"Hồ sơ"}]}/></div>

      {tab==="appointments"&&<div className="ad-stack">
        <Card title="Lịch hẹn của tôi" subtitle="Theo dõi trạng thái, thanh toán, đổi hoặc hủy lịch" action={<Button size="sm" icon={Plus} onClick={()=>setView("booking")}>Đặt lịch mới</Button>}>
          {appointments.length?appointments.map(a=>{
            const payStatus=String(a.payment?.payment_status||"").toUpperCase(); const payMethod=String(a.payment?.payment_method||"").toUpperCase();
            const canPay=payMethod==="ONLINE"&&!["PAID","CANCELLED","REFUNDED","EXPIRED","FAILED"].includes(payStatus)&&a.status!=="cancelled";
            return <div key={a.id} className="ad-appt">
              <div className="ad-appt-date"><b className="ad-display ad-num">{dmLabel(a.date)}</b><span className="ad-num">{String(a.time).slice(0,5)}{a.end_time?`–${String(a.end_time).slice(0,5)}`:""}</span></div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center"}}><b style={{fontSize:15}}>{a.service_name}</b><StatusPill status={a.status}/>{paymentPill(a)}</div>
                <div className="ad-muted" style={{fontSize:13,marginTop:3}}>{a.staff_name||"Chưa phân nhân viên"} · Giá lúc đặt <b style={{color:"var(--ad-ink)"}} className="ad-num">{formatVND(a.price_at_booking||a.price)}</b> · Mã {a.appointment_code}</div>
                {a.has_pending_reschedule&&<div style={{marginTop:6}}><Pill tone="amber">Đang chờ duyệt yêu cầu đổi lịch</Pill></div>}
                {a.payment?.transaction_code&&<div className="ad-muted" style={{fontSize:11.5,marginTop:4}}>Mã giao dịch: {a.payment.transaction_code}</div>}
                {payMethod==="ONLINE"&&!["PAID","CANCELLED","REFUNDED"].includes(payStatus)&&<div className="ad-muted" style={{fontSize:12,marginTop:2}}>Số tiền: <b className="ad-num">{formatVND(a.payment?.amount||a.price)}</b></div>}
              </div>
              <div className="ad-appt-actions">
                {canPay&&<Button size="sm" icon={QrCode} onClick={()=>openPaymentFromRow(a)}>Mở QR thanh toán</Button>}
                {payMethod==="ONLINE"&&payStatus==="EXPIRED"&&<Button size="sm" variant="soft" onClick={()=>setView("booking")}>Đặt lại lịch</Button>}
                {["pending","confirmed"].includes(a.status)&&<Button size="sm" variant="soft" icon={CalendarPlus} title="Tải file .ics để thêm vào Google/Apple/Outlook Calendar" onClick={()=>addToCalendar(a)}>Thêm vào lịch</Button>}
                {["pending","confirmed"].includes(a.status)&&!a.has_pending_reschedule&&<><Button size="sm" variant="soft" icon={RefreshCcw} disabled={!a.can_reschedule} title={a.reschedule_block_message||undefined} onClick={()=>openReschedule(a)}>Đổi lịch</Button><Button size="sm" variant="soft" tone="red" disabled={!a.can_cancel} title={a.cancel_block_message||undefined} onClick={()=>cancel(a)}>Hủy</Button></>}
                {["pending","confirmed"].includes(a.status)&&(!a.can_cancel||!a.can_reschedule)&&<div className="ad-muted" style={{fontSize:12,marginTop:6,flexBasis:"100%"}}>{a.cancel_block_message||a.reschedule_block_message}</div>}
                {a.status==="completed"&&<Button size="sm" variant="soft" tone="amber" icon={Star} onClick={()=>review(a)}>Đánh giá</Button>}
              </div>
            </div>;
          }):<EmptyState icon={CalendarX2} title="Bạn chưa có lịch hẹn" action={<Button icon={Plus} onClick={()=>setView("booking")}>Đặt lịch ngay</Button>}>Chọn dịch vụ, nhân viên và giờ phù hợp chỉ trong vài bước.</EmptyState>}
        </Card>

        <Card title="Yêu cầu đổi lịch của tôi" subtitle="Lịch hiện tại chỉ thay đổi sau khi quản trị viên / nhân viên duyệt." action={<button type="button" className="ad-iconbtn boxed" title="Làm mới" aria-label="Làm mới" onClick={async()=>{try{setRescheduleRequests(await apiGet("/reschedule-requests/my"));}catch(e){setError(e.message);}}}><RefreshCcw size={16}/></button>}>
          {rescheduleRequests.length?rescheduleRequests.map(r=>{const [lb,tn]=RES[r.status]||[r.status,"gray"];return <div key={r.id} className="ad-list-row" style={{alignItems:"flex-start"}}>
            <div className={`ad-icon-tile ad-tint ad-tone-${tn}`} style={{width:38,height:38}}><Clock size={17}/></div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center"}}><b>{r.appointment_code} · {r.service_name}</b><Pill tone={tn} dot>{lb}</Pill></div>
              <div className="ad-muted" style={{fontSize:13,marginTop:4,display:"flex",flexWrap:"wrap",gap:6,alignItems:"center"}}><span className="ad-num">{r.current_staff_name||"—"} · {dmLabel(r.current_date)} · {r.current_start_time}{r.current_end_time?`–${r.current_end_time}`:""}</span><ArrowRight size={13}/><b style={{color:"var(--ad-ink)"}} className="ad-num">{r.requested_staff_name||"—"} · {dmLabel(r.requested_date)} · {r.requested_start_time}{r.requested_end_time?`–${r.requested_end_time}`:""}</b></div>
              {r.reason&&<div className="ad-muted" style={{fontSize:12.5,marginTop:4}}>Lý do: {r.reason}</div>}
            </div>
            {r.status==="REQUESTED"&&<Button size="sm" variant="soft" tone="red" onClick={()=>cancelRescheduleRequest(r.id)}>Hủy yêu cầu</Button>}
          </div>;}):<EmptyState icon={RefreshCcw} title="Chưa có yêu cầu đổi lịch"/>}
        </Card>
      </div>}

      {tab==="reviews"&&<Card title="Đánh giá đã gửi" subtitle="Cảm ơn bạn đã góp ý để chúng tôi phục vụ tốt hơn">
        {reviews.length?reviews.map(r=><div key={r.id} className="ad-list-row" style={{alignItems:"flex-start"}}>
          <Avatar name={r.service_name} tone="amber"/>
          <div style={{flex:1}}><div style={{display:"flex",justifyContent:"space-between",gap:10}}><b>{r.service_name}</b><span style={{display:"inline-flex",gap:2}}>{[1,2,3,4,5].map(i=><Star key={i} size={15} fill={i<=Number(r.rating)?"#F5A623":"none"} color={i<=Number(r.rating)?"#F5A623":"#D5D7E3"}/>)}</span></div>
            <div className="ad-muted" style={{fontSize:12.5}}>{r.staff_name||"—"}</div>{r.comment&&<p style={{marginTop:6,color:"var(--ad-ink-2)"}}>{r.comment}</p>}</div>
        </div>):<EmptyState icon={Star} title="Chưa có đánh giá">Sau khi hoàn thành dịch vụ, bạn có thể đánh giá tại tab Lịch hẹn.</EmptyState>}
      </Card>}

      {tab==="profile"&&<div className="ad-stack">
        <Card title="Hồ sơ cá nhân" subtitle="Thông tin này giúp cửa hàng liên hệ và phục vụ bạn tốt hơn">
          {profile&&<><div className="ad-form-grid">
            <Field label="Họ tên"><Input value={profile.full_name||""} onChange={e=>setProfile({...profile,full_name:e.target.value})}/></Field>
            <Field label="Số điện thoại"><Input value={profile.phone||""} inputMode="tel" onChange={e=>setProfile({...profile,phone:e.target.value})}/></Field>
            <Field label="Email"><Input type="email" value={profile.email||""} onChange={e=>setProfile({...profile,email:e.target.value})}/></Field>
            <Field label="Ngày sinh"><Input type="date" value={profile.date_of_birth?String(profile.date_of_birth).slice(0,10):""} onChange={e=>setProfile({...profile,date_of_birth:e.target.value})}/></Field>
            <Field label="Địa chỉ" full><Input value={profile.address||""} onChange={e=>setProfile({...profile,address:e.target.value})}/></Field>
            <Field label="Ghi chú" full><Textarea rows={3} value={profile.note||""} onChange={e=>setProfile({...profile,note:e.target.value})}/></Field>
          </div><div style={{marginTop:18}}><Button icon={Save} loading={busy} onClick={saveProfile}>Lưu hồ sơ</Button></div></>}
        </Card>
        <Card title="Đổi mật khẩu" subtitle="Nếu quên mật khẩu, hãy dùng chức năng “Quên mật khẩu” ở màn hình đăng nhập để nhận liên kết đặt lại qua email.">
          {pwError&&<div role="alert" className="ad-alert ad-tone-red" style={{marginBottom:14}}>{pwError}</div>}
          <div className="ad-grid c3" style={{gap:14}}>{pwField("Mật khẩu hiện tại",pwOld,setPwOld,"••••••••")}{pwField("Mật khẩu mới",pwNew,setPwNew,"≥ 8 ký tự, gồm chữ và số")}{pwField("Nhập lại mật khẩu mới",pwConfirm,setPwConfirm,"Nhập lại để xác nhận")}</div>
          <div style={{marginTop:18}}><Button loading={pwBusy} onClick={changePassword}>Đổi mật khẩu</Button></div>
        </Card>
        <Card title="Xóa tài khoản" subtitle="Thông tin cá nhân, lịch sử chat và thông báo của bạn sẽ bị xóa; lịch sử giao dịch cũ được giữ ở dạng ẩn danh để đối soát. Không thể hoàn tác.">
          <Button variant="soft" tone="red" onClick={()=>{setDelPw("");setDelError("");setDelOpen(true);}}>Xóa tài khoản của tôi</Button>
        </Card>
      </div>}
    </div>

    <Modal open={delOpen} onClose={()=>setDelOpen(false)} busy={delBusy} title="Xóa tài khoản?" subtitle="Nhập mật khẩu để xác nhận. Bạn cần hủy hết lịch đang chờ/sắp tới trước."
      footer={<><Button variant="ghost" onClick={()=>setDelOpen(false)} disabled={delBusy}>Giữ tài khoản</Button><Button tone="red" loading={delBusy} disabled={!delPw} onClick={deleteAccount}>Xóa vĩnh viễn</Button></>}>
      {delError&&<div style={{marginBottom:12,color:"var(--ad-red, #dc2626)"}} role="alert">{delError}</div>}
      <Field label="Mật khẩu hiện tại" required><Input type="password" autoComplete="current-password" value={delPw} onChange={e=>setDelPw(e.target.value)}/></Field>
    </Modal>

    <Modal open={!!rescheduleTarget} onClose={()=>setRescheduleTarget(null)} busy={rescheduleSaving} wide title="Yêu cầu đổi lịch" subtitle="Lịch cũ được giữ nguyên cho đến khi quản trị viên / nhân viên duyệt yêu cầu."
      footer={<><Button variant="ghost" onClick={()=>setRescheduleTarget(null)} disabled={rescheduleSaving}>Hủy</Button><Button loading={rescheduleSaving} disabled={!rescheduleStaffId||!rescheduleTime} onClick={submitReschedule}>Gửi yêu cầu</Button></>}>
      {rescheduleTarget&&<>
        <div className="ad-tint ad-tone-violet" style={{borderRadius:12,padding:"12px 14px",marginBottom:16}}><b style={{color:"var(--ad-ink)"}}>{rescheduleTarget.service_name}</b><div style={{fontSize:12.5,color:"var(--ad-ink-2)"}}>Hiện tại: {rescheduleTarget.staff_name||"—"} · {dmLabel(rescheduleTarget.date)} · {rescheduleTarget.time}{rescheduleTarget.end_time?`–${rescheduleTarget.end_time}`:""}</div></div>
        <div className="ad-form-grid" style={{marginBottom:18}}>
          <Field label="Ngày mới"><Input type="date" min={todayISO()} value={rescheduleDate} onChange={e=>setRescheduleDate(e.target.value)}/></Field>
          <Field label="Lý do (không bắt buộc)"><Input value={rescheduleReason} onChange={e=>setRescheduleReason(e.target.value)} placeholder="Ví dụ: bận đột xuất"/></Field>
        </div>
        <div className="ad-label">Chọn nhân viên</div>
        {rescheduleLoading?<div className="ad-muted" style={{display:"flex",alignItems:"center",gap:8}}><Loader2 size={15} className="ad-spin"/>Đang kiểm tra nhân viên và lịch...</div>
          :<div className="ad-grid c2" style={{gap:10}}>{(rescheduleOptions.staff||[]).map(st=>{const on=String(rescheduleStaffId)===String(st.id);return <button key={st.id} type="button" disabled={!st.available} onClick={()=>{setRescheduleStaffId(String(st.id));setRescheduleTime("");}} className={cx("ad-tile",on&&"is-on")} style={{opacity:st.available?1:.55}}>
            <Avatar name={st.name}/><div style={{minWidth:0}}><b className="ad-truncate" style={{display:"block"}}>{st.name}</b><span className="ad-muted" style={{fontSize:12}}>{st.position||"Nhân viên dịch vụ"} · {st.available?`${st.slots.length} slot trống`:(st.working?"Hết slot phù hợp":"Nghỉ / chưa có ca")}</span></div></button>;})}</div>}
        {selectedRescheduleStaff&&<div style={{marginTop:18}}><div className="ad-label">Khung giờ của {selectedRescheduleStaff.name}</div>
          {selectedRescheduleStaff.slots?.length?<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(74px,1fr))",gap:8}}>{selectedRescheduleStaff.slots.map(slot=><button key={slot} type="button" onClick={()=>setRescheduleTime(slot)} className={cx("ad-slot",rescheduleTime===slot&&"is-on")}>{slot}</button>)}</div>
            :<div className="ad-muted">Nhân viên này không có slot phù hợp.</div>}</div>}
      </>}
    </Modal>

    <Modal open={!!paymentTarget} onClose={()=>setPaymentTarget(null)} title="Thanh toán online">
      {paymentLoading?<div className="ad-muted" style={{padding:"40px 0",display:"flex",justifyContent:"center",alignItems:"center",gap:8}}><Loader2 size={18} className="ad-spin"/>Đang tạo mã QR...</div>
        :payment&&paymentTarget&&<div style={{textAlign:"center"}}>
          <b>{paymentTarget.service_name}</b>
          <div className="ad-display ad-num" style={{fontSize:30,fontWeight:700,color:"var(--ad-primary)",marginTop:4}}>{formatVND(payment.amount)}</div>
          <div className="ad-muted" style={{fontSize:12.5}}>Nội dung đơn: <b style={{color:"var(--ad-ink)"}}>HK{String(payment.provider_order_code||"").slice(-7)}</b></div>
          <div style={{display:"flex",justifyContent:"center",margin:"18px 0"}}><div style={{background:"#fff",padding:14,borderRadius:16,border:"1px solid var(--ad-line)",boxShadow:"var(--ad-shadow)"}}><QRCodeSVG value={payment.qr_code_data||payment.checkout_url||""} size={230} includeMargin level="M"/></div></div>
          <div className="ad-muted" style={{fontSize:12.5,lineHeight:1.8}}>
            <div>Ngân hàng: <b style={{color:"var(--ad-ink)"}}>{payment.qr_bank_bin||paymentInfo?.provider?.bank_bin||"Theo QR payOS"}</b></div>
            <div>Số tài khoản: <b style={{color:"var(--ad-ink)"}}>{payment.qr_account_no||paymentInfo?.provider?.account_number||"Theo QR payOS"}</b></div>
            <div>Chủ tài khoản: <b style={{color:"var(--ad-ink)"}}>{payment.qr_account_name||paymentInfo?.provider?.account_name||"Theo QR payOS"}</b></div>
            <div>Mã đơn PayOS: <b style={{color:"var(--ad-ink)"}}>{payment.provider_order_code||"—"}</b></div>
            {payment.qr_expires_at&&<div>Hết hạn: <b style={{color:paymentSecondsLeft===0?"var(--ad-danger)":"var(--ad-ink)"}} className="ad-num">{paymentSecondsLeft===null?new Date(payment.qr_expires_at).toLocaleString("vi-VN"):paymentSecondsLeft>0?`${Math.floor(paymentSecondsLeft/60)}:${String(paymentSecondsLeft%60).padStart(2,"0")}`:"Đã hết hạn"}</b></div>}
          </div>
          <div className="ad-tint ad-tone-violet" style={{borderRadius:12,padding:"10px 14px",marginTop:14,textAlign:"left",fontSize:12.5,color:"var(--ad-ink-2)"}}><b>Hướng dẫn:</b> mở ứng dụng ngân hàng → quét QR → kiểm tra đúng số tiền và nội dung → hoàn tất chuyển khoản. Hệ thống tự xác nhận khi payOS gửi xác nhận giao dịch.</div>
          <div className="ad-grid c2" style={{gap:10,marginTop:16}}><Button variant="ghost" onClick={()=>setPaymentTarget(null)}>Đóng</Button><Button loading={paymentChecking} disabled={String(payment.payment_status).toUpperCase()==="PAID"} onClick={checkPayment}>Kiểm tra thanh toán</Button></div>
          {payment?.checkout_url&&<a href={payment.checkout_url} target="_blank" rel="noreferrer" className="ad-btn ad-btn-soft" style={{marginTop:10,width:"100%"}}><ExternalLink size={14}/>Mở trang thanh toán payOS</a>}
        </div>}
    </Modal>

    <Modal open={!!reviewTarget} onClose={()=>setReviewTarget(null)} busy={reviewBusy} title="Đánh giá dịch vụ" subtitle={reviewTarget?.service_name}
      footer={<><Button variant="ghost" onClick={()=>setReviewTarget(null)} disabled={reviewBusy}>Để sau</Button><Button loading={reviewBusy} onClick={submitReview}>Gửi đánh giá</Button></>}>
      <div className="ad-label">Bạn thấy dịch vụ thế nào?</div>
      <div style={{display:"flex",gap:6,marginBottom:16}}>{[1,2,3,4,5].map(i=><button key={i} type="button" aria-label={`${i} sao`} onClick={()=>setReviewRating(i)} className="ad-star"><Star size={32} fill={i<=reviewRating?"#F5A623":"none"} color={i<=reviewRating?"#F5A623":"#CFD1DE"}/></button>)}</div>
      <Field label="Nhận xét (không bắt buộc)"><Textarea rows={3} value={reviewComment} onChange={e=>setReviewComment(e.target.value)} placeholder="Chia sẻ trải nghiệm của bạn…"/></Field>
    </Modal>
  </div>;
}

export function CustomerPortal(props){return <AdminUIProvider><CustomerInner {...props}/></AdminUIProvider>;}
