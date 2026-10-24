USE henkheo;
GO

/* HẸN KHÉO - PAYOS / DYNAMIC VIETQR MIGRATION
   - Không xóa dữ liệu nghiệp vụ.
   - Có thể chạy lại.
   - Bổ sung metadata của payment link PayOS và QR động.
*/

IF OBJECT_ID(N'dbo.payments',N'U') IS NULL
BEGIN
    CREATE TABLE dbo.payments (
        id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_payments PRIMARY KEY,
        appointment_id INT NOT NULL CONSTRAINT UQ_payments_appointment UNIQUE,
        payment_code VARCHAR(50) NOT NULL CONSTRAINT UQ_payments_code UNIQUE,
        amount DECIMAL(12,2) NOT NULL,
        payment_method VARCHAR(20) NOT NULL CONSTRAINT DF_payments_method DEFAULT 'AT_STORE',
        payment_status VARCHAR(20) NOT NULL CONSTRAINT DF_payments_status DEFAULT 'PENDING',
        transaction_code VARCHAR(100) NULL,
        paid_at DATETIME2(0) NULL,
        note NVARCHAR(500) NULL,
        created_at DATETIME2(0) NOT NULL CONSTRAINT DF_payments_created_at DEFAULT SYSDATETIME(),
        updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_payments_updated_at DEFAULT SYSDATETIME(),
        CONSTRAINT FK_payments_appointment FOREIGN KEY (appointment_id) REFERENCES dbo.appointments(id),
        CONSTRAINT CK_payments_amount CHECK (amount >= 0),
        CONSTRAINT CK_payments_method CHECK (payment_method IN ('AT_STORE','ONLINE')),
        CONSTRAINT CK_payments_status CHECK (payment_status IN ('PENDING','PAID','FAILED','CANCELLED','REFUNDED','EXPIRED'))
    );
END;
GO

DECLARE @columns TABLE (name sysname, definition NVARCHAR(1000));
INSERT INTO @columns(name,definition) VALUES
('provider','VARCHAR(30) NULL'),
('provider_order_code','BIGINT NULL'),
('provider_payment_link_id','VARCHAR(100) NULL'),
('checkout_url','NVARCHAR(1000) NULL'),
('qr_code_data','NVARCHAR(4000) NULL'),
('qr_bank_bin','VARCHAR(20) NULL'),
('qr_account_no','VARCHAR(50) NULL'),
('qr_account_name','NVARCHAR(200) NULL'),
('provider_reference','VARCHAR(150) NULL'),
('provider_amount','DECIMAL(12,2) NULL'),
('qr_expires_at','DATETIME2(0) NULL'),
('customer_claimed_at','DATETIME2(0) NULL');

DECLARE @name sysname, @definition NVARCHAR(1000), @sql NVARCHAR(MAX);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT name, definition FROM @columns;
OPEN c;
FETCH NEXT FROM c INTO @name,@definition;
WHILE @@FETCH_STATUS=0
BEGIN
    IF COL_LENGTH('dbo.payments',@name) IS NULL
    BEGIN
        SET @sql=N'ALTER TABLE dbo.payments ADD '+QUOTENAME(@name)+N' '+@definition+N';';
        EXEC sp_executesql @sql;
    END;
    FETCH NEXT FROM c INTO @name,@definition;
END;
CLOSE c;
DEALLOCATE c;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.payments') AND name='CK_payments_status')
    ALTER TABLE dbo.payments DROP CONSTRAINT CK_payments_status;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.payments') AND name='CK_payments_status')
BEGIN
    ALTER TABLE dbo.payments ADD CONSTRAINT CK_payments_status
      CHECK(payment_status IN ('PENDING','PAID','FAILED','CANCELLED','REFUNDED','EXPIRED'));
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_payments_provider_order_code' AND object_id=OBJECT_ID('dbo.payments'))
BEGIN
    CREATE UNIQUE INDEX UX_payments_provider_order_code
      ON dbo.payments(provider_order_code)
      WHERE provider_order_code IS NOT NULL;
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_payments_provider_status' AND object_id=OBJECT_ID('dbo.payments'))
BEGIN
    CREATE INDEX IX_payments_provider_status
      ON dbo.payments(provider,payment_status,qr_expires_at);
END;
GO

PRINT N'✅ Migration PayOS: OK';
GO
