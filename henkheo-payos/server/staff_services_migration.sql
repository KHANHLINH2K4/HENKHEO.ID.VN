USE henkheo;
GO

IF OBJECT_ID(N'dbo.staff_services', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.staff_services (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_staff_services PRIMARY KEY,
        service_id INT NOT NULL,
        staff_id INT NOT NULL,
        is_active BIT NOT NULL CONSTRAINT DF_staff_services_is_active DEFAULT 1,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_staff_services_created_at DEFAULT SYSDATETIME(),
        updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_staff_services_updated_at DEFAULT SYSDATETIME(),
        CONSTRAINT FK_staff_services_service FOREIGN KEY (service_id) REFERENCES dbo.services(id),
        CONSTRAINT FK_staff_services_staff FOREIGN KEY (staff_id) REFERENCES dbo.staff(id),
        CONSTRAINT UQ_staff_services UNIQUE (service_id, staff_id)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_staff_services_service' AND object_id=OBJECT_ID('dbo.staff_services'))
    CREATE INDEX IX_staff_services_service ON dbo.staff_services(service_id, is_active);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_staff_services_staff' AND object_id=OBJECT_ID('dbo.staff_services'))
    CREATE INDEX IX_staff_services_staff ON dbo.staff_services(staff_id, is_active);
GO

/*
  MIGRATION DỮ LIỆU BAN ĐẦU
  ----------------------------------
  Mỗi dòng dưới đây là một quan hệ: nhân viên được phép thực hiện dịch vụ.
  Bạn có thể thêm/xóa dòng theo năng lực thực tế của từng nhân viên.

  Ví dụ lấy ID tự động theo mã nhân viên + tên dịch vụ.
*/

/* Các phân công ban đầu theo chuyên môn hiện có trong seed */
INSERT INTO dbo.staff_services(service_id, staff_id)
SELECT s.id, st.id
FROM dbo.services s
CROSS JOIN dbo.staff st
WHERE st.employee_code='NV001'
  AND s.name IN (N'Cắt tóc nam', N'Gội đầu thư giãn')
  AND NOT EXISTS (SELECT 1 FROM dbo.staff_services x WHERE x.service_id=s.id AND x.staff_id=st.id);

INSERT INTO dbo.staff_services(service_id, staff_id)
SELECT s.id, st.id
FROM dbo.services s
CROSS JOIN dbo.staff st
WHERE st.employee_code='NV002'
  AND s.name IN (N'Chăm sóc da cơ bản', N'Chăm sóc da chuyên sâu')
  AND NOT EXISTS (SELECT 1 FROM dbo.staff_services x WHERE x.service_id=s.id AND x.staff_id=st.id);

INSERT INTO dbo.staff_services(service_id, staff_id)
SELECT s.id, st.id
FROM dbo.services s
CROSS JOIN dbo.staff st
WHERE st.employee_code='NV003'
  AND s.name IN (N'Sơn gel', N'Làm móng cơ bản')
  AND NOT EXISTS (SELECT 1 FROM dbo.staff_services x WHERE x.service_id=s.id AND x.staff_id=st.id);

INSERT INTO dbo.staff_services(service_id, staff_id)
SELECT s.id, st.id
FROM dbo.services s
CROSS JOIN dbo.staff st
WHERE st.employee_code='NV004'
  AND s.name IN (N'Massage thư giãn 60 phút', N'Chăm sóc body')
  AND NOT EXISTS (SELECT 1 FROM dbo.staff_services x WHERE x.service_id=s.id AND x.staff_id=st.id);
GO

/* Kiểm tra */
SELECT
    s.id AS service_id,
    s.name AS service_name,
    COUNT(ss.staff_id) AS staff_count
FROM dbo.services s
LEFT JOIN dbo.staff_services ss
    ON ss.service_id=s.id AND ss.is_active=1
WHERE s.is_active=1
GROUP BY s.id, s.name
ORDER BY s.id;
GO

/*
  ĐỂ CÓ 2-3 NHÂN VIÊN CHO MỘT DỊCH VỤ:
  Ví dụ (chỉ chạy khi hai nhân viên thực tế có thể làm dịch vụ):

  INSERT INTO dbo.staff_services(service_id, staff_id)
  SELECT s.id, st.id
  FROM dbo.services s
  CROSS JOIN dbo.staff st
  WHERE s.name=N'Cắt tóc nam'
    AND st.employee_code IN ('NV001','NV002')
    AND NOT EXISTS (SELECT 1 FROM dbo.staff_services x WHERE x.service_id=s.id AND x.staff_id=st.id);

  Không dùng specialties để quyết định nghiệp vụ nữa; specialties chỉ dùng để hiển thị thông tin nhân viên.
*/
