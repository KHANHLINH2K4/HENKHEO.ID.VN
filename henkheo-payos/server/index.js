import { validateConfig, isProduction, allowedOrigins } from "./config.js"; // PHẢI là import đầu tiên (đặt TZ, nạp .env)
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { setIO } from "./realtime.js";

validateConfig();

import authRouter from "./routes/auth.js";
import servicesRouter from "./routes/services.js";
import staffRouter from "./routes/staff.js";
import staffServicesRouter from "./routes/staffServices.js";
import statsRouter from "./routes/stats.js";
import reportsRouter from "./routes/reports.js";
import staffPortalRouter from "./routes/staffPortal.js";
import appointmentsRouter from "./routes/appointments.js";
import { expireUnconfirmedStoreAppointments, sendAppointmentReminders, purgeOldData } from "./jobs.js";
import { withJobLock } from "./jobLock.js";
import { logger } from "./logger.js";
import crypto from "node:crypto";
import timeOffRouter from "./routes/timeOff.js";
import rescheduleRequestsRouter from "./routes/rescheduleRequests.js";
import customersRouter from "./routes/customers.js";
import chatRouter from "./routes/chat.js";
import notificationsRouter from "./routes/notifications.js";
import reviewsRouter from "./routes/reviews.js";
import activityLogsRouter from "./routes/activityLogs.js";
import staffSchedulesRouter from "./routes/staffSchedules.js";
import paymentsRouter, { expirePendingPayOSPayments } from "./routes/payments.js";
import { poolPromise } from "./db.js";
import { verifyAccessToken } from "./middleware/authMiddleware.js";

const app = express();
const httpServer = createServer(app);
const origins = allowedOrigins();
// Dev (chưa đặt CORS_ORIGIN): cho phép mọi origin để Vite proxy hoạt động. Production: chỉ origin khai báo.
const corsOrigin = origins.length ? origins : isProduction ? false : true;
const io = new Server(httpServer, {
  cors: { origin: corsOrigin, credentials: false },
});

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("UNAUTHORIZED"));
    socket.user = await verifyAccessToken(token);
    next();
  } catch {
    next(new Error("UNAUTHORIZED"));
  }
});

io.on("connection", (socket) => {
  const id = Number(socket.user?.id);
  const role = String(socket.user?.role || "").toUpperCase();
  if (id) socket.join(`user:${id}`);
  if (role) socket.join(`role:${role}`);
});
setIO(io);

// Số lớp reverse proxy tin cậy phía trước (Nginx = 1; Cloudflare + Nginx = 2; chạy trực tiếp = 0).
const trustProxy = process.env.TRUST_PROXY ?? "1";
app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === "true" ? true : trustProxy === "false" ? false : trustProxy);

// Mã yêu cầu + nhật ký truy cập
app.use((req, res, next) => {
  req.id = req.headers["x-request-id"] || crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    if (req.path === "/api/live") return;
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (req.path.startsWith("/api") || res.statusCode >= 500) {
      logger[res.statusCode >= 500 ? "error" : "info"]("http", { id: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms), ip: req.ip });
    }
  });
  next();
});

// Header bảo mật cơ bản
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "img-src": ["'self'", "data:", "https:"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "font-src": ["'self'", "data:"],
      "connect-src": ["'self'", "ws:", "wss:"],
      "script-src": ["'self'"],
    },
  },
}));
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "1mb" }));

// Rate limit
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Bạn thao tác đăng nhập/đăng ký quá nhiều lần. Vui lòng thử lại sau ít phút." },
});
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Bạn gửi tin nhắn quá nhanh. Vui lòng chờ một chút rồi thử lại." },
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", apiLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);
app.use("/api/auth/reset-password", authLimiter);
app.use("/api/chat", chatLimiter);

app.use("/api/auth", authRouter);
app.use("/api/services", servicesRouter);
app.use("/api/staff", staffRouter);
app.use("/api/staff-services", staffServicesRouter);
app.use("/api/admin/stats", statsRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/staff-portal", staffPortalRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api/reschedule-requests", rescheduleRequestsRouter);
app.use("/api/customers", customersRouter);
app.use("/api/chat", chatRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/reviews", reviewsRouter);
app.use("/api/activity-logs", activityLogsRouter);
app.use("/api/staff-schedules", staffSchedulesRouter);
app.use("/api/time-off", timeOffRouter);
app.use("/api/payments", paymentsRouter);

// Liveness
app.get("/api/live", (req, res) => res.json({ ok: true }));

// Readiness: kiểm tra kết nối CSDL PostgreSQL
app.get("/api/health", async (req, res) => {
  try {
    const pool = await poolPromise;
    await pool.query("SELECT 1 AS ok");
    res.json({ ok: true, db: "up", message: "Hẹn Khéo API đang hoạt động", time: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ ok: false, db: "down", message: "Không kết nối được cơ sở dữ liệu." });
  }
});

// API không tồn tại -> 404 JSON
app.use("/api", (req, res) => res.status(404).json({ message: "Không tìm thấy API." }));

// Production: phục vụ giao diện client/dist
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../client/dist");
if (fs.existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist, { maxAge: "1h", index: false }));
  app.get(/^(?!\/(api|socket\.io)\/).*/, (req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

// Bắt lỗi chung
app.use((err, req, res, next) => {
  if (err?.type === "entity.parse.failed") return res.status(400).json({ message: "Dữ liệu gửi lên không phải JSON hợp lệ." });
  logger.error("Unhandled error", { err, id: req.id, path: req.path });
  res.status(500).json({ message: "Lỗi máy chủ. Vui lòng thử lại.", requestId: req.id });
});

process.on("unhandledRejection", (reason) => console.error("unhandledRejection:", reason));

const PORT = Number(process.env.PORT) || 5000;
let expireTimer = null;
let jobsTimer = null;
let purgeTimer = null;

httpServer.listen(PORT, async () => {
  console.log(`✅ Hẹn Khéo server đang chạy tại http://localhost:${PORT} (TZ=${process.env.TZ}, ${isProduction ? "production" : "development"})`);
  try {
    const pool = await poolPromise; // Lấy kết nối pool PostgreSQL
    await pool.query("SELECT 1");
    console.log("✅ Đã kết nối thành công với PostgreSQL (Supabase).");
    
    const { pendingMigrations } = await import("./migrate.js");
    const pending = await pendingMigrations(pool);
    if (pending.length) {
      console.error("❌ Cơ sở dữ liệu chưa được cập nhật lên phiên bản mới. Còn thiếu:");
      for (const name of pending) console.error(`   - ${name}`);
      console.error("   Hãy dừng server, chạy:  npm run db:migrate  rồi chạy lại  npm run dev");
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Không kết nối được cơ sở dữ liệu:", error.message);
    process.exit(1);
  }

  if (String(process.env.ENABLE_BACKGROUND_JOBS ?? "true").toLowerCase() === "false") {
    console.log("Việc nền đang TẮT (ENABLE_BACKGROUND_JOBS=false) — hãy bảo đảm có instance khác chạy việc nền.");
    return;
  }

  // Việc nền có khóa CSDL
  const payJob = () => withJobLock("expire-payos", expirePendingPayOSPayments);
  await payJob();
  expireTimer = setInterval(payJob, 60 * 1000);

  const runJobs = () => withJobLock("housekeeping", async () => { await expireUnconfirmedStoreAppointments(); await sendAppointmentReminders(); });
  await runJobs();
  jobsTimer = setInterval(runJobs, 5 * 60 * 1000);

  // Dọn dữ liệu quá hạn mỗi 6 giờ
  const purge = () => withJobLock("purge", purgeOldData);
  await purge();
  purgeTimer = setInterval(purge, 6 * 60 * 60 * 1000);
});

async function shutdown(signal) {
  console.log(`${signal} nhận được, đang tắt server...`);
  if (expireTimer) clearInterval(expireTimer);
  if (jobsTimer) clearInterval(jobsTimer);
  if (purgeTimer) clearInterval(purgeTimer);
  io.close();
  httpServer.close(async () => {
    try { 
      const pool = await poolPromise;
      if (pool && pool.end) await pool.end(); 
    } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));