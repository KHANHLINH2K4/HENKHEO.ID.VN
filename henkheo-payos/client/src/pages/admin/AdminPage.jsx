import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, CalendarCheck, CalendarDays, CalendarOff, History, LayoutDashboard, RefreshCcw, Star, UserCog, Users, Wallet, BriefcaseBusiness, BarChart3,
} from "lucide-react";
import { AdminUIProvider } from "../../components/admin/kit.jsx";
import { PortalShell } from "../../components/admin/PortalShell.jsx";
import { AdminActivityLogs } from "./AdminActivityLogs.jsx";
import { AdminAppointments } from "./AdminAppointments.jsx";
import { AdminChatAnalytics } from "./AdminChatAnalytics.jsx";
import { AdminCustomers } from "./AdminCustomers.jsx";
// Trang tổng quan dùng thư viện biểu đồ (recharts) khá nặng: chỉ tải khi mở tab.
const AdminOverview = lazy(() => import("./AdminOverview.jsx").then((m) => ({ default: m.AdminOverview })));
const AdminReports = lazy(() => import("./AdminReports.jsx").then((m) => ({ default: m.AdminReports })));
import { AdminRescheduleRequests } from "./AdminRescheduleRequests.jsx";
import { AdminReviews } from "./AdminReviews.jsx";
import { AdminSchedules } from "./AdminSchedules.jsx";
import { AdminServices } from "./AdminServices.jsx";
import { AdminStaff } from "./AdminStaff.jsx";
import { AdminStaffServices } from "./AdminStaffServices.jsx";
import { AdminTimeOff } from "./AdminTimeOff.jsx";

const NAV_GROUPS = [
  { title: "Tổng quan", items: [
    { id: "overview", label: "Tổng quan", icon: LayoutDashboard, description: "Tình hình hoạt động, doanh số và việc cần xử lý hôm nay." },
  ]},
  { title: "Vận hành", items: [
    { id: "appointments", label: "Lịch hẹn", icon: CalendarCheck, badge: "pending", description: "Xác nhận, huỷ, hoàn thành lịch hẹn và theo dõi thanh toán." },
    { id: "reschedules", label: "Yêu cầu đổi lịch", icon: RefreshCcw, badge: "reschedule", description: "Chỉ khi được duyệt, lịch hiện tại mới thay đổi." },
    { id: "schedule", label: "Lịch làm việc", icon: CalendarDays, description: "Ca làm mặc định theo tuần và các ngày nghỉ / ca ngoại lệ của nhân viên." },
    { id: "timeoff", label: "Đơn xin nghỉ", icon: CalendarOff, description: "Duyệt đơn xin nghỉ của nhân viên; khi duyệt, lịch trống của khách tự cập nhật." },
    { id: "services", label: "Dịch vụ", icon: BriefcaseBusiness, description: "Danh mục, giá và thời lượng dịch vụ." },
    { id: "staff", label: "Nhân viên", icon: UserCog, description: "Hồ sơ nhân viên và tài khoản đăng nhập STAFF." },
    { id: "staff-services", label: "Phân công dịch vụ", icon: Wallet, description: "Mỗi dịch vụ có thể giao cho nhiều nhân viên; khách tự chọn người phù hợp khi đặt lịch." },
  ]},
  { title: "Khách hàng", items: [
    { id: "customers", label: "Khách hàng", icon: Users, description: "Tra cứu, xem lịch sử và tổng chi tiêu của khách." },
    { id: "reports", label: "Báo cáo", icon: BarChart3, description: "Doanh thu, tỉ lệ hủy / không đến theo khoảng ngày tùy chọn; xuất CSV mở bằng Excel." },
    { id: "reviews", label: "Đánh giá & phản hồi", icon: Star, description: "Theo dõi đánh giá dịch vụ và ẩn / hiện đánh giá." },
    { id: "chat", label: "Chatbot & NLP", icon: Bot, description: "Hiệu quả chatbot và những câu hỏi bot chưa trả lời chắc chắn." },
  ]},
  { title: "Hệ thống", items: [
    { id: "activity", label: "Nhật ký hoạt động", icon: History, description: "Lịch sử thao tác trên hệ thống để đối soát." },
  ]},
];
const VALID = new Set(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id)));
const hashTab = () => { const m = String(window.location.hash).match(/^#admin\/([\w-]+)/); return m && VALID.has(m[1]) ? m[1] : null; };

export function AdminPage({
  services, refreshServices, appointments, refreshAppointments, customers, refreshCustomers, staffList, refreshStaff,
  initialTab = "overview", onTabChange, user, onLogout, onExit, unreadCount = 0, onRefreshNotifications, onOpenNotification,
}) {
  const [tab, setTab] = useState(() => (initialTab && initialTab !== "overview" ? initialTab : hashTab() || "overview"));
  const [tabParams, setTabParams] = useState(null);
  const firstRun = useRef(true);

  const go = useCallback((id, params = null, { push = true } = {}) => {
    if (!VALID.has(id)) return;
    setTab(id); setTabParams(params);
    onTabChange?.(id);
    if (push) { try { window.history.pushState(null, "", `#admin/${id}`); } catch { /* môi trường không hỗ trợ history */ } }
    window.scrollTo({ top: 0 });
  }, [onTabChange]);

  // Chuông thông báo hoặc nơi khác đổi tab từ bên ngoài
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (initialTab && VALID.has(initialTab) && initialTab !== tab) { setTab(initialTab); setTabParams(null); }
  }, [initialTab]);

  // Nút Back/Forward của trình duyệt
  useEffect(() => {
    const onPop = () => { const t = hashTab(); if (t) { setTab(t); setTabParams(null); onTabChange?.(t); } };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [onTabChange]);

  const counts = useMemo(() => ({
    pending: appointments.filter((a) => a.status === "pending").length,
    reschedule: appointments.filter((a) => a.has_pending_reschedule && !["cancelled", "completed"].includes(a.status)).length,
  }), [appointments]);

  return (
    <AdminUIProvider>
      <PortalShell groups={NAV_GROUPS} tab={tab} onNavigate={go} counts={counts} brandSub="QUẢN TRỊ" crumbRoot="Quản trị" roleText="Toàn quyền hệ thống" miniKey="henkheo_admin_sidebar_mini"
        user={user} onLogout={onLogout} onExit={onExit} unreadCount={unreadCount} onRefreshNotifications={onRefreshNotifications} onOpenNotification={onOpenNotification}
        contentKey={tab + (tabParams ? JSON.stringify(tabParams) : "")}>
        <Suspense fallback={<div className="ad-muted" style={{ padding: 24 }}>Đang tải…</div>}>
        {tab === "reports" && <AdminReports />}
        {tab === "overview" && <AdminOverview services={services} appointments={appointments} customers={customers} staffList={staffList} onNavigate={go} />}
        </Suspense>
        {tab === "appointments" && <AdminAppointments appointments={appointments} refreshAppointments={refreshAppointments} initialStatus={tabParams?.status} services={services} staffList={staffList} />}
        {tab === "reschedules" && <AdminRescheduleRequests />}
        {tab === "schedule" && <AdminSchedules staffList={staffList} />}
        {tab === "timeoff" && <AdminTimeOff />}
        {tab === "services" && <AdminServices services={services} refreshServices={refreshServices} />}
        {tab === "staff" && <AdminStaff staffList={staffList} refreshStaff={refreshStaff} />}
        {tab === "staff-services" && <AdminStaffServices services={services} staffList={staffList} />}
        {tab === "customers" && <AdminCustomers customers={customers} refreshCustomers={refreshCustomers} />}
        {tab === "reviews" && <AdminReviews />}
        {tab === "chat" && <AdminChatAnalytics />}
        {tab === "activity" && <AdminActivityLogs />}
      </PortalShell>
    </AdminUIProvider>
  );
}
