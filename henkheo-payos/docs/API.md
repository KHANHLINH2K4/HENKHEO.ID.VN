# Danh sách API

Sinh tự động từ mã nguồn bằng `node server/scripts/gen-api-doc.js` (đừng sửa tay). Tiền tố `/api`. Cột "Quyền" lấy theo middleware khai báo trên route.

| Method | Đường dẫn | Quyền | Module |
|---|---|---|---|
| GET | `/api/activity-logs` | Admin | activityLogs.js |
| GET | `/api/admin/stats/sales` | Admin | stats.js |
| GET | `/api/appointments` | Admin, Staff | appointments.js |
| POST | `/api/appointments` | Customer | appointments.js |
| PATCH | `/api/appointments/:id` | Admin, Staff | appointments.js |
| GET | `/api/appointments/:id/ics` | Đã đăng nhập | appointments.js |
| PATCH | `/api/appointments/:id/reassign` | Admin | appointments.js |
| GET | `/api/appointments/availability` | Công khai | appointments.js |
| GET | `/api/appointments/booking-options` | Customer | appointments.js |
| POST | `/api/appointments/manual` | Admin, Staff | appointments.js |
| GET | `/api/appointments/manual/customers` | Admin, Staff | appointments.js |
| GET | `/api/appointments/manual/options` | Admin, Staff | appointments.js |
| GET | `/api/appointments/my` | Customer | appointments.js |
| POST | `/api/appointments/my/:id/cancel` | Customer | appointments.js |
| GET | `/api/appointments/policy` | Công khai | appointments.js |
| POST | `/api/auth/admin/reset-password` | Admin | auth.js |
| POST | `/api/auth/change-password` | Đã đăng nhập | auth.js |
| POST | `/api/auth/forgot-password` | Công khai | auth.js |
| POST | `/api/auth/login` | Công khai | auth.js |
| GET | `/api/auth/me` | Đã đăng nhập | auth.js |
| POST | `/api/auth/register` | Công khai | auth.js |
| POST | `/api/auth/reset-password` | Công khai | auth.js |
| POST | `/api/chat` | Công khai | chat.js |
| GET | `/api/chat/admin/analytics` | Admin | chat.js |
| GET | `/api/chat/history/:conversationId` | Đã đăng nhập | chat.js |
| GET | `/api/customers` | Admin, Staff | customers.js |
| DELETE | `/api/customers/:id` | Admin | customers.js |
| PATCH | `/api/customers/:id` | Admin | customers.js |
| PATCH | `/api/customers/:id/restore` | Admin | customers.js |
| GET | `/api/customers/me` | Customer | customers.js |
| PATCH | `/api/customers/me` | Customer | customers.js |
| POST | `/api/customers/me/delete-account` | Customer | customers.js |
| GET | `/api/notifications` | Đã đăng nhập | notifications.js |
| PATCH | `/api/notifications/:id/read` | Đã đăng nhập | notifications.js |
| PATCH | `/api/notifications/read-all` | Đã đăng nhập | notifications.js |
| PATCH | `/api/payments/:appointmentId/collect` | Admin, Staff | payments.js |
| PATCH | `/api/payments/:appointmentId/confirm` | Admin | payments.js |
| POST | `/api/payments/:appointmentId/pay` | Customer | payments.js |
| POST | `/api/payments/:appointmentId/qr` | Customer | payments.js |
| PATCH | `/api/payments/:appointmentId/refund` | Admin | payments.js |
| GET | `/api/payments/:appointmentId/status` | Đã đăng nhập | payments.js |
| POST | `/api/payments/admin/confirm-webhook` | Admin | payments.js |
| GET | `/api/payments/admin/summary` | Admin | payments.js |
| GET | `/api/payments/config` | Customer | payments.js |
| POST | `/api/payments/payos/webhook` | Công khai | payments.js |
| GET | `/api/reports/export.csv` | Admin | reports.js |
| GET | `/api/reports/summary` | Admin | reports.js |
| GET | `/api/reschedule-requests` | Admin, Staff | rescheduleRequests.js |
| PATCH | `/api/reschedule-requests/:id/approve` | Admin, Staff | rescheduleRequests.js |
| PATCH | `/api/reschedule-requests/:id/cancel` | Customer | rescheduleRequests.js |
| PATCH | `/api/reschedule-requests/:id/reject` | Admin, Staff | rescheduleRequests.js |
| GET | `/api/reschedule-requests/my` | Customer | rescheduleRequests.js |
| POST | `/api/reschedule-requests/my/:appointmentId` | Customer | rescheduleRequests.js |
| POST | `/api/reviews` | Customer | reviews.js |
| PATCH | `/api/reviews/:id/visibility` | Admin | reviews.js |
| GET | `/api/reviews/admin` | Admin | reviews.js |
| GET | `/api/reviews/my` | Customer | reviews.js |
| GET | `/api/reviews/public` | Công khai | reviews.js |
| GET | `/api/services` | Công khai | services.js |
| POST | `/api/services` | Admin | services.js |
| DELETE | `/api/services/:id` | Admin | services.js |
| PATCH | `/api/services/:id` | Admin | services.js |
| GET | `/api/services/categories/list` | Công khai | services.js |
| GET | `/api/staff` | Công khai | staff.js |
| POST | `/api/staff` | Admin | staff.js |
| GET | `/api/staff-portal/me` | Staff | staffPortal.js |
| PATCH | `/api/staff-portal/profile` | Staff | staffPortal.js |
| GET | `/api/staff-portal/schedule` | Staff | staffPortal.js |
| GET | `/api/staff-portal/services` | Staff | staffPortal.js |
| GET | `/api/staff-portal/stats` | Staff | staffPortal.js |
| GET | `/api/staff-schedules` | Admin | staffSchedules.js |
| PUT | `/api/staff-schedules` | Admin | staffSchedules.js |
| GET | `/api/staff-schedules/exceptions` | Admin | staffSchedules.js |
| PUT | `/api/staff-schedules/exceptions` | Admin | staffSchedules.js |
| DELETE | `/api/staff-schedules/exceptions/:id` | Admin | staffSchedules.js |
| GET | `/api/staff-schedules/templates` | Admin | staffSchedules.js |
| PUT | `/api/staff-schedules/templates` | Admin | staffSchedules.js |
| GET | `/api/staff-services` | Admin | staffServices.js |
| GET | `/api/staff-services/service/:serviceId` | Admin | staffServices.js |
| PUT | `/api/staff-services/service/:serviceId` | Admin | staffServices.js |
| DELETE | `/api/staff/:id` | Admin | staff.js |
| PATCH | `/api/staff/:id` | Admin | staff.js |
| POST | `/api/staff/:id/account` | Admin | staff.js |
| GET | `/api/time-off` | Admin | timeOff.js |
| POST | `/api/time-off` | Staff | timeOff.js |
| PATCH | `/api/time-off/:id/approve` | Admin | timeOff.js |
| PATCH | `/api/time-off/:id/reject` | Admin | timeOff.js |
| GET | `/api/time-off/my` | Staff | timeOff.js |
| PATCH | `/api/time-off/my/:id/cancel` | Staff | timeOff.js |

Tổng cộng **89** endpoint (chưa tính Socket.IO: `notification:new`, `appointments:changed`, `admin:changed`, `payment:changed`, `reschedule:changed`).

Ngoài các route trên: `GET /api/live` (liveness, không đụng CSDL) và `GET /api/health` (readiness, kiểm tra cả CSDL).
