import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { X, Loader2, ShieldCheck, Bell } from "lucide-react";
import { io } from "socket.io-client";
import Login from "./pages/Login.jsx";
import { USER_KEY, getToken, clearAuth, apiGet } from "./lib/api.js";
import { C, bodyFont } from "./lib/theme.js";
import { Header } from "./components/Header.jsx";
import { ChatWidget } from "./components/ChatWidget.jsx";
import { Footer } from "./components/Footer.jsx";
import { Home } from "./pages/Home.jsx";
import { ServicesPage } from "./pages/ServicesPage.jsx";
import { BookingPage } from "./pages/BookingPage.jsx";
import { CustomerPortal } from "./pages/CustomerPortal.jsx";

// Trang quản trị & nhân viên ít người dùng -> tải riêng khi cần để giảm dung lượng trang đầu.
const StaffPage = lazy(() => import("./pages/StaffPage.jsx").then((m) => ({ default: m.StaffPage })));
const AdminPage = lazy(() => import("./pages/admin/AdminPage.jsx").then((m) => ({ default: m.AdminPage })));

export default function App() {
  const [user,setUser]=useState(()=>{try{return JSON.parse(localStorage.getItem(USER_KEY)||"null")}catch{return null}});
  // Khi payOS đưa khách quay lại web (?payment=success|cancel&appointmentId=..): ghi nhớ rồi dọn URL.
  const paymentReturn=useRef((()=>{
    try{
      const q=new URLSearchParams(window.location.search); const st=q.get("payment"); if(!st)return null;
      const id=q.get("appointmentId"); window.history.replaceState({},"",window.location.pathname);
      if(st==="success"&&id)localStorage.setItem("henkheo_open_payment_id",id);
      sessionStorage.setItem("henkheo_payment_return",st);
      return {status:st,id};
    }catch{return null;}
  })()).current;
  const customerHome=paymentReturn?"customer":"home";
  const [view,setView]=useState(()=>(!user&&new URLSearchParams(window.location.search).has("reset"))?"login":user?.role_name==="STAFF"?"staff":user?.role_name==="ADMIN"?"admin":user?.role_name==="CUSTOMER"?customerHome:"home");
  const [services,setServices]=useState([]),[staffList,setStaffList]=useState([]),[appointments,setAppointments]=useState([]),[customers,setCustomers]=useState([]),[unreadCount,setUnreadCount]=useState(0);
  const [preselectService,setPreselectService]=useState(""); const [loading,setLoading]=useState(true); const [loadError,setLoadError]=useState("");
  const [adminTab,setAdminTab]=useState("overview");
  const [staffTab,setStaffTab]=useState("overview");
  const [customerTab,setCustomerTab]=useState("appointments");
  const [liveNotice,setLiveNotice]=useState(null);
  const handleLogin=(nextUser)=>{setUser(nextUser);setView(nextUser?.role_name==="STAFF"?"staff":nextUser?.role_name==="ADMIN"?"admin":"home");};
  const handleLogout=()=>{clearAuth();setUser(null);setAppointments([]);setCustomers([]);setUnreadCount(0);setView("home");setAdminTab("overview");setStaffTab("overview");setCustomerTab("appointments");};
  const handleOpenNotification = (n) => {
    const type = String(n?.type || "").toUpperCase();
    const role = user?.role_name;
    const appointmentTypes = new Set(["BOOKING_CREATED","NEW_APPOINTMENT","APPOINTMENT_STATUS","APPOINTMENT_CANCELLED","APPOINTMENT_RESCHEDULED","PAYMENT_CLAIMED","PAYMENT_SUCCESS","PAYMENT_REFUNDED","PAYMENT_FAILED"]);
    const rescheduleTypes = new Set(["RESCHEDULE_REQUESTED","RESCHEDULE_APPROVED","RESCHEDULE_REJECTED","RESCHEDULE_CANCELLED"]);
    if (role === "ADMIN") {
      if (rescheduleTypes.has(type)) setAdminTab("reschedules");
      else if (appointmentTypes.has(type)) setAdminTab("appointments");
      else if (type.includes("PAYMENT")||type.includes("REFUND")) setAdminTab("appointments");
      else if (type.includes("TIME_OFF")) setAdminTab("timeoff");
      else if (type.includes("REVIEW")) setAdminTab("reviews");
      else if (type.includes("CHAT")) setAdminTab("chat");
      else if (type.includes("SERVICE")) setAdminTab("services");
      else if (type.includes("STAFF")) setAdminTab("staff");
      else if (type.includes("ACTIVITY")) setAdminTab("activity");
      setView("admin");
      return;
    }
    if (role === "STAFF") {
      setStaffTab("appointments");
      setView("staff");
      return;
    }
    if (role === "CUSTOMER") {
      setCustomerTab(rescheduleTypes.has(type) ? "reschedules" : "appointments");
      setView("customer");
    }
  };
  const refreshServices=async()=>setServices(await apiGet("/services"));
  const refreshAppointments=async()=>{if(!user){setAppointments([]);return;}if(["ADMIN","STAFF"].includes(user.role_name)){setAppointments(await apiGet("/appointments"));return;}if(user.role_name==="CUSTOMER"){setAppointments(await apiGet("/appointments/my"));return;}setAppointments([]);};
  const refreshCustomers=async()=>{if(!user||!["ADMIN","STAFF"].includes(user.role_name)){setCustomers([]);return;}setCustomers(await apiGet("/customers"));};
  const refreshStaff=async()=>setStaffList(await apiGet("/staff"));
  const refreshNotifications=async()=>{if(!user){setUnreadCount(0);return;}try{const rows=await apiGet("/notifications");setUnreadCount(rows.filter(x=>!x.is_read).length);}catch{}};

  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        const [svc,stf]=await Promise.all([apiGet("/services"),apiGet("/staff")]);
        if(!active)return;setServices(svc);setStaffList(stf);
        let currentUser=user;
        const token=getToken();
        if(token){
          try{const me=await apiGet("/auth/me");currentUser=me?.user||null;if(currentUser){setUser(currentUser);localStorage.setItem(USER_KEY,JSON.stringify(currentUser));setView(currentUser.role_name==="STAFF"?"staff":currentUser.role_name==="ADMIN"?"admin":customerHome);}}
          catch{clearAuth();currentUser=null;if(active){setUser(null);setView("home");setAppointments([]);setCustomers([]);}}
        }
        if(currentUser){
          try{const ap=await apiGet(currentUser.role_name==="CUSTOMER"?"/appointments/my":"/appointments");if(active)setAppointments(ap);}catch(e){if(active)setAppointments([]);}
          if(["ADMIN","STAFF"].includes(currentUser.role_name))try{const cs=await apiGet("/customers");if(active)setCustomers(cs);}catch{}
          try{const ns=await apiGet("/notifications");if(active)setUnreadCount(ns.filter(x=>!x.is_read).length);}catch{}
        }
      }catch(e){if(active)setLoadError(e.message);}finally{if(active)setLoading(false);}
    })();
    return()=>{active=false;};
  },[user?.id]);

  useEffect(()=>{
    if(!user)return;
    const notificationTimer=setInterval(refreshNotifications,10000);
    const appointmentTimer=setInterval(()=>{
      if(["ADMIN","STAFF","CUSTOMER"].includes(user.role_name)) refreshAppointments().catch(()=>{});
    },7000);
    return()=>{clearInterval(notificationTimer);clearInterval(appointmentTimer);};
  },[user?.id,user?.role_name]);

  useEffect(()=>{
    if(!user)return;
    const socket=io(window.location.origin,{auth:{token:getToken()},transports:["websocket","polling"],reconnection:true,reconnectionAttempts:10});
    const refreshAll=async()=>{
      await refreshNotifications();
      if(["ADMIN","STAFF","CUSTOMER"].includes(user.role_name)) await refreshAppointments();
    };
    socket.on("notification:new",async(payload)=>{
      setLiveNotice(payload||null);
      window.clearTimeout(window.__henkheoNoticeTimer);
      window.__henkheoNoticeTimer=window.setTimeout(()=>setLiveNotice(null),6000);
      try{await refreshAll();}catch{}
    });
    socket.on("appointments:changed",async()=>{try{await refreshAppointments();}catch{}});
    socket.on("admin:changed",async()=>{try{await refreshAll();}catch{}});
    socket.on("payment:changed",async()=>{try{await refreshAll();}catch{}});
    socket.on("reschedule:changed",async()=>{try{await refreshAll();}catch{}});
    socket.on("connect_error",()=>{});
    return()=>socket.disconnect();
  },[user?.id,user?.role_name]);

  if(loading)return <div className="min-h-screen flex items-center justify-center" style={{fontFamily:bodyFont,color:C.inkSoft}}><Loader2 size={16} className="animate-spin mr-2"/>Đang tải dữ liệu...</div>;
  if(loadError)return <div className="min-h-screen flex items-center justify-center p-8"><div className="glass rounded-[26px] p-6 max-w-lg" style={{fontFamily:bodyFont,color:C.danger}}><b>Không tải được dữ liệu.</b><div className="mt-2 text-sm">{loadError}</div><div className="mt-4 text-xs" style={{color:C.inkSoft}}>Kiểm tra backend tại http://localhost:5000/api/health</div></div></div>;
  if(view==="login")return <><Header view={view} setView={setView} user={user} onLogout={handleLogout} unreadCount={unreadCount} onRefreshNotifications={refreshNotifications} onOpenNotification={handleOpenNotification}/><Login onLogin={handleLogin} onBack={()=>setView("home")}/><Footer/></>;
  const adminShell=(view==="admin"&&user?.role_name==="ADMIN")||(view==="staff"&&user?.role_name==="STAFF");
  return <div className="min-h-screen">{!adminShell&&<Header view={view} setView={setView} user={user} onLogout={handleLogout} unreadCount={unreadCount} onRefreshNotifications={refreshNotifications} onOpenNotification={handleOpenNotification}/>}
    {view==="home"&&<Home services={services} setView={setView} setPreselectService={setPreselectService}/>} 
    {view==="services"&&<ServicesPage services={services} setView={setView} setPreselectService={setPreselectService}/>} 
    {view==="booking"&&user?.role_name==="CUSTOMER"&&<BookingPage user={user} services={services} staffList={staffList} appointments={appointments} refreshAppointments={refreshAppointments} setView={setView} preselectService={preselectService}/>} 
    {view==="customer"&&user?.role_name==="CUSTOMER"&&<CustomerPortal user={user} appointments={appointments} refreshAppointments={refreshAppointments} setView={setView} setPreselectService={setPreselectService} initialTab={customerTab}/>} 
    {view==="staff"&&user?.role_name==="STAFF"&&<Suspense fallback={<div className="p-20 text-center" style={{fontFamily:bodyFont,color:C.inkSoft}}>Đang tải...</div>}><StaffPage user={user} appointments={appointments} refreshAppointments={refreshAppointments} setView={setView} initialTab={staffTab} onTabChange={setStaffTab} onLogout={handleLogout} unreadCount={unreadCount} onRefreshNotifications={refreshNotifications} onOpenNotification={handleOpenNotification}/></Suspense>} 
    {view==="admin"&&user?.role_name==="ADMIN"&&<Suspense fallback={<div className="p-20 text-center" style={{fontFamily:bodyFont,color:C.inkSoft}}>Đang tải...</div>}><AdminPage services={services} refreshServices={refreshServices} appointments={appointments} refreshAppointments={refreshAppointments} customers={customers} refreshCustomers={refreshCustomers} staffList={staffList} refreshStaff={refreshStaff} initialTab={adminTab} onTabChange={setAdminTab} user={user} onLogout={handleLogout} onExit={()=>setView("home")} unreadCount={unreadCount} onRefreshNotifications={refreshNotifications} onOpenNotification={handleOpenNotification}/></Suspense>} 
    {view==="admin"&&user?.role_name!=="ADMIN"&&<div className="max-w-4xl mx-auto px-5 py-20"><div className="glass rounded-[28px] p-8 text-center" style={{fontFamily:bodyFont}}><ShieldCheck size={34} color={C.primary} className="mx-auto mb-4"/><h2 className="text-2xl font-bold">Bạn không có quyền truy cập trang quản trị.</h2><p style={{color:C.inkSoft}} className="text-sm mt-2">Vui lòng đăng nhập bằng tài khoản ADMIN.</p></div></div>}
    {liveNotice&&<div className="fixed top-20 right-4 sm:right-8 z-[80] w-[min(92vw,380px)]"><div className="glass-strong rounded-2xl p-4 shadow-2xl flex items-start gap-3" style={{border:`1px solid rgba(108,76,240,.18)`}}><div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{background:"rgba(108,76,240,.10)"}}><Bell size={17} color={C.primary}/></div><div className="min-w-0" style={{fontFamily:bodyFont}}><div className="font-bold text-sm">{liveNotice.title||"Thông báo mới"}</div><div className="text-xs mt-1" style={{color:C.inkSoft}}>{liveNotice.message||"Bạn có một thông báo mới."}</div></div><button onClick={()=>setLiveNotice(null)} className="p-1 rounded-lg shrink-0"><X size={15}/></button></div></div>}{!adminShell&&<><Footer/><ChatWidget setView={setView} setPreselectService={setPreselectService} user={user}/></>}
  </div>;
}
