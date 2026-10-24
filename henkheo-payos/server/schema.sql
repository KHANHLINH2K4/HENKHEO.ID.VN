/* HEN KHEO - DATABASE SCHEMA V2 - SQL SERVER */
USE henkheo;
GO

/* Run this file on a new/empty database, or after backing up the existing one. */

CREATE TABLE dbo.roles (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_roles PRIMARY KEY,
    name VARCHAR(20) NOT NULL CONSTRAINT UQ_roles_name UNIQUE,
    description NVARCHAR(255) NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_roles_created_at DEFAULT SYSDATETIME()
);
GO

CREATE TABLE dbo.users (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_users PRIMARY KEY,
    role_id INT NOT NULL,
    username VARCHAR(50) NOT NULL CONSTRAINT UQ_users_username UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name NVARCHAR(100) NOT NULL,
    email VARCHAR(150) NULL,
    phone VARCHAR(20) NULL,
    avatar_url VARCHAR(500) NULL,
    is_active BIT NOT NULL CONSTRAINT DF_users_is_active DEFAULT 1,
    last_login_at DATETIME2(0) NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_users_created_at DEFAULT SYSDATETIME(),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_users_updated_at DEFAULT SYSDATETIME(),
    CONSTRAINT FK_users_roles FOREIGN KEY (role_id) REFERENCES dbo.roles(id)
);
GO

CREATE UNIQUE INDEX UX_users_email ON dbo.users(email) WHERE email IS NOT NULL;
GO

CREATE TABLE dbo.customers (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_customers PRIMARY KEY,
    user_id INT NULL,
    full_name NVARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(150) NULL,
    gender VARCHAR(10) NULL,
    date_of_birth DATE NULL,
    address NVARCHAR(255) NULL,
    note NVARCHAR(500) NULL,
    is_active BIT NOT NULL CONSTRAINT DF_customers_is_active DEFAULT 1,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_customers_created_at DEFAULT SYSDATETIME(),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_customers_updated_at DEFAULT SYSDATETIME(),
    CONSTRAINT FK_customers_users FOREIGN KEY (user_id) REFERENCES dbo.users(id),
    CONSTRAINT CK_customers_gender CHECK (gender IS NULL OR gender IN ('MALE','FEMALE','OTHER'))
);
GO

CREATE TABLE dbo.staff (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_staff PRIMARY KEY,
    user_id INT NULL,
    employee_code VARCHAR(30) NOT NULL CONSTRAINT UQ_staff_employee_code UNIQUE,
    full_name NVARCHAR(100) NOT NULL,
    phone VARCHAR(20) NULL,
    email VARCHAR(150) NULL,
    position NVARCHAR(100) NULL,
    specialties NVARCHAR(500) NULL,
    avatar_url VARCHAR(500) NULL,
    hire_date DATE NULL,
    is_active BIT NOT NULL CONSTRAINT DF_staff_is_active DEFAULT 1,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_staff_created_at DEFAULT SYSDATETIME(),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_staff_updated_at DEFAULT SYSDATETIME(),
    CONSTRAINT FK_staff_users FOREIGN KEY (user_id) REFERENCES dbo.users(id)
);
GO

CREATE TABLE dbo.categories (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_categories PRIMARY KEY,
    name NVARCHAR(100) NOT NULL CONSTRAINT UQ_categories_name UNIQUE,
    description NVARCHAR(500) NULL,
    is_active BIT NOT NULL CONSTRAINT DF_categories_is_active DEFAULT 1,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_categories_created_at DEFAULT SYSDATETIME(),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_categories_updated_at DEFAULT SYSDATETIME()
);
GO

CREATE TABLE dbo.services (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_services PRIMARY KEY,
    category_id INT NOT NULL,
    name NVARCHAR(150) NOT NULL,
    duration_minutes INT NOT NULL,
    price DECIMAL(12,2) NOT NULL,
    description NVARCHAR(1000) NULL,
    image_url VARCHAR(500) NULL,
    popular BIT NOT NULL CONSTRAINT DF_services_popular DEFAULT 0,
    is_active BIT NOT NULL CONSTRAINT DF_services_is_active DEFAULT 1,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_services_created_at DEFAULT SYSDATETIME(),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_services_updated_at DEFAULT SYSDATETIME(),
    CONSTRAINT FK_services_categories FOREIGN KEY (category_id) REFERENCES dbo.categories(id),
    CONSTRAINT CK_services_duration CHECK (duration_minutes > 0),
    CONSTRAINT CK_services_price CHECK (price >= 0)
);
GO

CREATE TABLE dbo.staff_schedules (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_staff_schedules PRIMARY KEY,
    staff_id INT NOT NULL,
    work_date DATE NOT NULL,
    start_time TIME(0) NOT NULL,
    end_time TIME(0) NOT NULL,
    is_available BIT NOT NULL CONSTRAINT DF_staff_schedules_is_available DEFAULT 1,
    note NVARCHAR(255) NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_staff_schedules_created_at DEFAULT SYSDATETIME(),
    CONSTRAINT FK_staff_schedules_staff FOREIGN KEY (staff_id) REFERENCES dbo.staff(id),
    CONSTRAINT CK_staff_schedules_time CHECK (end_time > start_time),
    CONSTRAINT UQ_staff_schedule UNIQUE (staff_id, work_date, start_time, end_time)
);
GO

CREATE TABLE dbo.appointments (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_appointments PRIMARY KEY,
    appointment_code VARCHAR(30) NOT NULL CONSTRAINT UQ_appointments_code UNIQUE,
    customer_id INT NOT NULL,
    service_id INT NOT NULL,
    staff_id INT NULL,
    appointment_date DATE NOT NULL,
    start_time TIME(0) NOT NULL,
    end_time TIME(0) NULL,
    price_at_booking DECIMAL(12,2) NOT NULL,
    note NVARCHAR(1000) NULL,
    status VARCHAR(20) NOT NULL CONSTRAINT DF_appointments_status DEFAULT 'PENDING',
    confirmed_at DATETIME2(0) NULL,
    completed_at DATETIME2(0) NULL,
    cancelled_at DATETIME2(0) NULL,
    cancellation_reason NVARCHAR(500) NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_appointments_created_at DEFAULT SYSDATETIME(),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_appointments_updated_at DEFAULT SYSDATETIME(),
    CONSTRAINT FK_appointments_customers FOREIGN KEY (customer_id) REFERENCES dbo.customers(id),
    CONSTRAINT FK_appointments_services FOREIGN KEY (service_id) REFERENCES dbo.services(id),
    CONSTRAINT FK_appointments_staff FOREIGN KEY (staff_id) REFERENCES dbo.staff(id),
    CONSTRAINT CK_appointments_status CHECK (status IN ('PENDING','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW')),
    CONSTRAINT CK_appointments_time CHECK (end_time IS NULL OR end_time > start_time),
    CONSTRAINT CK_appointments_price_at_booking CHECK (price_at_booking >= 0)
);
GO

CREATE TABLE dbo.appointment_status_history (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_appointment_status_history PRIMARY KEY,
    appointment_id INT NOT NULL,
    old_status VARCHAR(20) NULL,
    new_status VARCHAR(20) NOT NULL,
    changed_by INT NULL,
    reason NVARCHAR(500) NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_status_history_created_at DEFAULT SYSDATETIME(),
    CONSTRAINT FK_status_history_appointment FOREIGN KEY (appointment_id) REFERENCES dbo.appointments(id),
    CONSTRAINT FK_status_history_user FOREIGN KEY (changed_by) REFERENCES dbo.users(id),
    CONSTRAINT CK_status_history_status CHECK (new_status IN ('PENDING','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW'))
);
GO

CREATE TABLE dbo.reviews (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_reviews PRIMARY KEY,
    appointment_id INT NOT NULL CONSTRAINT UQ_reviews_appointment UNIQUE,
    customer_id INT NOT NULL,
    rating TINYINT NOT NULL,
    comment NVARCHAR(1000) NULL,
    is_visible BIT NOT NULL CONSTRAINT DF_reviews_is_visible DEFAULT 1,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_reviews_created_at DEFAULT SYSDATETIME(),
    CONSTRAINT FK_reviews_appointment FOREIGN KEY (appointment_id) REFERENCES dbo.appointments(id),
    CONSTRAINT FK_reviews_customer FOREIGN KEY (customer_id) REFERENCES dbo.customers(id),
    CONSTRAINT CK_reviews_rating CHECK (rating BETWEEN 1 AND 5)
);
GO

CREATE TABLE dbo.notifications (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_notifications PRIMARY KEY,
    user_id INT NOT NULL,
    title NVARCHAR(200) NOT NULL,
    message NVARCHAR(1000) NOT NULL,
    type VARCHAR(30) NOT NULL,
    is_read BIT NOT NULL CONSTRAINT DF_notifications_is_read DEFAULT 0,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_notifications_created_at DEFAULT SYSDATETIME(),
    CONSTRAINT FK_notifications_users FOREIGN KEY (user_id) REFERENCES dbo.users(id)
);
GO

CREATE TABLE dbo.activity_logs (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_activity_logs PRIMARY KEY,
    user_id INT NULL,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NULL,
    entity_id INT NULL,
    description NVARCHAR(1000) NULL,
    ip_address VARCHAR(45) NULL,
    user_agent NVARCHAR(500) NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_activity_logs_created_at DEFAULT SYSDATETIME(),
    CONSTRAINT FK_activity_logs_users FOREIGN KEY (user_id) REFERENCES dbo.users(id)
);
GO

INSERT INTO dbo.roles (name, description)
VALUES ('ADMIN', N'Quản trị viên hệ thống'),
       ('STAFF', N'Nhân viên'),
       ('CUSTOMER', N'Khách hàng');
GO

CREATE INDEX IX_appointments_date_status ON dbo.appointments(appointment_date, status);
CREATE INDEX IX_appointments_completed_at ON dbo.appointments(completed_at, status);
CREATE INDEX IX_appointments_customer ON dbo.appointments(customer_id);
CREATE INDEX IX_appointments_staff_date ON dbo.appointments(staff_id, appointment_date);
CREATE INDEX IX_staff_schedules_date ON dbo.staff_schedules(work_date, staff_id);
GO

CREATE VIEW dbo.v_appointment_details AS
SELECT a.id, a.appointment_code,
       c.id AS customer_id, c.full_name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
       s.id AS service_id, s.name AS service_name, s.duration_minutes, s.price,
       st.id AS staff_id, st.full_name AS staff_name,
       a.appointment_date, a.start_time, a.end_time, a.price_at_booking, a.status, a.note,
       a.created_at, a.updated_at
FROM dbo.appointments a
JOIN dbo.customers c ON c.id = a.customer_id
JOIN dbo.services s ON s.id = a.service_id
LEFT JOIN dbo.staff st ON st.id = a.staff_id;
GO

CREATE VIEW dbo.v_service_statistics AS
SELECT s.id AS service_id, s.name AS service_name,
       COUNT(a.id) AS total_appointments,
       SUM(CASE WHEN a.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_appointments,
       SUM(CASE WHEN a.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled_appointments,
       SUM(CASE WHEN a.status = 'COMPLETED' THEN s.price ELSE 0 END) AS total_revenue
FROM dbo.services s
LEFT JOIN dbo.appointments a ON a.service_id = s.id
GROUP BY s.id, s.name;
GO

CREATE VIEW dbo.v_staff_statistics AS
SELECT st.id AS staff_id, st.employee_code, st.full_name,
       COUNT(a.id) AS total_appointments,
       SUM(CASE WHEN a.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_appointments,
       SUM(CASE WHEN a.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled_appointments
FROM dbo.staff st
LEFT JOIN dbo.appointments a ON a.staff_id = st.id
GROUP BY st.id, st.employee_code, st.full_name;
GO
