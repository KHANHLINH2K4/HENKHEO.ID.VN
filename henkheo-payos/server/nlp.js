/*
 * Hẹn Khéo — Module lõi Xử lý ngôn ngữ tự nhiên (NLP core).
 *
 * Được tách khỏi routes/chat.js thành module thuần (không phụ thuộc DB/HTTP)
 * để:
 *   (1) thể hiện kiến trúc phân tầng rõ ràng (NLP core / business logic / HTTP layer)
 *   (2) có thể viết unit test + đánh giá độ chính xác độc lập, không cần SQL Server
 *       (xem server/nlp_eval.js — dùng cho chương "Kiểm thử" của báo cáo đồ án).
 *
 * Kỹ thuật sử dụng:
 *   - Text normalization: hạ chữ thường, bỏ dấu tiếng Việt (Unicode NFD), loại ký tự đặc biệt.
 *   - Tokenization theo khoảng trắng.
 *   - Biểu diễn văn bản: TF-IDF (Term Frequency – Inverse Document Frequency).
 *   - Phân loại intent: Vector Space Model + Cosine Similarity (k-NN 1 láng giềng gần nhất
 *     trên tập câu mẫu gán nhãn intent).
 *   - Khớp mờ (fuzzy matching): khoảng cách Levenshtein, dùng để (a) sửa lỗi chính tả nhẹ
 *     trước khi phân loại, (b) nhận diện tên dịch vụ khi người dùng gõ sai/viết tắt.
 *   - Trích xuất thực thể (entity extraction) theo luật (rule-based) + từ điển miền
 *     (domain lexicon): dịch vụ, ngày (tuyệt đối/tương đối/thứ trong tuần), buổi, giờ.
 */

/* ------------------------------------------------------------------ */
/* 1) Chuẩn hoá & tokenize tiếng Việt                                   */
/* ------------------------------------------------------------------ */
export const normalize = (text = "") => String(text)
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9\s]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export const tokenize = (text) => normalize(text).split(" ").filter(Boolean);

/* Khoảng cách Levenshtein — độ phức tạp O(n*m), dùng quy hoạch động 1 chiều. */
export function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (!al) return bl;
  if (!bl) return al;
  let prev = Array.from({ length: bl + 1 }, (_, i) => i);
  for (let i = 1; i <= al; i += 1) {
    const cur = [i];
    for (let j = 1; j <= bl; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[bl];
}

export const similarity = (a, b) => {
  const maxLen = Math.max(a.length, b.length) || 1;
  return 1 - levenshtein(a, b) / maxLen;
};

/* ------------------------------------------------------------------ */
/* 2) Tập câu mẫu huấn luyện cho từng intent (dữ liệu gán nhãn thủ công) */
/* ------------------------------------------------------------------ */
export const training = {
  GREETING: ["xin chao", "chao ban", "hello", "hi hen kheo", "alo", "chao shop", "hey"],
  SERVICE_LIST: ["co nhung dich vu nao", "danh sach dich vu", "cac dich vu", "dịch vụ gì", "co dich vu gi", "shop co gi", "menu dich vu"],
  SERVICE_INFO: ["thong tin dich vu", "tu van dich vu", "mo ta dich vu", "dịch vụ này gồm gì", "dich vu nay lam gi"],
  PRICE: ["gia bao nhieu", "bao nhieu tien", "gia dich vu", "chi phi", "gia cat toc", "gia massage", "bao nhieu tien 1 lan"],
  DURATION: ["mat bao lau", "thoi luong", "bao nhieu phut", "lam trong bao lau", "lau khong"],
  WORKING_HOURS: ["gio lam viec", "mo cua may gio", "dong cua may gio", "lam den may gio", "may gio mo cua"],
  BOOKING: ["toi muon dat lich", "dat lich", "dat hen", "book lich", "chon gio", "muon dat", "cho toi dat lich", "dat mot lich"],
  CANCEL: ["huy lich", "huy hen", "bo lich", "khong dat nua", "thoi khong dat nua"],
  RESCHEDULE: ["doi lich", "doi hen", "chuyen lich", "doi sang gio khac"],
  MY_APPOINTMENTS: ["lich cua toi", "toi co lich nao", "xem lich hen", "lich da dat"],
  AFFIRM: ["co", "dong y", "ok", "chuan", "xac nhan", "chot", "dung roi", "yes", "duoc"],
  DENY: ["khong", "thoi", "huy di", "khong phai", "sai roi", "no"],
};

const makeIdf = () => {
  const docs = [];
  for (const phrases of Object.values(training)) for (const phrase of phrases) docs.push(new Set(tokenize(phrase)));
  const df = new Map();
  for (const doc of docs) for (const term of doc) df.set(term, (df.get(term) || 0) + 1);
  const N = docs.length;
  return (term) => Math.log((N + 1) / ((df.get(term) || 0) + 1)) + 1;
};
const idf = makeIdf();
const vocabulary = [...new Set(Object.values(training).flat().flatMap(tokenize))];

export function vector(text) {
  const terms = tokenize(text);
  const counts = new Map();
  for (const t of terms) counts.set(t, (counts.get(t) || 0) + 1);
  const v = new Map();
  for (const [term, count] of counts) v.set(term, (count / Math.max(terms.length, 1)) * idf(term));
  return v;
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const v of a.values()) na += v * v;
  for (const v of b.values()) nb += v * v;
  for (const [k, v] of a) dot += v * (b.get(k) || 0);
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

const examples = Object.entries(training).flatMap(([intent, phrases]) =>
  phrases.map((phrase) => ({ intent, phrase, vector: vector(phrase) }))
);

/* Sửa lỗi gõ nhẹ trước khi vector hoá: mỗi token lạ (không có trong từ điển)
   được thay bằng từ trong từ điển gần nhất nếu đủ giống (similarity >= 0.8). */
function fuzzyCorrect(tokens) {
  return tokens.map((t) => {
    if (vocabulary.includes(t) || t.length <= 2) return t;
    let best = null, bestScore = 0;
    for (const v of vocabulary) {
      const s = similarity(t, v);
      if (s > bestScore) { bestScore = s; best = v; }
    }
    return bestScore >= 0.8 ? best : t;
  });
}

const INTENT_CONFIDENCE_THRESHOLD = 0.16;

export function classifyIntent(text) {
  const rawTokens = tokenize(text);
  const corrected = fuzzyCorrect(rawTokens).join(" ");
  const input = vector(corrected);
  let best = { intent: "UNKNOWN", score: 0, phrase: "" };
  for (const example of examples) {
    const score = cosine(input, example.vector);
    if (score > best.score) best = { intent: example.intent, score, phrase: example.phrase };
  }
  // Độ tương đồng quá thấp thì coi là UNKNOWN thay vì ép về intent gần nhất.
  if (best.score < INTENT_CONFIDENCE_THRESHOLD) return { intent: "UNKNOWN", score: best.score, phrase: best.phrase };
  return best;
}

/* ------------------------------------------------------------------ */
/* 3) Trích xuất thực thể: dịch vụ / ngày / thứ / buổi / giờ            */
/* ------------------------------------------------------------------ */
export function extractService(text, services) {
  const t = normalize(text);
  const tTokens = tokenize(text);
  let best = null; let bestScore = 0;
  for (const service of services) {
    const n = normalize(service.name);
    if (n && t.includes(n)) return { service_id: service.id, service_name: service.name };
    const words = new Set(tokenize(n));
    const overlap = tTokens.filter((w) => w.length >= 3 && words.has(w)).length / Math.max(words.size, 1);
    if (overlap > bestScore) { bestScore = overlap; best = service; }
  }
  if (bestScore >= 0.34 && best) return { service_id: best.id, service_name: best.name };

  // Khớp mờ theo Levenshtein cho câu ngắn kiểu "cắt tót nam" (lỗi chính tả) hoặc tên viết tắt.
  let fuzzyBest = null; let fuzzyScore = 0;
  for (const service of services) {
    const n = normalize(service.name);
    const s = similarity(t, n);
    if (s > fuzzyScore) { fuzzyScore = s; fuzzyBest = service; }
  }
  if (fuzzyScore >= 0.55 && fuzzyBest) return { service_id: fuzzyBest.id, service_name: fuzzyBest.name, fuzzy: true };
  return null;
}

export function extractRelativeDate(text) {
  const t = normalize(text);
  if (/\bhom nay\b/.test(t)) return "today";
  if (/\bngay mai\b/.test(t)) return "tomorrow";
  if (/\bngay kia\b/.test(t)) return "day_after_tomorrow";
  return null;
}

const WEEKDAY_PATTERNS = [
  { re: /\bchu nhat\b|\bcn\b/, iso: 7 },
  { re: /\bthu\s*2\b|\bthu hai\b/, iso: 1 },
  { re: /\bthu\s*3\b|\bthu ba\b/, iso: 2 },
  { re: /\bthu\s*4\b|\bthu tu\b/, iso: 3 },
  { re: /\bthu\s*5\b|\bthu nam\b/, iso: 4 },
  { re: /\bthu\s*6\b|\bthu sau\b/, iso: 5 },
  { re: /\bthu\s*7\b|\bthu bay\b/, iso: 6 },
];

export function extractWeekday(text) {
  const t = normalize(text);
  for (const { re, iso } of WEEKDAY_PATTERNS) {
    if (re.test(t)) {
      const nextWeek = /\btuan sau\b|\btuan toi\b/.test(t);
      return { iso, nextWeek };
    }
  }
  return null;
}

export function extractPeriod(text) {
  const t = normalize(text);
  if (/\b(sang|buoi sang)\b/.test(t)) return "morning";
  if (/\b(trua|buoi trua)\b/.test(t)) return "noon";
  if (/\b(chieu|buoi chieu)\b/.test(t)) return "afternoon";
  if (/\b(toi|buoi toi)\b/.test(t)) return "evening";
  return null;
}

export function extractClockTime(text, period) {
  const raw = String(text || "");
  // Dạng "14:30", "14h30", "9:00"
  let match = raw.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/i);
  if (match) return `${String(match[1]).padStart(2, "0")}:${match[2]}`;

  // Dạng chỉ có giờ: "14h", "9 gio", "3 giờ chiều" — kết hợp buổi để suy ra 24h.
  // Lưu ý: không dùng \b sau "giờ" vì "ờ" nằm ngoài phạm vi \w (ASCII) của JS regex,
  // khiến \b không nhận diện đúng biên từ có dấu tiếng Việt.
  match = raw.match(/\b([01]?\d|2[0-3])\s*(?:h|gio|giờ)(?=\s|$|[.,!?;])/i);
  if (match) {
    let hour = Number(match[1]);
    if (period === "afternoon" && hour >= 1 && hour <= 7) hour += 12;
    else if (period === "evening" && hour >= 1 && hour <= 11) hour += 12;
    else if (period === "morning" && hour === 12) hour = 0;
    if (hour > 23) return null;
    return `${String(hour).padStart(2, "0")}:00`;
  }
  return null;
}

export function extractDate(text) {
  const raw = String(text || "");
  const match = raw.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}))?\b/);
  if (!match) return null;
  const year = match[3] ? Number(match[3]) : new Date().getFullYear();
  const month = Number(match[2]); const day = Number(match[1]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const pad2 = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/* Gộp mọi tín hiệu ngày tháng (tuyệt đối, tương đối, thứ trong tuần) thành 1 ngày ISO. */
export function resolveDate({ explicitDate, relativeDate, weekday }, now = new Date()) {
  if (explicitDate) return explicitDate;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (relativeDate === "today") return toISO(today);
  if (relativeDate === "tomorrow") { const d = new Date(today); d.setDate(d.getDate() + 1); return toISO(d); }
  if (relativeDate === "day_after_tomorrow") { const d = new Date(today); d.setDate(d.getDate() + 2); return toISO(d); }
  if (weekday) {
    const curIso = today.getDay() === 0 ? 7 : today.getDay();
    let diff = weekday.iso - curIso;
    if (diff < 0 || weekday.nextWeek) diff += 7;
    const d = new Date(today);
    d.setDate(d.getDate() + diff);
    return toISO(d);
  }
  return null;
}

export function extractEntities(text, services) {
  const period = extractPeriod(text);
  const serviceEntity = extractService(text, services);
  const relativeDate = extractRelativeDate(text);
  const weekday = extractWeekday(text);
  const explicitDate = extractDate(text);
  const clockTime = extractClockTime(text, period);
  const date = resolveDate({ explicitDate, relativeDate, weekday });
  return { serviceEntity, period, date, time: clockTime };
}
