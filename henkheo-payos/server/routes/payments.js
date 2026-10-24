import { Router } from "express";
import crypto from "node:crypto";
import { PayOS } from "@payos/node";
import { poolPromise, sql } from "../db.js";
import {
  authenticateToken,
  requireAdmin,
  requireAdminOrStaff,
  requireCustomer,
} from "../middleware/authMiddleware.js";
import { writeAudit } from "../utils_audit.js";
import { emitToUser, emitToRole } from "../realtime.js";
import { addNotification as addNotificationShared, notifyAdmins as notifyAdminsShared } from "../notify.js";
import { logger } from "../logger.js";
import { decidePaymentOutcome } from "../policy.js";

const router = Router();

function getPayOS() {
  const clientId = process.env.PAYOS_CLIENT_ID?.trim();
  const apiKey = process.env.PAYOS_API_KEY?.trim();
  const checksumKey = process.env.PAYOS_CHECKSUM_KEY?.trim();

  if (!clientId || !apiKey || !checksumKey) {
    const error = new Error("PAYOS_NOT_CONFIGURED");
    error.statusCode = 503;
    throw error;
  }

  return new PayOS({
    clientId,
    apiKey,
    checksumKey,
    partnerCode: process.env.PAYOS_PARTNER_CODE?.trim() || undefined,
    timeout: 30000,
    maxRetries: 3,
  });
}

/* Lấy trạng thái payment link từ payOS bằng phương thức chính thức của SDK (theo orderCode). */
async function fetchRemotePayment(payos, orderCode) {
  const remote = await payos.paymentRequests.get(Number(orderCode));
  return {
    status: String(remote?.status || "").toUpperCase(),
    amountPaid: Number(remote?.amountPaid ?? 0),
    amount: Number(remote?.amount ?? 0),
    reference: remote?.transactions?.[0]?.reference || null,
    transactionDateTime: remote?.transactions?.[0]?.transactionDateTime || null,
  };
}

function buildReturnUrl(base, params) {
  const fallback = "http://localhost:5173/";
  const url = new URL(base || process.env.APP_WEB_URL || fallback);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function makeUniqueOrderCode(pool) {
  for (let i = 0; i < 8; i += 1) {
    const candidate = 100000000 + Math.floor(Math.random() * 800000000);
    const result = await pool
      .request()
      .input("orderCode", sql.BigInt, candidate)
      .query(`SELECT TOP 1 id FROM dbo.payments WHERE provider_order_code=@orderCode`);

    if (!result.recordset.length) return candidate;
  }
  throw new Error("Không tạo được orderCode PayOS duy nhất.");
}

const addNotification = (pool, userId, title, message, type = "PAYMENT") => addNotificationShared(pool, userId, title, message, type);
const notifyAdmins = (pool, title, message, type = "PAYMENT") => notifyAdminsShared(pool, title, message, type, "payment:changed");

async function getCustomerByUserId(pool, userId) {
  const result = await pool
    .request()
    .input("userId", sql.Int, Number(userId))
    .query(`
      SELECT TOP 1 *
      FROM dbo.customers
      WHERE user_id=@userId AND is_active=1
      ORDER BY id
    `);
  return result.recordset[0] || null;
}

async function getAppointment(pool, appointmentId, user) {
  const request = pool
    .request()
    .input("appointmentId", sql.Int, Number(appointmentId));

  let scope = "";
  if (user.role === "CUSTOMER") {
    const customer = await getCustomerByUserId(pool, user.id);
    if (!customer) return null;
    request.input("customerId", sql.Int, customer.id);
    scope = "AND a.customer_id=@customerId";
  }

  if (user.role === "STAFF") {
    request.input("userId", sql.Int, Number(user.id));
    scope = `
      AND EXISTS (
        SELECT 1
        FROM dbo.staff st2
        WHERE st2.id=a.staff_id
          AND st2.user_id=@userId
          AND st2.is_active=1
      )
    `;
  }

  const result = await request.query(`
    SELECT TOP 1
      a.id,
      a.appointment_code,
      a.customer_id,
      a.staff_id,
      a.status,
      a.price_at_booking,
      s.name AS service_name,
      c.full_name AS customer_name,
      c.user_id AS customer_user_id,
      c.phone AS customer_phone,
      c.email AS customer_email,
      st.full_name AS staff_name,
      st.user_id AS staff_user_id,
      p.id AS payment_id,
      p.payment_code,
      p.payment_method,
      p.payment_status,
      p.amount,
      p.transaction_code,
      p.paid_at,
      p.note,
      p.provider,
      p.provider_order_code,
      p.provider_payment_link_id,
      p.checkout_url,
      p.qr_code_data,
      p.qr_bank_bin,
      p.qr_account_no,
      p.qr_account_name,
      p.qr_expires_at,
      p.customer_claimed_at,
      p.provider_reference,
      p.provider_amount
    FROM dbo.appointments a
    INNER JOIN dbo.customers c ON c.id=a.customer_id
    INNER JOIN dbo.services s ON s.id=a.service_id
    LEFT JOIN dbo.staff st ON st.id=a.staff_id
    LEFT JOIN dbo.payments p ON p.appointment_id=a.id
    WHERE a.id=@appointmentId ${scope}
  `);

  return result.recordset[0] || null;
}

function mapPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    appointment_id: row.appointment_id,
    payment_code: row.payment_code,
    amount: Number(row.amount || 0),
    payment_method: row.payment_method,
    payment_status: String(row.payment_status || "PENDING").toUpperCase(),
    transaction_code: row.transaction_code,
    paid_at: row.paid_at,
    note: row.note,
    provider: row.provider,
    provider_order_code:
      row.provider_order_code == null ? null : Number(row.provider_order_code),
    provider_payment_link_id: row.provider_payment_link_id,
    checkout_url: row.checkout_url,
    qr_code_data: row.qr_code_data,
    qr_bank_bin: row.qr_bank_bin,
    qr_account_no: row.qr_account_no,
    qr_account_name: row.qr_account_name,
    qr_expires_at: row.qr_expires_at,
    customer_claimed_at: row.customer_claimed_at,
    provider_reference: row.provider_reference,
    provider_amount:
      row.provider_amount == null ? null : Number(row.provider_amount),
  };
}

async function finalizePayOSPayment({
  pool,
  paymentId,
  orderCode,
  amount,
  reference,
  transactionDateTime: _transactionDateTime,
  actorUserId = null,
  source = "WEBHOOK",
}) {
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const paymentResult = await new sql.Request(tx)
      .input("paymentId", sql.Int, Number(paymentId))
      .query(`
        SELECT TOP 1
          p.id,
          p.appointment_id,
          p.amount,
          p.payment_status,
          p.provider_order_code,
          a.appointment_code,
          a.status AS appointment_status,
          c.user_id AS customer_user_id,
          st.user_id AS staff_user_id,
          s.name AS service_name,
          c.full_name AS customer_name
        FROM dbo.payments p WITH (UPDLOCK,HOLDLOCK)
        INNER JOIN dbo.appointments a ON a.id=p.appointment_id
        INNER JOIN dbo.customers c ON c.id=a.customer_id
        INNER JOIN dbo.services s ON s.id=a.service_id
        LEFT JOIN dbo.staff st ON st.id=a.staff_id
        WHERE p.id=@paymentId
      `);

    const payment = paymentResult.recordset[0];
    if (!payment) {
      await tx.rollback();
      return { changed: false, reason: "NOT_FOUND" };
    }

    const outcome = decidePaymentOutcome({
      expectedAmount: payment.amount,
      receivedAmount: amount,
      paymentStatus: payment.payment_status,
      appointmentStatus: payment.appointment_status,
    });

    if (outcome === "ALREADY_PAID") {
      await tx.commit();
      return { changed: false, reason: "ALREADY_PAID" };
    }

    if (outcome === "AMOUNT_MISMATCH") {
      // Tiền ĐÃ vào tài khoản nhưng sai số: ghi nhận số tiền thực nhận + đánh dấu cần hoàn để không mất dấu.
      await new sql.Request(tx)
        .input("paymentId", sql.Int, Number(paymentId))
        .input("providerAmount", sql.Decimal(12, 2), Number(amount))
        .input("reference", sql.VarChar, reference || null)
        .input(
          "note",
          sql.NVarChar,
          `Từ chối giao dịch: số tiền nhận ${Number(amount).toLocaleString(
            "vi-VN"
          )}đ khác số tiền phải thu ${Number(payment.amount).toLocaleString(
            "vi-VN"
          )}đ.`
        )
        .query(`
          UPDATE dbo.payments
          SET payment_status='FAILED', note=@note,
              provider_amount=@providerAmount,
              provider_reference=COALESCE(@reference,provider_reference),
              refund_requested_at=COALESCE(refund_requested_at,SYSDATETIME()),
              updated_at=SYSDATETIME()
          WHERE id=@paymentId
        `);

      await tx.commit();
      await notifyAdmins(
        pool,
        "Thanh toán lệch số tiền",
        `Lịch ${payment.appointment_code} nhận giao dịch ${Number(
          amount
        ).toLocaleString("vi-VN")}đ nhưng phải thu ${Number(
          payment.amount
        ).toLocaleString("vi-VN")}đ.`,
        "PAYMENT_FAILED"
      );
      return { changed: true, reason: "AMOUNT_MISMATCH" };
    }

    // paid_at dùng SYSDATETIME() (giờ máy chủ) để cùng hệ quy chiếu với completed_at/confirmed_at,
    // nhờ đó thống kê doanh thu theo ngày/tháng không bị lệch múi giờ.
    await new sql.Request(tx)
      .input("paymentId", sql.Int, Number(paymentId))
      .input("reference", sql.VarChar, reference || null)
      .input("providerAmount", sql.Decimal(12, 2), Number(amount))
      .input("needsRefund", sql.Bit, outcome === "PAID_REFUND_NEEDED" ? 1 : 0)
      .query(`
        UPDATE dbo.payments
        SET payment_status='PAID',
            provider_reference=COALESCE(@reference,provider_reference),
            transaction_code=COALESCE(@reference,transaction_code),
            provider_amount=@providerAmount,
            paid_at=COALESCE(paid_at,SYSDATETIME()),
            refund_requested_at=CASE WHEN @needsRefund=1 THEN COALESCE(refund_requested_at,SYSDATETIME()) ELSE refund_requested_at END,
            updated_at=SYSDATETIME()
        WHERE id=@paymentId
      `);

    if (String(payment.appointment_status).toUpperCase() === "PENDING") {
      await new sql.Request(tx)
        .input("appointmentId", sql.Int, Number(payment.appointment_id))
        .input(
          "changedBy",
          sql.Int,
          actorUserId ? Number(actorUserId) : null
        )
        .query(`
          UPDATE dbo.appointments
          SET status='CONFIRMED',
              confirmed_at=COALESCE(confirmed_at,SYSDATETIME()),
              updated_at=SYSDATETIME()
          WHERE id=@appointmentId AND status='PENDING';

          INSERT INTO dbo.appointment_status_history
            (appointment_id,old_status,new_status,changed_by,reason)
          VALUES
            (
              @appointmentId,
              'PENDING',
              'CONFIRMED',
              @changedBy,
              N'Tự động xác nhận sau khi thanh toán online thành công.'
            );
        `);
    }

    await tx.commit();

    // Khách chuyển tiền SAU khi lịch đã bị hủy (QR hết hạn / bị hủy tay): tiền đã vào tài khoản
    // nhưng lịch không còn -> cảnh báo Admin để hoàn tiền hoặc xếp lại lịch cho khách.
    if (outcome === "PAID_REFUND_NEEDED") {
      await addNotification(
        pool,
        payment.customer_user_id,
        "Yêu cầu hoàn tiền đã được ghi nhận",
        `Lịch ${payment.appointment_code} đã bị hủy trước khi thanh toán hoàn tất. Cửa hàng sẽ hoàn ${Number(amount).toLocaleString("vi-VN")}đ cho bạn.`,
        "REFUND_REQUESTED"
      );
      await notifyAdmins(
        pool,
        "Cần hoàn tiền: thanh toán sau khi lịch đã hủy",
        `Lịch ${payment.appointment_code} (${payment.customer_name}) đã bị hủy nhưng nhận ${Number(amount).toLocaleString("vi-VN")}đ. Vui lòng hoàn tiền cho khách hoặc xếp lại lịch.`,
        "PAYMENT_REFUND_NEEDED"
      );
    }

    const amountText = Number(amount).toLocaleString("vi-VN");
    const customerMessage = `Lịch ${payment.appointment_code} – ${payment.service_name} đã thanh toán ${amountText}đ thành công.`;
    const staffMessage = `Lịch ${payment.appointment_code} của ${payment.customer_name} đã thanh toán ${amountText}đ.`;

    await addNotification(
      pool,
      payment.customer_user_id,
      "Thanh toán thành công",
      customerMessage,
      "PAYMENT_SUCCESS"
    );
    await addNotification(
      pool,
      payment.staff_user_id,
      "Khách đã thanh toán",
      staffMessage,
      "PAYMENT_SUCCESS"
    );
    await notifyAdmins(pool, "Đã nhận thanh toán", customerMessage, "PAYMENT_SUCCESS");

    await writeAudit(pool, {
      userId: actorUserId || null,
      action:
        source === "WEBHOOK"
          ? "PAYMENT_WEBHOOK_SUCCESS"
          : "PAYMENT_SYNC_SUCCESS",
      entityType: "PAYMENT",
      entityId: paymentId,
      description: `Thanh toán PayOS thành công cho ${payment.appointment_code}; orderCode=${orderCode}; reference=${reference || ""}.`,
      req: null,
    });

    emitToRole("ADMIN", "appointments:changed", { scope: "ADMIN" });
    emitToRole("STAFF", "appointments:changed", { scope: "STAFF" });
    if (payment.customer_user_id) {
      emitToUser(Number(payment.customer_user_id), "appointments:changed", {
        scope: "CUSTOMER",
      });
    }

    return {
      changed: true,
      reason: "PAID",
      appointment_id: payment.appointment_id,
    };
  } catch (error) {
    try {
      await tx.rollback();
    } catch {}
    throw error;
  }
}

/* Kiểm tra PayOS đã được cấu hình chưa. Không trả key ra client. */
router.get("/config", authenticateToken, requireCustomer, async (_req, res) => {
  const configured = Boolean(
    process.env.PAYOS_CLIENT_ID?.trim() &&
      process.env.PAYOS_API_KEY?.trim() &&
      process.env.PAYOS_CHECKSUM_KEY?.trim()
  );
  res.json({
    online_enabled: configured,
    provider: configured ? "PAYOS" : null,
  });
});

/* Tạo Payment Link PayOS và QR động chuẩn VietQR cho từng lịch. */
router.post(
  "/:appointmentId/qr",
  authenticateToken,
  requireCustomer,
  async (req, res) => {
    try {
      const appointmentId = Number(req.params.appointmentId);
      const pool = await poolPromise;
      const appointment = await getAppointment(pool, appointmentId, req.user);

      if (!appointment) {
        return res.status(404).json({ message: "Không tìm thấy lịch hẹn." });
      }
      if (!appointment.payment_id) {
        return res.status(404).json({ message: "Lịch hẹn chưa có khoản thanh toán." });
      }
      if (String(appointment.payment_method).toUpperCase() !== "ONLINE") {
        return res.status(400).json({ message: "Lịch hẹn này không dùng thanh toán online." });
      }
      if (
        ["CANCELLED", "NO_SHOW", "COMPLETED"].includes(
          String(appointment.status).toUpperCase()
        )
      ) {
        return res.status(409).json({ message: "Lịch hẹn không còn khả dụng để thanh toán online." });
      }
      if (String(appointment.payment_status).toUpperCase() === "PAID") {
        return res.json({
          message: "Khoản thanh toán đã hoàn tất.",
          payment: mapPayment(appointment),
        });
      }

      const payos = getPayOS();
      const now = Date.now();
      const currentExpires = appointment.qr_expires_at
        ? new Date(appointment.qr_expires_at).getTime()
        : 0;

      if (
        String(appointment.provider || "").toUpperCase() === "PAYOS" &&
        appointment.provider_order_code &&
        appointment.checkout_url &&
        appointment.qr_code_data &&
        currentExpires > now + 30_000 &&
        String(appointment.payment_status).toUpperCase() === "PENDING"
      ) {
        return res.json({
          message: "Đã có phiên thanh toán đang hoạt động.",
          payment: mapPayment(appointment),
          provider: {
            name: "payOS",
            bank_bin: appointment.qr_bank_bin,
            account_number: appointment.qr_account_no,
            account_name: appointment.qr_account_name,
          },
        });
      }

      if (appointment.provider_payment_link_id) {
        try {
          await payos.paymentRequests.cancel(
            appointment.provider_payment_link_id,
            "Tạo lại phiên thanh toán"
          );
        } catch (error) {
          console.warn("PayOS cancel old link skipped:", error?.message || error);
        }
      }

      const paymentRow = await pool
        .request()
        .input("paymentId", sql.Int, appointment.payment_id)
        .query(`SELECT TOP 1 * FROM dbo.payments WHERE id=@paymentId`);
      const payment = paymentRow.recordset[0];
      if (!payment) {
        return res.status(404).json({ message: "Không tìm thấy khoản thanh toán." });
      }

      const amount = Math.round(Number(appointment.price_at_booking ?? payment.amount ?? 0));
      if (amount <= 0) {
        return res.status(409).json({ message: "Số tiền thanh toán không hợp lệ." });
      }

      const orderCode = await makeUniqueOrderCode(pool);
      const expireMinutes = Math.max(
        5,
        Math.min(30, Number(process.env.PAYOS_PAYMENT_EXPIRE_MINUTES || 15))
      );
      const expiredAt = Math.floor(
        (Date.now() + expireMinutes * 60 * 1000) / 1000
      );
      const shortDescription = `HK${String(orderCode).slice(-7)}`.slice(0, 9);

      const returnUrl = buildReturnUrl(process.env.PAYOS_RETURN_URL, {
        payment: "success",
        appointmentId,
        orderCode,
      });
      const cancelUrl = buildReturnUrl(process.env.PAYOS_CANCEL_URL, {
        payment: "cancel",
        appointmentId,
        orderCode,
      });

      const link = await payos.paymentRequests.create({
        orderCode,
        amount,
        description: shortDescription,
        buyerName: appointment.customer_name,
        buyerEmail: appointment.customer_email || undefined,
        buyerPhone: appointment.customer_phone || undefined,
        items: [
          {
            name: String(appointment.service_name || "Dịch vụ Hẹn Khéo").slice(0, 100),
            quantity: 1,
            price: amount,
          },
        ],
        cancelUrl,
        returnUrl,
        expiredAt,
      });

      const expiresDate = new Date(expiredAt * 1000);
      const updated = await pool
        .request()
        .input("paymentId", sql.Int, payment.id)
        .input("provider", sql.VarChar, "PAYOS")
        .input("orderCode", sql.BigInt, orderCode)
        .input("linkId", sql.VarChar, link.paymentLinkId || null)
        .input("checkoutUrl", sql.NVarChar, link.checkoutUrl || null)
        .input("qrCodeData", sql.NVarChar, link.qrCode || null)
        .input("expiresAt", sql.DateTime2, expiresDate)
        .input("bankBin", sql.VarChar, link.bin || null)
        .input("accountNo", sql.VarChar, link.accountNumber || null)
        .input("accountName", sql.NVarChar, link.accountName || null)
        .query(`
          UPDATE dbo.payments
          SET provider=@provider,
              provider_order_code=@orderCode,
              provider_payment_link_id=@linkId,
              checkout_url=@checkoutUrl,
              qr_code_data=@qrCodeData,
              qr_expires_at=@expiresAt,
              qr_bank_bin=@bankBin,
              qr_account_no=@accountNo,
              qr_account_name=@accountName,
              amount=${amount},
              payment_status='PENDING',
              updated_at=SYSDATETIME()
          OUTPUT INSERTED.*
          WHERE id=@paymentId
        `);

      await writeAudit(pool, {
        userId: req.user.id,
        action: "CREATE_PAYOS_PAYMENT_LINK",
        entityType: "PAYMENT",
        entityId: payment.id,
        description: `Tạo phiên PayOS cho ${appointment.appointment_code}; orderCode=${orderCode}; amount=${amount}.`,
        req,
      });

      return res.json({
        message: "Đã tạo phiên thanh toán online.",
        payment: mapPayment({ ...updated.recordset[0], appointment_id: appointmentId }),
        provider: {
          name: "payOS",
          bank_bin: link.bin || null,
          account_number: link.accountNumber || null,
          account_name: link.accountName || null,
        },
      });
    } catch (error) {
      console.error("POST PayOS QR:", error);
      if (error?.message === "PAYOS_NOT_CONFIGURED") {
        return res.status(503).json({
          message:
            "Thanh toán online chưa được cấu hình PayOS. Hãy thêm PAYOS_CLIENT_ID, PAYOS_API_KEY và PAYOS_CHECKSUM_KEY vào server/.env.",
        });
      }
      return res.status(500).json({ message: "Không thể tạo QR thanh toán online." });
    }
  }
);

/* Đồng bộ trạng thái từ PayOS; webhook vẫn là nguồn xác nhận chính. */
router.get("/:appointmentId/status", authenticateToken, async (req, res) => {
  try {
    const appointmentId = Number(req.params.appointmentId);
    const pool = await poolPromise;
    const appointment = await getAppointment(pool, appointmentId, req.user);

    if (!appointment) {
      return res.status(404).json({ message: "Không tìm thấy lịch hẹn hoặc bạn không có quyền truy cập." });
    }
    if (!appointment.payment_id) {
      return res.status(404).json({ message: "Lịch hẹn chưa có khoản thanh toán." });
    }

    if (
      String(req.query.sync || "") === "1" &&
      String(appointment.provider || "").toUpperCase() === "PAYOS" &&
      appointment.provider_order_code
    ) {
      try {
        const payos = getPayOS();
        const remote = await fetchRemotePayment(payos, appointment.provider_order_code);
        const remoteStatus = remote.status;

        if (remoteStatus === "PAID") {
          await finalizePayOSPayment({
            pool,
            paymentId: appointment.payment_id,
            orderCode: appointment.provider_order_code,
            amount: remote.amountPaid || remote.amount,
            reference: remote.reference,
            transactionDateTime: remote.transactionDateTime,
            source: "STATUS_SYNC",
          });
        } else if (remoteStatus === "CANCELLED") {
          await pool
            .request()
            .input("paymentId", sql.Int, appointment.payment_id)
            .query(`
              UPDATE dbo.payments
              SET payment_status='CANCELLED', updated_at=SYSDATETIME()
              WHERE id=@paymentId AND payment_status='PENDING'
            `);
        }
      } catch (syncError) {
        console.warn("PayOS status sync skipped:", syncError?.message || syncError);
      }
    }

    const fresh = await getAppointment(pool, appointmentId, req.user);
    return res.json({
      appointment_id: appointmentId,
      appointment_status: fresh.status,
      payment: mapPayment(fresh),
    });
  } catch (error) {
    console.error("GET payment status:", error);
    return res.status(500).json({ message: "Không thể kiểm tra trạng thái thanh toán." });
  }
});

/* Webhook công khai của payOS. Không yêu cầu JWT. */
router.post("/payos/webhook", async (req, res) => {
  try {
    const payos = getPayOS();
    let webhook;
    try {
      webhook = await payos.webhooks.verify(req.body);
    } catch (verifyError) {
      logger.warn("Webhook payOS sai chữ ký / sai định dạng", { err: verifyError });
      return res.status(400).json({ message: "Webhook PayOS không hợp lệ." });
    }
    const data = webhook?.data || req.body?.data || {};

    if (String(data.code || webhook?.code || "00") !== "00") {
      return res.status(200).json({ code: "00", desc: "Webhook non-success ignored" });
    }

    const orderCode = Number(data.orderCode);
    const amount = Number(data.amount);
    if (!Number.isInteger(orderCode) || amount <= 0) {
      return res.status(400).json({ message: "Webhook thiếu orderCode/amount hợp lệ." });
    }

    const pool = await poolPromise;
    const paymentResult = await pool
      .request()
      .input("orderCode", sql.BigInt, orderCode)
      .query(`
        SELECT TOP 1 id
        FROM dbo.payments
        WHERE provider='PAYOS' AND provider_order_code=@orderCode
      `);

    const paymentId = paymentResult.recordset[0]?.id;
    if (!paymentId) {
      return res.status(200).json({ code: "00", desc: "Ignored: orderCode not found" });
    }

    const result = await finalizePayOSPayment({
      pool,
      paymentId,
      orderCode,
      amount,
      reference: data.reference || null,
      transactionDateTime: data.transactionDateTime || null,
      source: "WEBHOOK",
    });

    return res.status(200).json({ code: "00", desc: "Webhook processed", result });
  } catch (error) {
    logger.error("Xử lý webhook payOS lỗi nội bộ", { err: error });
    if (error?.message === "PAYOS_NOT_CONFIGURED") {
      return res.status(503).json({ message: "PayOS chưa được cấu hình." });
    }
    // Lỗi phía máy chủ (DB...) -> 500 để payOS biết giao dịch chưa được xử lý.
    return res.status(500).json({ message: "Lỗi xử lý webhook, vui lòng gửi lại." });
  }
});

/* Admin xác nhận/cập nhật webhook URL trên kênh PayOS. */
router.post("/admin/confirm-webhook", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const webhookUrl = String(
      req.body?.webhookUrl || process.env.PAYOS_WEBHOOK_URL || ""
    ).trim();
    if (!webhookUrl) {
      return res.status(400).json({
        message: "Thiếu webhookUrl. Hãy cấu hình PAYOS_WEBHOOK_URL hoặc gửi webhookUrl.",
      });
    }

    const payos = getPayOS();
    const result = await payos.webhooks.confirm(webhookUrl);
    return res.json({ message: "Đã xác nhận webhook PayOS.", result });
  } catch (error) {
    console.error("Confirm PayOS webhook:", error);
    if (error?.message === "PAYOS_NOT_CONFIGURED") {
      return res.status(503).json({ message: "PayOS chưa được cấu hình." });
    }
    return res.status(500).json({ message: "Không xác nhận được webhook PayOS." });
  }
});

/* Tương thích UI cũ: chỉ đồng bộ trạng thái, không fake PAID. */
router.post("/:appointmentId/pay", authenticateToken, requireCustomer, async (req, res) => {
  try {
    const appointmentId = Number(req.params.appointmentId);
    const pool = await poolPromise;
    const appointment = await getAppointment(pool, appointmentId, req.user);
    if (!appointment) return res.status(404).json({ message: "Không tìm thấy lịch hẹn." });
    if (!appointment.payment_id) return res.status(404).json({ message: "Lịch hẹn chưa có khoản thanh toán." });

    if (String(appointment.payment_status).toUpperCase() === "PAID") {
      return res.json({ message: "Khoản thanh toán đã hoàn tất.", payment: mapPayment(appointment) });
    }

    if (String(appointment.provider || "").toUpperCase() !== "PAYOS" || !appointment.provider_order_code) {
      return res.status(409).json({ message: "Chưa có phiên PayOS. Hãy mở QR thanh toán trước." });
    }

    const payos = getPayOS();
    const remote = await fetchRemotePayment(payos, appointment.provider_order_code);

    if (remote.status === "PAID") {
      await finalizePayOSPayment({
        pool,
        paymentId: appointment.payment_id,
        orderCode: appointment.provider_order_code,
        amount: remote.amountPaid || remote.amount,
        reference: remote.reference,
        transactionDateTime: remote.transactionDateTime,
        actorUserId: req.user.id,
        source: "STATUS_SYNC",
      });
      const fresh = await getAppointment(pool, appointmentId, req.user);
      return res.json({
        message: "Thanh toán đã được hệ thống xác nhận.",
        payment: mapPayment(fresh),
      });
    }

    return res.json({
      message: "Chưa ghi nhận thanh toán. Vui lòng chờ PayOS xác nhận rồi kiểm tra lại.",
      payment: mapPayment(appointment),
    });
  } catch (error) {
    console.error("POST payment status:", error);
    if (error?.message === "PAYOS_NOT_CONFIGURED") {
      return res.status(503).json({ message: "PayOS chưa được cấu hình." });
    }
    return res.status(500).json({ message: "Không thể kiểm tra thanh toán online." });
  }
});

/* Thu tiền tại cơ sở. */
router.patch("/:appointmentId/collect", authenticateToken, requireAdminOrStaff, async (req, res) => {
  try {
    const appointmentId = Number(req.params.appointmentId);
    const pool = await poolPromise;
    const appointment = await getAppointment(pool, appointmentId, req.user);
    if (!appointment) return res.status(404).json({ message: "Không tìm thấy lịch hẹn hoặc bạn không có quyền xử lý lịch này." });
    if (String(appointment.payment_method).toUpperCase() !== "AT_STORE") return res.status(400).json({ message: "Khoản thanh toán này là online." });
    if (String(appointment.payment_status).toUpperCase() === "PAID") return res.json({ message: "Khoản thanh toán đã được thu.", payment: mapPayment(appointment) });
    if (["CANCELLED", "REFUNDED", "EXPIRED"].includes(String(appointment.payment_status).toUpperCase())) return res.status(409).json({ message: "Khoản thanh toán không thể thu." });

    const code = `CASH-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`.slice(0, 100);
    const r = await pool
      .request()
      .input("paymentId", sql.Int, appointment.payment_id)
      .input("code", sql.VarChar, code)
      .query(`
        UPDATE dbo.payments
        SET payment_status='PAID',
            transaction_code=@code,
            paid_at=SYSDATETIME(),
            updated_at=SYSDATETIME()
        WHERE id=@paymentId AND payment_status='PENDING'
      `);

    if (!r.rowsAffected[0]) return res.status(409).json({ message: "Khoản thanh toán vừa được cập nhật." });

    await addNotification(pool, appointment.customer_user_id, "Đã ghi nhận thanh toán", `Khoản thanh toán tại cơ sở của lịch ${appointment.appointment_code} đã được ghi nhận.`, "PAYMENT_SUCCESS");
    await writeAudit(pool, {
      userId: req.user.id,
      action: "COLLECT_PAYMENT_AT_STORE",
      entityType: "PAYMENT",
      entityId: appointment.payment_id,
      description: `Thu tiền tại cơ sở cho ${appointment.appointment_code}.`,
      req,
    });

    const refreshed = await pool
      .request()
      .input("paymentId", sql.Int, appointment.payment_id)
      .query("SELECT TOP 1 * FROM dbo.payments WHERE id=@paymentId");

    emitToRole("ADMIN", "payment:changed", {
      appointmentId,
      paymentStatus: "PAID",
    });
    emitToRole("STAFF", "payment:changed", {
      appointmentId,
      paymentStatus: "PAID",
    });

    res.json({
      message: "Đã ghi nhận thanh toán tại cơ sở.",
      payment: mapPayment({ ...refreshed.recordset[0], appointment_id: appointmentId }),
    });
  } catch (error) {
    console.error("PATCH collect payment:", error);
    res.status(500).json({ message: "Không thể ghi nhận thanh toán tại cơ sở." });
  }
});

/* Admin kiểm tra giao dịch online từ PayOS; không nhập thủ công số tiền/reference. */
router.patch("/:appointmentId/confirm", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const appointmentId = Number(req.params.appointmentId);
    const pool = await poolPromise;
    const appointment = await getAppointment(pool, appointmentId, req.user);
    if (!appointment) return res.status(404).json({ message: "Không tìm thấy lịch hẹn." });
    if (String(appointment.payment_method).toUpperCase() !== "ONLINE") return res.status(400).json({ message: "Chỉ dùng kiểm tra này cho thanh toán online." });
    if (String(appointment.payment_status).toUpperCase() === "PAID") return res.json({ message: "Khoản thanh toán đã được xác nhận.", payment: mapPayment(appointment) });
    if (!appointment.provider_order_code) return res.status(409).json({ message: "Lịch này chưa có phiên PayOS." });

    const payos = getPayOS();
    const remote = await fetchRemotePayment(payos, appointment.provider_order_code);
    if (remote.status !== "PAID") {
      return res.status(409).json({
        message: `PayOS chưa xác nhận giao dịch. Trạng thái hiện tại: ${remote.status || "PENDING"}.`,
      });
    }

    await finalizePayOSPayment({
      pool,
      paymentId: appointment.payment_id,
      orderCode: appointment.provider_order_code,
      amount: remote.amountPaid || remote.amount,
      reference: remote.reference,
      transactionDateTime: remote.transactionDateTime,
      actorUserId: req.user.id,
      source: "STATUS_SYNC",
    });

    const fresh = await getAppointment(pool, appointmentId, req.user);
    return res.json({
      message: "Đã đồng bộ trạng thái thanh toán từ PayOS.",
      payment: mapPayment(fresh),
    });
  } catch (error) {
    console.error("PATCH confirm payment:", error);
    if (error?.message === "PAYOS_NOT_CONFIGURED") return res.status(503).json({ message: "PayOS chưa được cấu hình." });
    return res.status(500).json({ message: "Không thể kiểm tra thanh toán PayOS." });
  }
});

/* Ghi nhận hoàn tiền ở hệ thống. Hoàn tiền tiền thật cần xử lý tại gateway/ngân hàng. */
router.patch("/:appointmentId/refund", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const appointmentId = Number(req.params.appointmentId);
    // Bắt buộc có mã giao dịch hoàn / ghi chú đối soát để kế toán truy vết được khoản tiền đã trả lại thật.
    const reference = String(req.body?.reference || "").trim();
    if (reference.length < 3) return res.status(400).json({ message: "Vui lòng nhập mã giao dịch hoàn tiền (hoặc ghi chú đối soát) sau khi đã chuyển tiền cho khách." });
    const pool = await poolPromise;
    const appointment = await getAppointment(pool, appointmentId, req.user);
    if (!appointment) return res.status(404).json({ message: "Không tìm thấy lịch hẹn." });
    if (String(appointment.status).toUpperCase() !== "CANCELLED") return res.status(409).json({ message: "Chỉ lịch đã hủy mới được ghi nhận hoàn tiền." });
    if (String(appointment.payment_status).toUpperCase() === "REFUNDED") return res.json({ message: "Khoản thanh toán đã được ghi nhận hoàn tiền." });
    const refundable = String(appointment.payment_status).toUpperCase() === "PAID"
      || (String(appointment.payment_status).toUpperCase() === "FAILED" && Number(appointment.provider_amount || 0) > 0);
    if (!refundable) return res.status(409).json({ message: "Chỉ khoản đã thu tiền (PAID, hoặc thu sai số tiền) mới được ghi nhận hoàn tiền." });

    // Giữ nguyên transaction_code gốc của khoản thu; thông tin hoàn tiền lưu ở cột riêng.
    const r = await pool
      .request()
      .input("paymentId", sql.Int, appointment.payment_id)
      .input("reference", sql.NVarChar, reference.slice(0, 100))
      .input("by", sql.Int, Number(req.user.id))
      .query(`
        UPDATE dbo.payments
        SET payment_status='REFUNDED',
            refund_reference=@reference,
            refunded_at=SYSDATETIME(),
            refunded_by=@by,
            updated_at=SYSDATETIME(),
            note=CONCAT(COALESCE(note,N''),N' Đã hoàn tiền (ghi nhận thủ công).')
        WHERE id=@paymentId AND (payment_status='PAID' OR (payment_status='FAILED' AND provider_amount>0))
      `);

    if (!r.rowsAffected[0]) return res.status(409).json({ message: "Khoản thanh toán vừa được cập nhật." });

    await addNotification(pool, appointment.customer_user_id, "Hoàn tiền đã được ghi nhận", `Khoản thanh toán của lịch ${appointment.appointment_code} đã được ghi nhận hoàn tiền.`, "PAYMENT_REFUNDED");
    await writeAudit(pool, {
      userId: req.user.id,
      action: "REFUND_PAYMENT_RECORD",
      entityType: "PAYMENT",
      entityId: appointment.payment_id,
      description: `Ghi nhận hoàn tiền cho ${appointment.appointment_code}. Tham chiếu: ${reference.slice(0, 100)}.`,
      req,
    });

    const refreshed = await pool
      .request()
      .input("paymentId", sql.Int, appointment.payment_id)
      .query("SELECT TOP 1 * FROM dbo.payments WHERE id=@paymentId");

    res.json({
      message: "Đã ghi nhận hoàn tiền trong hệ thống. Việc chuyển tiền hoàn thực tế cần xử lý trên cổng thanh toán.",
      payment: mapPayment({ ...refreshed.recordset[0], appointment_id: appointmentId }),
    });
  } catch (error) {
    console.error("PATCH refund payment:", error);
    res.status(500).json({ message: "Không thể xử lý hoàn tiền." });
  }
});

router.get("/admin/summary", authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT
        COUNT(*) AS total_payments,
        SUM(CASE WHEN payment_status='PAID' THEN 1 ELSE 0 END) AS paid_count,
        SUM(CASE WHEN payment_status='PENDING' THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN payment_status='EXPIRED' THEN 1 ELSE 0 END) AS expired_count,
        COALESCE(SUM(CASE WHEN payment_status='PAID' THEN amount ELSE 0 END),0) AS paid_amount,
        COALESCE(SUM(CASE WHEN payment_status='PENDING' THEN amount ELSE 0 END),0) AS pending_amount,
        SUM(CASE WHEN (payment_status='PAID' OR (payment_status='FAILED' AND provider_amount>0)) AND EXISTS (SELECT 1 FROM dbo.appointments a WHERE a.id=appointment_id AND a.status='CANCELLED') THEN 1 ELSE 0 END) AS refund_pending_count,
        COALESCE(SUM(CASE WHEN (payment_status='PAID' OR (payment_status='FAILED' AND provider_amount>0)) AND EXISTS (SELECT 1 FROM dbo.appointments a WHERE a.id=appointment_id AND a.status='CANCELLED') THEN COALESCE(provider_amount,amount) ELSE 0 END),0) AS refund_pending_amount
      FROM dbo.payments;
    `);
    const row = result.recordset[0] || {};
    res.json({
      total_payments: Number(row.total_payments || 0),
      paid_count: Number(row.paid_count || 0),
      pending_count: Number(row.pending_count || 0),
      expired_count: Number(row.expired_count || 0),
      paid_amount: Number(row.paid_amount || 0),
      pending_amount: Number(row.pending_amount || 0),
      refund_pending_count: Number(row.refund_pending_count || 0),
      refund_pending_amount: Number(row.refund_pending_amount || 0),
    });
  } catch (error) {
    console.error("GET payment summary:", error);
    res.status(500).json({ message: "Không tải được tổng quan thanh toán." });
  }
});

/*
 * Hết thời gian thanh toán:
 * - Payment online PENDING + QR hết hạn -> EXPIRED
 * - Appointment PENDING tương ứng -> CANCELLED để giải phóng slot
 */
export async function expirePendingPayOSPayments() {
  try {
    const pool = await poolPromise;

    // Đối soát trước khi hủy: nếu webhook bị lỡ nhưng payOS đã ghi nhận PAID thì xác nhận lịch
    // thay vì hủy (tránh trường hợp khách đã trả tiền mà lịch vẫn bị hủy).
    try {
      const due = await pool.request().input("nowUtc", sql.DateTime2, new Date()).query(`
        SELECT id, provider_order_code
        FROM dbo.payments
        WHERE payment_method='ONLINE' AND payment_status='PENDING'
          AND provider='PAYOS' AND provider_order_code IS NOT NULL
          AND qr_expires_at IS NOT NULL AND qr_expires_at <= @nowUtc
      `);
      if (due.recordset.length) {
        const payos = getPayOS();
        for (const row of due.recordset) {
          try {
            const remote = await fetchRemotePayment(payos, row.provider_order_code);
            if (remote.status === "PAID") {
              await finalizePayOSPayment({
                pool,
                paymentId: row.id,
                orderCode: row.provider_order_code,
                amount: remote.amountPaid || remote.amount,
                reference: remote.reference,
                transactionDateTime: remote.transactionDateTime,
                source: "STATUS_SYNC",
              });
            }
          } catch (e) {
            console.warn("Đối soát payOS trước khi hết hạn bị bỏ qua:", e?.message || e);
          }
        }
      }
    } catch (e) {
      if (e?.message !== "PAYOS_NOT_CONFIGURED") console.warn("Preflight expire:", e?.message || e);
    }

    const tx = new sql.Transaction(pool);
    // Lưu ý: KHÔNG dùng SERIALIZABLE ở đây vì SQL Server chỉ cho phép hint READPAST
    // (bỏ qua dòng đang bị khoá bởi giao dịch khác, tránh block lẫn nhau giữa nhiều lần
    // chạy job song song) khi mức cô lập là READ COMMITTED hoặc REPEATABLE READ.
    // Hàm này chỉ dọn các thanh toán online đã hết hạn, không cần tính nhất quán tuyệt đối
    // như giao dịch đặt lịch (createAppointmentCore) nên READ COMMITTED là đủ và đúng chuẩn.
    await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

    try {
      const rows = await new sql.Request(tx).input("nowUtc", sql.DateTime2, new Date()).query(`
        SELECT
          p.id AS payment_id,
          p.appointment_id,
          p.amount,
          a.appointment_code,
          a.status AS appointment_status,
          c.user_id AS customer_user_id,
          c.full_name AS customer_name,
          st.user_id AS staff_user_id,
          s.name AS service_name
        FROM dbo.payments p WITH (UPDLOCK,READPAST)
        INNER JOIN dbo.appointments a ON a.id=p.appointment_id
        INNER JOIN dbo.customers c ON c.id=a.customer_id
        INNER JOIN dbo.services s ON s.id=a.service_id
        LEFT JOIN dbo.staff st ON st.id=a.staff_id
        WHERE p.payment_method='ONLINE'
          AND p.payment_status='PENDING'
          AND p.qr_expires_at IS NOT NULL
          AND p.qr_expires_at <= @nowUtc
      `);

      for (const row of rows.recordset) {
        await new sql.Request(tx)
          .input("paymentId", sql.Int, row.payment_id)
          .input("appointmentId", sql.Int, row.appointment_id)
          .query(`
            UPDATE dbo.payments
            SET payment_status='EXPIRED', updated_at=SYSDATETIME()
            WHERE id=@paymentId AND payment_status='PENDING';

            UPDATE dbo.appointments
            SET status='CANCELLED',
                cancelled_at=SYSDATETIME(),
                cancellation_reason=N'Hết thời gian thanh toán online.',
                updated_at=SYSDATETIME()
            WHERE id=@appointmentId AND status='PENDING';

            INSERT INTO dbo.appointment_status_history
              (appointment_id,old_status,new_status,changed_by,reason)
            SELECT @appointmentId,'PENDING','CANCELLED',NULL,N'Hết thời gian thanh toán online.'
            WHERE EXISTS (SELECT 1 FROM dbo.appointments WHERE id=@appointmentId AND status='CANCELLED');
          `);
      }

      await tx.commit();

      for (const row of rows.recordset) {
        const message = `Lịch ${row.appointment_code} – ${row.service_name} đã hết thời gian thanh toán online và được hủy để giải phóng khung giờ.`;
        await addNotification(pool, row.customer_user_id, "Phiên thanh toán hết hạn", message, "PAYMENT_EXPIRED");
        await addNotification(pool, row.staff_user_id, "Lịch chưa thanh toán đã hết hạn", message, "PAYMENT_EXPIRED");
        await notifyAdmins(pool, "Lịch thanh toán hết hạn", message, "PAYMENT_EXPIRED");
        await writeAudit(pool, {
          userId: null,
          action: "EXPIRE_ONLINE_PAYMENT",
          entityType: "PAYMENT",
          entityId: row.payment_id,
          description: message,
          req: null,
        });
      }

      if (rows.recordset.length) {
        emitToRole("ADMIN", "appointments:changed", { scope: "ADMIN" });
        emitToRole("STAFF", "appointments:changed", { scope: "STAFF" });
      }
    } catch (error) {
      try { await tx.rollback(); } catch {}
      throw error;
    }
  } catch (error) {
    console.error("Expire PayOS payments:", error);
  }
  await cancelStuckOnlineAppointments();
}

/**
 * Hủy link thanh toán payOS của một lịch (gọi SAU khi lịch đã bị hủy) để khách không thể quét QR cũ
 * và chuyển tiền vào một lịch đã không còn. Không bao giờ ném lỗi; payOS từ chối (vd: đã thanh toán) thì bỏ qua.
 */
export async function cancelPayOSLinkForAppointment(appointmentId, reason = "Lịch hẹn đã bị hủy") {
  try {
    const pool = await poolPromise;
    const r = await pool.request().input("id", sql.Int, Number(appointmentId)).query(`
      SELECT TOP 1 provider_payment_link_id, payment_status
      FROM dbo.payments
      WHERE appointment_id=@id AND provider='PAYOS' AND provider_payment_link_id IS NOT NULL
    `);
    const row = r.recordset[0];
    if (!row || String(row.payment_status).toUpperCase() === "PAID") return false;
    const payos = getPayOS();
    await payos.paymentRequests.cancel(row.provider_payment_link_id, String(reason).slice(0, 100));
    return true;
  } catch (error) {
    if (error?.message !== "PAYOS_NOT_CONFIGURED") {
      logger.warn("Không hủy được link payOS (bỏ qua)", { appointmentId, err: error });
    }
    return false;
  }
}

const STUCK_GRACE_MINUTES = 10;

/**
 * Lịch ONLINE còn PENDING nhưng khoản thanh toán đã "chết" (FAILED / CANCELLED / EXPIRED) và không được
 * mở lại QR trong STUCK_GRACE_MINUTES phút -> hủy lịch để nhả khung giờ (trước đây lịch bị kẹt vĩnh viễn).
 * Khoản FAILED do lệch số tiền vẫn giữ cờ cần hoàn tiền để Admin hoàn cho khách.
 */
export async function cancelStuckOnlineAppointments() {
  try {
    const pool = await poolPromise;
    const rows = await pool.request().input("grace", sql.Int, STUCK_GRACE_MINUTES).query(`
      SELECT a.id AS appointment_id, a.appointment_code, p.id AS payment_id, p.payment_status,
             c.user_id AS customer_user_id, st.user_id AS staff_user_id
      FROM dbo.appointments a
      INNER JOIN dbo.payments p ON p.appointment_id=a.id
      INNER JOIN dbo.customers c ON c.id=a.customer_id
      LEFT JOIN dbo.staff st ON st.id=a.staff_id
      WHERE a.status='PENDING' AND p.payment_method='ONLINE'
        AND p.payment_status IN ('FAILED','CANCELLED','EXPIRED')
        AND p.updated_at < DATEADD(MINUTE, -@grace, SYSDATETIME())
    `);
    let cancelled = 0;
    for (const row of rows.recordset) {
      const reason = "Thanh toán online không thành công / đã bị hủy nên lịch được tự động hủy.";
      const upd = await pool.request().input("id", sql.Int, row.appointment_id).input("reason", sql.NVarChar, reason).query(`
        UPDATE dbo.appointments
        SET status='CANCELLED', cancelled_at=SYSDATETIME(), cancellation_reason=@reason, updated_at=SYSDATETIME()
        WHERE id=@id AND status='PENDING';
        SELECT @@ROWCOUNT AS n;
      `);
      if (!upd.recordset[0]?.n) continue;
      await pool.request().input("id", sql.Int, row.appointment_id).input("reason", sql.NVarChar, reason).query(`
        INSERT INTO dbo.appointment_status_history(appointment_id,old_status,new_status,changed_by,reason)
        VALUES(@id,'PENDING','CANCELLED',NULL,@reason)
      `);
      cancelled += 1;
      await addNotification(pool, row.customer_user_id, "Lịch hẹn đã tự động hủy", `Lịch ${row.appointment_code} đã bị hủy vì thanh toán online không hoàn tất. Bạn có thể đặt lại.`, "PAYMENT_EXPIRED");
      await addNotification(pool, row.staff_user_id, "Lịch chưa thanh toán đã hủy", `Lịch ${row.appointment_code} đã tự động hủy do thanh toán không thành công.`, "PAYMENT_EXPIRED");
      void cancelPayOSLinkForAppointment(row.appointment_id, "Lịch tự động hủy");
    }
    if (cancelled) {
      emitToRole("ADMIN", "appointments:changed", { scope: "ADMIN" });
      emitToRole("STAFF", "appointments:changed", { scope: "STAFF" });
    }
    return cancelled;
  } catch (error) {
    logger.error("cancelStuckOnlineAppointments", { err: error });
    return 0;
  }
}

export default router;
