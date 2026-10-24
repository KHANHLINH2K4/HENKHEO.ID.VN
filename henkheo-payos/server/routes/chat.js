/*
 * Hẹn Khéo — Route /api/chat (tầng HTTP của chatbot NLP).
 *
 * Tầng này CHỈ lo: xác thực (tuỳ chọn), đọc/ghi hội thoại trong SQL Server,
 * và điều phối luồng đặt lịch nhiều lượt (slot-filling). Toàn bộ xử lý ngôn
 * ngữ tự nhiên thuần tuý (tokenize, TF-IDF, cosine similarity, khớp mờ
 * Levenshtein, trích xuất thực thể) nằm ở server/nlp.js — tách biệt để có thể
 * kiểm thử độc lập (xem server/nlp_eval.js).
 *
 * "Ứng dụng" NLP đúng nghĩa: khi nhận diện intent BOOKING, chatbot không chỉ trả
 * lời mà chủ động hỏi lại để thu thập dịch vụ/ngày/giờ còn thiếu, rồi gọi thẳng
 * createAppointmentCore() — CÙNG một lõi nghiệp vụ với đặt lịch qua giao diện,
 * để đảm bảo không có đường tắt bỏ qua kiểm tra ca làm / chống trùng lịch.
 */
import { Router } from "express";
import { poolPromise, sql } from "../db.js";
import { authenticateToken, requireAdmin, verifyAccessToken } from "../middleware/authMiddleware.js";
import { writeAudit } from "../utils_audit.js";
import crypto from "node:crypto";
import { policyConfig, minutesToHHMM } from "../policy.js";
import { createAppointmentCore, computeBookingOptions, timeToMin } from "./appointments.js";
import { normalize, classifyIntent, extractEntities, vector, cosine } from "../nlp.js";

const router = Router();

/* Chat cho phép khách chưa đăng nhập; nếu có token thì phải còn hợp lệ (tài khoản chưa bị khóa, chưa đổi mật khẩu). */
async function optionalUser(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return null;
  try { return await verifyAccessToken(h.slice(7)); } catch { return null; }
}

async function getServices(pool) {
  const r = await pool.request().query(`SELECT s.id,s.name,s.duration_minutes,s.price,s.description,c.name AS category_name FROM dbo.services s JOIN dbo.categories c ON c.id=s.category_id WHERE s.is_active=1 AND c.is_active=1 ORDER BY s.popular DESC,s.id`);
  return r.recordset;
}

/*
 * Hội thoại của khách CHƯA đăng nhập được bảo vệ bằng token HMAC không đoán được (id tăng dần thì ai cũng đoán được).
 * Token không cần lưu CSDL: HMAC(JWT_SECRET, "chat:<id>"). Khách đã đăng nhập thì kiểm tra theo user_id.
 */
export function conversationToken(id) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET || "dev").update(`chat:${Number(id)}`).digest("hex").slice(0, 32);
}
export function validConversationToken(id, token) {
  const a = Buffer.from(conversationToken(id));
  const b = Buffer.from(String(token || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function getConversation(pool, userId, conversationId, title, token) {
  if (conversationId && (userId != null || validConversationToken(conversationId, token))) {
    const r = await pool.request().input("id", sql.Int, Number(conversationId)).input("userId", sql.Int, userId == null ? null : Number(userId)).query(`SELECT TOP 1 id, flow_state, draft_json FROM dbo.chat_conversations WHERE id=@id AND (user_id=@userId OR (@userId IS NULL AND user_id IS NULL))`);
    if (r.recordset.length) return { id: Number(r.recordset[0].id), flowState: r.recordset[0].flow_state || null, draft: r.recordset[0].draft_json ? JSON.parse(r.recordset[0].draft_json) : {} };
  }
  const r = await pool.request().input("userId", sql.Int, userId == null ? null : Number(userId)).input("title", sql.NVarChar, String(title || "Cuộc trò chuyện Hẹn Khéo").slice(0, 200)).query("INSERT INTO dbo.chat_conversations(user_id,title) OUTPUT INSERTED.id VALUES(@userId,@title)");
  return { id: Number(r.recordset[0].id), flowState: null, draft: {} };
}

async function saveFlow(pool, conversationId, flowState, draft) {
  await pool.request()
    .input("id", sql.Int, conversationId)
    .input("flowState", sql.VarChar, flowState)
    .input("draft", sql.NVarChar, JSON.stringify(draft || {}).slice(0, 1000))
    .query("UPDATE dbo.chat_conversations SET flow_state=@flowState, draft_json=@draft, updated_at=SYSDATETIME() WHERE id=@id");
}

/* ------------------------------------------------------------------ */
/* Câu trả lời tĩnh theo intent (khi không ở trong luồng đặt lịch)      */
/* ------------------------------------------------------------------ */
function replyFor(intent, service) {
  if (intent === "GREETING") return "Xin chào 👋 Mình là trợ lý Hẹn Khéo. Bạn có thể hỏi dịch vụ, giá, thời lượng, giờ làm việc, hoặc nói \"tôi muốn đặt lịch\" để mình đặt giúp bạn ngay trong khung chat này.";
  if (intent === "SERVICE_LIST") return null;
  if (intent === "WORKING_HOURS") { const c = policyConfig(); return `Hẹn Khéo hoạt động từ ${minutesToHHMM(c.openMinutes)} đến ${minutesToHHMM(c.closeMinutes)}. Giờ thực tế còn phụ thuộc ca làm của nhân viên và thời lượng dịch vụ.`; }
  if (intent === "CANCEL") return "Bạn vào Lịch của tôi → chọn lịch PENDING/CONFIRMED → Hủy lịch và nhập lý do.";
  if (intent === "RESCHEDULE") return "Bạn vào Lịch của tôi → chọn lịch PENDING/CONFIRMED → Đổi lịch. Hệ thống sẽ kiểm tra lại ca làm và trùng lịch.";
  if (intent === "MY_APPOINTMENTS") return "Bạn vào mục Lịch của tôi để xem trạng thái, giá lúc đặt, đổi/hủy lịch và đánh giá sau khi hoàn thành.";
  if (service) {
    if (intent === "PRICE") return `${service.name} có giá ${Number(service.price || 0).toLocaleString("vi-VN")}đ.`;
    if (intent === "DURATION") return `${service.name} có thời lượng ${Number(service.duration_minutes || 0)} phút.`;
    return `${service.name}: ${service.description || "Đang được cung cấp tại Hẹn Khéo."}\nGiá: ${Number(service.price || 0).toLocaleString("vi-VN")}đ\nThời lượng: ${Number(service.duration_minutes || 0)} phút.`;
  }
  return "Mình chưa chắc về yêu cầu này. Bạn thử hỏi: “giá cắt tóc nam?”, “có những dịch vụ nào?”, “giờ làm việc?”, “tôi muốn đặt lịch cắt tóc ngày mai 14h”, “hủy lịch” hoặc “đổi lịch”.";
}

/* ------------------------------------------------------------------ */
/* Luồng đặt lịch nhiều lượt hội thoại (slot-filling)                   */
/* ------------------------------------------------------------------ */
const pad2 = (n) => String(n).padStart(2, "0");
const DOW_LABEL = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const dateLabel = (iso) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return `${DOW_LABEL[d.getDay()]} ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
};
const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/* Tìm nhân viên phù hợp còn trống đúng khung giờ khách yêu cầu; nếu không có,
   gợi ý các khung giờ trống gần nhất (tối đa 6 gợi ý) — tái sử dụng buildSlots
   và getEffectiveSchedules giống hệt route GET /booking-options. */
async function findSlotForBooking(pool, { serviceId, date, time }) {
  const data = await computeBookingOptions(pool, { serviceId, date });
  if (!data) return { ok: false, suggestions: [] };
  for (const st of data.staff) {
    if (time && st.slots.includes(time)) return { ok: true, staffId: st.id, staffName: st.name, time };
  }
  return { ok: false, suggestions: data.any.slots.slice(0, 6) };
}

const CANCEL_FLOW_WORDS = /\b(huy di|thoi khong dat|khong dat nua|dung lai|thoi khoi|huy dat lich)\b/;

async function handleBookingFlow(pool, { user, flowState, draft, text, entities, services }) {
  const t = normalize(text);

  if (flowState && CANCEL_FLOW_WORDS.test(t)) {
    return { flowState: null, draft: {}, reply: "Đã huỷ yêu cầu đặt lịch qua chat. Bạn có thể hỏi lại bất cứ lúc nào bằng câu \"tôi muốn đặt lịch\"." };
  }

  // Gộp thực thể mới nhận diện được vào bản nháp hiện tại.
  const nextDraft = { ...draft };
  if (entities.serviceEntity && !nextDraft.serviceId) {
    nextDraft.serviceId = entities.serviceEntity.service_id;
    nextDraft.serviceName = entities.serviceEntity.service_name;
  }
  if (entities.date && !nextDraft.date) nextDraft.date = entities.date;
  if (entities.time && !nextDraft.time) nextDraft.time = entities.time;

  if (!user) {
    return {
      flowState: null,
      draft: {},
      reply: "Để đặt lịch qua chatbot, bạn cần đăng nhập bằng tài khoản khách hàng trước nhé. Đăng nhập xong bạn nhắn lại \"tôi muốn đặt lịch\" giúp mình.",
      action: { type: "LOGIN_REQUIRED" },
    };
  }
  if (user.role !== "CUSTOMER") {
    return { flowState: null, draft: {}, reply: "Đặt lịch qua chatbot hiện chỉ áp dụng cho tài khoản khách hàng. Bạn dùng màn hình quản trị/nhân viên để thao tác lịch hẹn nhé." };
  }

  if (!nextDraft.serviceId) {
    return { flowState: "COLLECT_SERVICE", draft: nextDraft, reply: "Bạn muốn đặt dịch vụ gì? (VD: cắt tóc nam, gội đầu dưỡng sinh, chăm sóc da mặt...)" };
  }
  if (!nextDraft.date) {
    return { flowState: "COLLECT_DATE", draft: nextDraft, reply: `Bạn muốn đặt "${nextDraft.serviceName}" vào ngày nào? (VD: hôm nay, ngày mai, thứ 5, 20/10)` };
  }
  const todayISO = toISO(new Date(new Date().setHours(0, 0, 0, 0)));
  if (nextDraft.date < todayISO) {
    return { flowState: "COLLECT_DATE", draft: { ...nextDraft, date: null }, reply: "Ngày bạn chọn đã qua rồi. Bạn muốn đặt vào ngày nào khác?" };
  }
  if (!nextDraft.time) {
    return { flowState: "COLLECT_TIME", draft: nextDraft, reply: `Ngày ${dateLabel(nextDraft.date)} bạn muốn đến lúc mấy giờ? (giờ mở cửa ${minutesToHHMM(policyConfig().openMinutes)}–${minutesToHHMM(policyConfig().closeMinutes)}, VD: 14h hoặc 14:30)` };
  }
  const startMin = timeToMin(`${nextDraft.time}:00`);
  const hoursCfg = policyConfig();
  if (startMin < hoursCfg.openMinutes || startMin >= hoursCfg.closeMinutes) {
    return { flowState: "COLLECT_TIME", draft: { ...nextDraft, time: null }, reply: `Hẹn Khéo chỉ nhận khách từ ${minutesToHHMM(hoursCfg.openMinutes)} đến ${minutesToHHMM(hoursCfg.closeMinutes)}. Bạn chọn lại giờ khác giúp mình nhé.` };
  }

  if (!nextDraft.staffId) {
    const found = await findSlotForBooking(pool, { serviceId: nextDraft.serviceId, date: nextDraft.date, time: nextDraft.time });
    if (!found.ok) {
      const suggestionText = found.suggestions.length
        ? `Các khung giờ còn trống ngày ${dateLabel(nextDraft.date)}: ${found.suggestions.join(", ")}.`
        : `Ngày ${dateLabel(nextDraft.date)} hiện không còn nhân viên nào nhận khách cho dịch vụ này.`;
      return { flowState: "COLLECT_TIME", draft: { ...nextDraft, time: null }, reply: `Khung giờ ${nextDraft.time} không còn trống. ${suggestionText} Bạn chọn giờ khác giúp mình nhé.` };
    }
    nextDraft.staffId = found.staffId;
    nextDraft.staffName = found.staffName;
  }

  if (flowState !== "CONFIRM") {
    const price = services.find((s) => Number(s.id) === Number(nextDraft.serviceId))?.price;
    const priceText = price != null ? `, giá ${Number(price).toLocaleString("vi-VN")}đ` : "";
    return {
      flowState: "CONFIRM",
      draft: nextDraft,
      reply: `Xác nhận giúp mình: "${nextDraft.serviceName}" với ${nextDraft.staffName}, ngày ${dateLabel(nextDraft.date)} lúc ${nextDraft.time}${priceText}, thanh toán tại cơ sở. Bạn gõ "có" để đặt hoặc "không" để huỷ.`,
    };
  }

  // flowState === CONFIRM và người dùng vừa nhắn thêm — kiểm tra ý định đồng ý/từ chối.
  const affirmScore = cosine(vector(t), vector("dong y"));
  const isAffirm = /\b(co|dong y|ok|xac nhan|chot|dung roi|duoc|yes)\b/.test(t) || affirmScore > 0.6;
  const isDeny = /\b(khong|thoi|huy|sai roi|no)\b/.test(t);

  if (isDeny && !isAffirm) {
    return { flowState: null, draft: {}, reply: "Đã huỷ yêu cầu đặt lịch qua chat. Bạn có thể đặt lại bất cứ lúc nào." };
  }
  if (!isAffirm) {
    return { flowState: "CONFIRM", draft: nextDraft, reply: "Bạn xác nhận đặt lịch này giúp mình bằng cách gõ \"có\" hoặc \"không\" nhé." };
  }

  const result = await createAppointmentCore(pool, {
    userId: user.id,
    serviceId: nextDraft.serviceId,
    staffId: nextDraft.staffId,
    date: nextDraft.date,
    time: `${nextDraft.time}:00`,
    note: "Đặt qua chatbot NLP",
    paymentMethod: "AT_STORE",
    source: "CHAT",
  });

  if (result.status === 201) {
    return {
      flowState: null,
      draft: {},
      reply: `Đặt lịch thành công! Mã lịch hẹn: ${result.body.appointment_code}. Lịch đang ở trạng thái chờ xác nhận (PENDING). Bạn có thể xem/đổi/huỷ trong mục "Lịch của tôi".`,
      action: { type: "BOOKING_DONE", appointmentCode: result.body.appointment_code },
    };
  }
  if (result.status === 409) {
    return { flowState: "COLLECT_TIME", draft: { ...nextDraft, time: null, staffId: null, staffName: null }, reply: `${result.body.message} Bạn chọn giờ khác giúp mình nhé.` };
  }
  return { flowState: null, draft: {}, reply: `Rất tiếc, mình chưa đặt được lịch (${result.body.message}). Bạn thử lại hoặc dùng màn hình Đặt lịch giúp mình nhé.` };
}

const START_BOOKING_WORDS = /\b(dat lich|dat hen|book lich|muon dat)\b/;

/* ------------------------------------------------------------------ */
/* Route chính                                                          */
/* ------------------------------------------------------------------ */
router.post("/", async (req, res) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const last = [...messages].reverse().find((m) => m?.role === "user" && String(m.text || "").trim());
    if (!last) return res.status(400).json({ message: "Thiếu câu hỏi của người dùng." });
    // Giới hạn độ dài trước khi đưa vào NLP/CSDL để tránh tin nhắn khổng lồ làm chậm hệ thống.
    last.text = String(last.text).slice(0, 500);

    const pool = await poolPromise;
    const services = await getServices(pool);
    const user = await optionalUser(req);
    const conversation = await getConversation(pool, user?.id || null, req.body?.conversationId, last.text, req.body?.conversationToken);

    const classification = classifyIntent(last.text);
    const entities = extractEntities(last.text, services);
    const service = entities.serviceEntity ? services.find((s) => Number(s.id) === Number(entities.serviceEntity.service_id)) : null;

    let reply;
    let flowState = conversation.flowState;
    let draft = conversation.draft;
    let action = null;

    const inFlow = !!flowState;
    const startingBooking = !inFlow && (classification.intent === "BOOKING" || START_BOOKING_WORDS.test(normalize(last.text)));
    // Khi câu có nhiều thực thể (ngày/giờ/dịch vụ), mô hình bag-of-words/TF-IDF đôi khi
    // lệch intent (VD: "đặt lịch cắt tóc ngày mai 14h" có thể lệch về PRICE vì token
    // "cắt","tóc" trùng mẫu PRICE nhiều hơn). Từ khoá đặt lịch tường minh luôn được ưu
    // tiên hơn kết quả phân loại thống kê để tránh bỏ sót ý định đặt lịch.
    if (startingBooking && classification.intent !== "BOOKING") {
      classification.intent = "BOOKING";
    }

    if (inFlow || startingBooking) {
      const flowResult = await handleBookingFlow(pool, { user, flowState, draft, text: last.text, entities, services });
      flowState = flowResult.flowState;
      draft = flowResult.draft;
      reply = flowResult.reply;
      action = flowResult.action || null;
    } else {
      reply = replyFor(classification.intent, service);
      if (classification.intent === "SERVICE_LIST") {
        const groups = new Map();
        for (const s of services) {
          if (!groups.has(s.category_name)) groups.set(s.category_name, []);
          groups.get(s.category_name).push(`• ${s.name} — ${Number(s.price).toLocaleString("vi-VN")}đ — ${s.duration_minutes} phút`);
        }
        reply = [...groups.entries()].map(([c, rows]) => `${c}:\n${rows.join("\n")}`).join("\n\n") || "Hiện chưa có dịch vụ đang hoạt động.";
      }
    }

    await saveFlow(pool, conversation.id, flowState, draft);

    const confidence = Math.min(classification.score, 0.9999);
    const entitiesForLog = { service: entities.serviceEntity, date: entities.date, time: entities.time, period: entities.period, flow_state: flowState };

    await pool.request().input("conversationId", sql.Int, conversation.id).input("role", sql.VarChar, "user").input("message", sql.NVarChar, String(last.text).slice(0, 4000)).input("intent", sql.VarChar, classification.intent).input("confidence", sql.Decimal(5, 4), confidence).input("entities", sql.NVarChar, JSON.stringify(entitiesForLog)).query("INSERT INTO dbo.chat_messages(conversation_id,role,message,intent,confidence,entities_json) VALUES(@conversationId,@role,@message,@intent,@confidence,@entities)");
    await pool.request().input("conversationId", sql.Int, conversation.id).input("role", sql.VarChar, "assistant").input("message", sql.NVarChar, reply).input("intent", sql.VarChar, classification.intent).input("confidence", sql.Decimal(5, 4), confidence).input("entities", sql.NVarChar, JSON.stringify({ action: action?.type || null })).query("INSERT INTO dbo.chat_messages(conversation_id,role,message,intent,confidence,entities_json) VALUES(@conversationId,@role,@message,@intent,@confidence,@entities)");
    await pool.request().input("conversationId", sql.Int, conversation.id).query("UPDATE dbo.chat_conversations SET updated_at=SYSDATETIME() WHERE id=@conversationId");

    if (user?.id) await writeAudit(pool, { userId: user.id, action: "CHAT_MESSAGE", entityType: "CHAT_CONVERSATION", entityId: conversation.id, description: `${classification.intent}, confidence=${confidence.toFixed(3)}, flow=${flowState || "-"}`, req });

    res.json({
      reply,
      conversationId: conversation.id,
      conversationToken: conversationToken(conversation.id),
      intent: classification.intent,
      confidence: Number(confidence.toFixed(4)),
      entities: entitiesForLog,
      flowState,
      action: action || (classification.intent === "BOOKING" && !inFlow ? { type: "OPEN_BOOKING", serviceId: entities.serviceEntity?.service_id || null, date: entities.date || null, time: entities.time || null } : null),
    });
  } catch (error) {
    console.error("POST chat:", error);
    res.status(500).json({ message: "Chatbot đang gặp lỗi khi xử lý hội thoại." });
  }
});

router.get("/history/:conversationId", authenticateToken, async (req, res) => {
  try {
    const id = Number(req.params.conversationId);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "conversationId không hợp lệ." });
    const pool = await poolPromise;
    const owner = await pool.request().input("id", sql.Int, id).query("SELECT TOP 1 user_id FROM dbo.chat_conversations WHERE id=@id");
    if (!owner.recordset.length) return res.status(404).json({ message: "Không tìm thấy cuộc trò chuyện." });
    if (req.user.role !== "ADMIN" && Number(owner.recordset[0].user_id) !== Number(req.user.id)) return res.status(403).json({ message: "Bạn không có quyền xem cuộc trò chuyện này." });
    const r = await pool.request().input("conversationId", sql.Int, id).query("SELECT id,role,message,intent,confidence,entities_json,created_at FROM dbo.chat_messages WHERE conversation_id=@conversationId ORDER BY created_at,id");
    res.json(r.recordset);
  } catch (error) {
    console.error("GET chat history:", error);
    res.status(500).json({ message: "Không tải được lịch sử hội thoại." });
  }
});

router.get("/admin/analytics", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pool = await poolPromise;
    const intents = await pool.request().query(`SELECT COALESCE(intent,'UNKNOWN') intent,COUNT(*) message_count,AVG(COALESCE(confidence,0)) avg_confidence FROM dbo.chat_messages WHERE role='user' GROUP BY intent ORDER BY message_count DESC`);
    const unresolved = await pool.request().query(`SELECT TOP 50 message,intent,confidence,created_at FROM dbo.chat_messages WHERE role='user' AND (intent='UNKNOWN' OR confidence < 0.18) ORDER BY created_at DESC`);
    const totals = await pool.request().query(`SELECT COUNT(*) total_messages,COUNT(DISTINCT conversation_id) total_conversations,AVG(COALESCE(confidence,0)) avg_confidence FROM dbo.chat_messages WHERE role='user'`);
    const bookingsViaChat = await pool.request().query(`SELECT COUNT(*) total FROM dbo.appointments WHERE note=N'Đặt qua chatbot NLP'`);
    res.json({
      summary: {
        total_messages: Number(totals.recordset[0]?.total_messages || 0),
        total_conversations: Number(totals.recordset[0]?.total_conversations || 0),
        avg_confidence: Number(totals.recordset[0]?.avg_confidence || 0),
        bookings_via_chat: Number(bookingsViaChat.recordset[0]?.total || 0),
      },
      intents: intents.recordset.map((x) => ({ intent: x.intent, message_count: Number(x.message_count), avg_confidence: Number(x.avg_confidence || 0) })),
      unresolved: unresolved.recordset,
    });
  } catch (error) {
    console.error("GET chat analytics:", error);
    res.status(500).json({ message: "Không tải được phân tích chatbot." });
  }
});

export default router;
