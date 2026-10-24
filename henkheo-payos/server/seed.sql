USE henkheo;
GO

/* =========================================================
   HEN KHEO - SEED DATA V2
   Dữ liệu mẫu: categories, services, staff, customers,
   staff_schedules, appointments
   ========================================================= */

/* 1. CATEGORIES */
IF NOT EXISTS (SELECT 1 FROM dbo.categories WHERE name = N'Tóc')
    INSERT INTO dbo.categories (name, description) VALUES (N'Tóc', N'Dịch vụ cắt, gội, tạo kiểu và chăm sóc tóc');

IF NOT EXISTS (SELECT 1 FROM dbo.categories WHERE name = N'Da mặt')
    INSERT INTO dbo.categories (name, description) VALUES (N'Da mặt', N'Dịch vụ chăm sóc và làm sạch da mặt');

IF NOT EXISTS (SELECT 1 FROM dbo.categories WHERE name = N'Móng')
    INSERT INTO dbo.categories (name, description) VALUES (N'Móng', N'Dịch vụ làm móng và chăm sóc móng');

IF NOT EXISTS (SELECT 1 FROM dbo.categories WHERE name = N'Massage')
    INSERT INTO dbo.categories (name, description) VALUES (N'Massage', N'Dịch vụ thư giãn và chăm sóc cơ thể');

IF NOT EXISTS (SELECT 1 FROM dbo.categories WHERE name = N'Spa')
    INSERT INTO dbo.categories (name, description) VALUES (N'Spa', N'Dịch vụ chăm sóc và thư giãn tổng hợp');
GO

/* 2. SERVICES */
DECLARE @Hair INT = (SELECT id FROM dbo.categories WHERE name = N'Tóc');
DECLARE @Face INT = (SELECT id FROM dbo.categories WHERE name = N'Da mặt');
DECLARE @Nail INT = (SELECT id FROM dbo.categories WHERE name = N'Móng');
DECLARE @Massage INT = (SELECT id FROM dbo.categories WHERE name = N'Massage');
DECLARE @Spa INT = (SELECT id FROM dbo.categories WHERE name = N'Spa');

IF NOT EXISTS (SELECT 1 FROM dbo.services WHERE name = N'Cắt tóc nam')
    INSERT INTO dbo.services (category_id, name, duration_minutes, price, description, popular)
    VALUES (@Hair, N'Cắt tóc nam', 45, 100000, N'Cắt tóc nam theo kiểu khách hàng lựa chọn', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.services WHERE name = N'Gội đầu thư giãn')
    INSERT INTO dbo.services (category_id, name, duration_minutes, price, description, popular)
    VALUES (@Hair, N'Gội đầu thư giãn', 45, 120000, N'Gội đầu kết hợp massage thư giãn', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.services WHERE name = N'Chăm sóc da cơ bản')
    INSERT INTO dbo.services (category_id, name, duration_minutes, price, description, popular)
    VALUES (@Face, N'Chăm sóc da cơ bản', 60, 250000, N'Làm sạch và chăm sóc da mặt cơ bản', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.services WHERE name = N'Chăm sóc da chuyên sâu')
    INSERT INTO dbo.services (category_id, name, duration_minutes, price, description, popular)
    VALUES (@Face, N'Chăm sóc da chuyên sâu', 90, 450000, N'Quy trình chăm sóc da chuyên sâu', 0);

IF NOT EXISTS (SELECT 1 FROM dbo.services WHERE name = N'Sơn gel')
    INSERT INTO dbo.services (category_id, name, duration_minutes, price, description, popular)
    VALUES (@Nail, N'Sơn gel', 60, 180000, N'Sơn gel với màu sắc khách hàng lựa chọn', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.services WHERE name = N'Làm móng cơ bản')
    INSERT INTO dbo.services (category_id, name, duration_minutes, price, description, popular)
    VALUES (@Nail, N'Làm móng cơ bản', 45, 120000, N'Cắt da, tạo form và chăm sóc móng', 0);

IF NOT EXISTS (SELECT 1 FROM dbo.services WHERE name = N'Massage thư giãn 60 phút')
    INSERT INTO dbo.services (category_id, name, duration_minutes, price, description, popular)
    VALUES (@Massage, N'Massage thư giãn 60 phút', 60, 300000, N'Massage thư giãn toàn thân trong 60 phút', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.services WHERE name = N'Chăm sóc body')
    INSERT INTO dbo.services (category_id, name, duration_minutes, price, description, popular)
    VALUES (@Spa, N'Chăm sóc body', 90, 500000, N'Chăm sóc và thư giãn cơ thể', 0);
GO

/* 3. STAFF */
IF NOT EXISTS (SELECT 1 FROM dbo.staff WHERE employee_code = 'NV001')
    INSERT INTO dbo.staff (employee_code, full_name, phone, email, position, specialties, hire_date)
    VALUES ('NV001', N'Nguyễn Minh Anh', '0901000001', 'minhanh@henkheo.local', N'Chuyên viên tóc', N'Cắt tóc, tạo kiểu, gội đầu', '2025-01-10');

IF NOT EXISTS (SELECT 1 FROM dbo.staff WHERE employee_code = 'NV002')
    INSERT INTO dbo.staff (employee_code, full_name, phone, email, position, specialties, hire_date)
    VALUES ('NV002', N'Trần Thu Hà', '0901000002', 'thuha@henkheo.local', N'Chuyên viên da', N'Chăm sóc da cơ bản và chuyên sâu', '2025-03-15');

IF NOT EXISTS (SELECT 1 FROM dbo.staff WHERE employee_code = 'NV003')
    INSERT INTO dbo.staff (employee_code, full_name, phone, email, position, specialties, hire_date)
    VALUES ('NV003', N'Lê Ngọc Mai', '0901000003', 'ngocmai@henkheo.local', N'Chuyên viên móng', N'Làm móng, sơn gel', '2025-05-20');

IF NOT EXISTS (SELECT 1 FROM dbo.staff WHERE employee_code = 'NV004')
    INSERT INTO dbo.staff (employee_code, full_name, phone, email, position, specialties, hire_date)
    VALUES ('NV004', N'Phạm Hoàng Nam', '0901000004', 'hoangnam@henkheo.local', N'Chuyên viên massage', N'Massage thư giãn, chăm sóc body', '2025-07-01');
GO

/* 4. CUSTOMERS */
IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE phone = '0912000001')
    INSERT INTO dbo.customers (full_name, phone, email, gender, date_of_birth, address, note)
    VALUES (N'Nguyễn Thị Lan', '0912000001', 'lan@example.local', 'FEMALE', '2002-04-12', N'Hà Nội', N'Khách hàng thường xuyên');

IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE phone = '0912000002')
    INSERT INTO dbo.customers (full_name, phone, email, gender, date_of_birth, address, note)
    VALUES (N'Đỗ Minh Quân', '0912000002', 'quan@example.local', 'MALE', '2001-08-20', N'Hà Nội', N'Thích lịch hẹn buổi tối');

IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE phone = '0912000003')
    INSERT INTO dbo.customers (full_name, phone, email, gender, date_of_birth, address, note)
    VALUES (N'Phạm Ngọc Anh', '0912000003', 'ngocanh@example.local', 'FEMALE', '2003-02-18', N'Hà Nội', N'Ưu tiên dịch vụ chăm sóc da');

IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE phone = '0912000004')
    INSERT INTO dbo.customers (full_name, phone, email, gender, date_of_birth, address, note)
    VALUES (N'Vũ Đức Anh', '0912000004', 'ducanh@example.local', 'MALE', '2000-11-05', N'Hà Nội', N'Khách mới');

IF NOT EXISTS (SELECT 1 FROM dbo.customers WHERE phone = '0912000005')
    INSERT INTO dbo.customers (full_name, phone, email, gender, date_of_birth, address, note)
    VALUES (N'Hoàng Thu Trang', '0912000005', 'thutrang@example.local', 'FEMALE', '2002-09-25', N'Hà Nội', N'Quan tâm dịch vụ spa');
GO

/* 5. STAFF SCHEDULES
   Tạo lịch cho 4 nhân viên trong 7 ngày tới.
*/
DECLARE @d DATE = CAST(GETDATE() AS DATE);
DECLARE @i INT = 0;

WHILE @i < 7
BEGIN
    DECLARE @workDate DATE = DATEADD(DAY, @i, @d);

    INSERT INTO dbo.staff_schedules (staff_id, work_date, start_time, end_time, is_available, note)
    SELECT st.id, @workDate, '08:00', '12:00', 1, N'Ca sáng'
    FROM dbo.staff st
    WHERE st.employee_code IN ('NV001','NV002','NV003','NV004')
      AND NOT EXISTS (
          SELECT 1 FROM dbo.staff_schedules ss
          WHERE ss.staff_id = st.id
            AND ss.work_date = @workDate
            AND ss.start_time = '08:00'
            AND ss.end_time = '12:00'
      );

    INSERT INTO dbo.staff_schedules (staff_id, work_date, start_time, end_time, is_available, note)
    SELECT st.id, @workDate, '13:30', '17:30', 1, N'Ca chiều'
    FROM dbo.staff st
    WHERE st.employee_code IN ('NV001','NV002','NV003','NV004')
      AND NOT EXISTS (
          SELECT 1 FROM dbo.staff_schedules ss
          WHERE ss.staff_id = st.id
            AND ss.work_date = @workDate
            AND ss.start_time = '13:30'
            AND ss.end_time = '17:30'
      );

    SET @i = @i + 1;
END;
GO

/* 6. APPOINTMENTS
   Tạo 6 lịch hẹn mẫu trong 7 ngày tới.
*/
DECLARE @Customer1 INT = (SELECT id FROM dbo.customers WHERE phone = '0912000001');
DECLARE @Customer2 INT = (SELECT id FROM dbo.customers WHERE phone = '0912000002');
DECLARE @Customer3 INT = (SELECT id FROM dbo.customers WHERE phone = '0912000003');
DECLARE @Customer4 INT = (SELECT id FROM dbo.customers WHERE phone = '0912000004');
DECLARE @Customer5 INT = (SELECT id FROM dbo.customers WHERE phone = '0912000005');

DECLARE @Staff1 INT = (SELECT id FROM dbo.staff WHERE employee_code = 'NV001');
DECLARE @Staff2 INT = (SELECT id FROM dbo.staff WHERE employee_code = 'NV002');
DECLARE @Staff3 INT = (SELECT id FROM dbo.staff WHERE employee_code = 'NV003');
DECLARE @Staff4 INT = (SELECT id FROM dbo.staff WHERE employee_code = 'NV004');

DECLARE @Service1 INT = (SELECT id FROM dbo.services WHERE name = N'Cắt tóc nam');
DECLARE @Service2 INT = (SELECT id FROM dbo.services WHERE name = N'Gội đầu thư giãn');
DECLARE @Service3 INT = (SELECT id FROM dbo.services WHERE name = N'Chăm sóc da cơ bản');
DECLARE @Service4 INT = (SELECT id FROM dbo.services WHERE name = N'Sơn gel');
DECLARE @Service5 INT = (SELECT id FROM dbo.services WHERE name = N'Massage thư giãn 60 phút');
DECLARE @Service6 INT = (SELECT id FROM dbo.services WHERE name = N'Chăm sóc body');

IF NOT EXISTS (SELECT 1 FROM dbo.appointments WHERE appointment_code = 'HK20260917001')
    INSERT INTO dbo.appointments (appointment_code, customer_id, service_id, staff_id, appointment_date, start_time, end_time, price_at_booking, note, status)
    VALUES ('HK20260917001', @Customer1, @Service1, @Staff1, DATEADD(DAY, 1, CAST(GETDATE() AS DATE)), '09:00', '09:45', (SELECT price FROM dbo.services WHERE id = @Service1), N'Khách đặt lịch cắt tóc', 'CONFIRMED');

IF NOT EXISTS (SELECT 1 FROM dbo.appointments WHERE appointment_code = 'HK20260917002')
    INSERT INTO dbo.appointments (appointment_code, customer_id, service_id, staff_id, appointment_date, start_time, end_time, price_at_booking, note, status)
    VALUES ('HK20260917002', @Customer2, @Service2, @Staff1, DATEADD(DAY, 1, CAST(GETDATE() AS DATE)), '14:00', '14:45', (SELECT price FROM dbo.services WHERE id = @Service2), N'Gội đầu thư giãn', 'PENDING');

IF NOT EXISTS (SELECT 1 FROM dbo.appointments WHERE appointment_code = 'HK20260917003')
    INSERT INTO dbo.appointments (appointment_code, customer_id, service_id, staff_id, appointment_date, start_time, end_time, price_at_booking, note, status)
    VALUES ('HK20260917003', @Customer3, @Service3, @Staff2, DATEADD(DAY, 2, CAST(GETDATE() AS DATE)), '10:00', '11:00', (SELECT price FROM dbo.services WHERE id = @Service3), N'Chăm sóc da cơ bản', 'CONFIRMED');

IF NOT EXISTS (SELECT 1 FROM dbo.appointments WHERE appointment_code = 'HK20260917004')
    INSERT INTO dbo.appointments (appointment_code, customer_id, service_id, staff_id, appointment_date, start_time, end_time, price_at_booking, note, status)
    VALUES ('HK20260917004', @Customer4, @Service4, @Staff3, DATEADD(DAY, 2, CAST(GETDATE() AS DATE)), '15:00', '16:00', (SELECT price FROM dbo.services WHERE id = @Service4), N'Sơn gel màu tự nhiên', 'COMPLETED');

IF NOT EXISTS (SELECT 1 FROM dbo.appointments WHERE appointment_code = 'HK20260917005')
    INSERT INTO dbo.appointments (appointment_code, customer_id, service_id, staff_id, appointment_date, start_time, end_time, price_at_booking, note, status)
    VALUES ('HK20260917005', @Customer5, @Service5, @Staff4, DATEADD(DAY, 3, CAST(GETDATE() AS DATE)), '16:00', '17:00', (SELECT price FROM dbo.services WHERE id = @Service5), N'Massage thư giãn', 'CANCELLED');

IF NOT EXISTS (SELECT 1 FROM dbo.appointments WHERE appointment_code = 'HK20260917006')
    INSERT INTO dbo.appointments (appointment_code, customer_id, service_id, staff_id, appointment_date, start_time, end_time, price_at_booking, note, status)
    VALUES ('HK20260917006', @Customer1, @Service6, @Staff4, DATEADD(DAY, 4, CAST(GETDATE() AS DATE)), '09:00', '10:30', (SELECT price FROM dbo.services WHERE id = @Service6), N'Chăm sóc body', 'PENDING');
GO

/* 7. KIỂM TRA SAU KHI SEED */
SELECT 'roles' AS table_name, COUNT(*) AS row_count FROM dbo.roles
UNION ALL SELECT 'categories', COUNT(*) FROM dbo.categories
UNION ALL SELECT 'services', COUNT(*) FROM dbo.services
UNION ALL SELECT 'staff', COUNT(*) FROM dbo.staff
UNION ALL SELECT 'customers', COUNT(*) FROM dbo.customers
UNION ALL SELECT 'staff_schedules', COUNT(*) FROM dbo.staff_schedules
UNION ALL SELECT 'appointments', COUNT(*) FROM dbo.appointments;
GO

SELECT
    a.appointment_code,
    c.full_name AS customer_name,
    s.name AS service_name,
    st.full_name AS staff_name,
    a.appointment_date,
    a.start_time,
    a.status
FROM dbo.appointments a
JOIN dbo.customers c ON c.id = a.customer_id
JOIN dbo.services s ON s.id = a.service_id
LEFT JOIN dbo.staff st ON st.id = a.staff_id
ORDER BY a.appointment_date, a.start_time;
GO
