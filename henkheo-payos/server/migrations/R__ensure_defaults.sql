/* Hẹn Khéo — Repeatable: luôn chạy sau mỗi lần migrate (idempotent).
   Đảm bảo dữ liệu nền tối thiểu để đặt lịch hoạt động, kể cả khi nhân viên được thêm
   bằng tay hoặc seed demo được nạp SAU các migration. */

/* 1. Mọi nhân viên đang hoạt động đều phải có đủ 7 dòng lịch tuần (T2–T7 08:00–18:00, CN nghỉ).
      Thiếu lịch tuần = không có khung giờ nào để khách đặt. */
INSERT INTO dbo.staff_schedule_templates(staff_id, day_of_week, start_time, end_time, is_working, note)
SELECT st.id, d.day_of_week, '08:00', '18:00',
       CASE WHEN d.day_of_week = 7 THEN 0 ELSE 1 END,
       CASE WHEN d.day_of_week = 7 THEN N'Nghỉ Chủ nhật' ELSE N'Lịch mặc định 08:00-18:00' END
FROM dbo.staff st
CROSS JOIN (VALUES (1),(2),(3),(4),(5),(6),(7)) AS d(day_of_week)
WHERE st.is_active = 1
  AND NOT EXISTS (
      SELECT 1 FROM dbo.staff_schedule_templates t
      WHERE t.staff_id = st.id AND t.day_of_week = d.day_of_week
  );
GO

/* 2. Phân công dịch vụ cho nhân viên demo (chỉ có tác dụng khi seed demo đã được nạp) */
INSERT INTO dbo.staff_services(service_id, staff_id)
SELECT s.id, st.id
FROM (VALUES
  ('NV001', N'Cắt tóc nam'), ('NV001', N'Gội đầu thư giãn'),
  ('NV002', N'Chăm sóc da cơ bản'), ('NV002', N'Chăm sóc da chuyên sâu'),
  ('NV003', N'Sơn gel'), ('NV003', N'Làm móng cơ bản'),
  ('NV004', N'Massage thư giãn 60 phút'), ('NV004', N'Chăm sóc body')
) AS m(employee_code, service_name)
INNER JOIN dbo.staff st ON st.employee_code = m.employee_code
INNER JOIN dbo.services s ON s.name = m.service_name
WHERE NOT EXISTS (SELECT 1 FROM dbo.staff_services x WHERE x.service_id = s.id AND x.staff_id = st.id);
GO
