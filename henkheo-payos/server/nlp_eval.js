/*
 * Hẹn Khéo — Đánh giá độc lập module NLP (server/nlp.js), KHÔNG cần SQL Server.
 * Chạy: node nlp_eval.js
 *
 * Tập kiểm thử (test set) bên dưới KHÔNG trùng với tập huấn luyện (training set)
 * trong nlp.js — đây là các câu hỏi tự nhiên, có dấu, viết theo nhiều cách khác
 * nhau (kể cả có lỗi chính tả nhẹ) để đánh giá khả năng khái quát hoá thực sự,
 * không phải học thuộc lòng câu mẫu.
 *
 * Dùng cho chương "Kiểm thử hệ thống" / "Đánh giá chatbot NLP" của báo cáo đồ án.
 */
import {
  classifyIntent,
  extractDate,
  extractClockTime,
  extractWeekday,
  extractRelativeDate,
  resolveDate,
  levenshtein,
  similarity,
} from "./nlp.js";

const INTENT_TEST_SET = [
  ["Xin chào Hẹn Khéo", "GREETING"],
  ["chào shop nha", "GREETING"],
  ["alo có ai không", "GREETING"],
  ["Shop có những dịch vụ nào vậy ạ?", "SERVICE_LIST"],
  ["cho mình xem danh sách dịch vụ", "SERVICE_LIST"],
  ["menu bên mình gồm những gì", "SERVICE_LIST"],
  ["Cắt tóc nam giá bao nhiêu?", "PRICE"],
  ["gói massage chi phí sao ạ", "PRICE"],
  ["giá dịch vụ gội đầu dưỡng sinh", "PRICE"],
  ["Gội đầu mất bao lâu?", "DURATION"],
  ["dịch vụ này làm trong bao nhiêu phút", "DURATION"],
  ["Mấy giờ mở cửa?", "WORKING_HOURS"],
  ["shop đóng cửa lúc mấy giờ", "WORKING_HOURS"],
  ["Tôi muốn đặt lịch cắt tóc ngày mai 14h", "BOOKING"],
  ["cho mình đặt hẹn với", "BOOKING"],
  ["đặt lịch giúp mình", "BOOKING"],
  ["Mình muốn huỷ lịch đã đặt", "CANCEL"],
  ["huỷ hẹn giúp em", "CANCEL"],
  ["Đổi lịch sang giờ khác được không?", "RESCHEDULE"],
  ["mình muốn dời lịch", "RESCHEDULE"],
  ["Xem lịch của tôi", "MY_APPOINTMENTS"],
  ["tôi có lịch nào sắp tới không", "MY_APPOINTMENTS"],
  ["thời tiết hôm nay thế nào", "UNKNOWN"],
  ["1 cộng 1 bằng mấy", "UNKNOWN"],
  // Có lỗi chính tả nhẹ — kiểm tra khả năng chịu lỗi (fuzzy correction).
  ["dat lch cho minh", "BOOKING"],
  ["hui lich giup em", "CANCEL"],
];

const ENTITY_TEST_SET = [
  { text: "20/10", expect: { date: "match:\\d{4}-10-20" } },
  { text: "9h30", expect: { time: "09:30" } },
  { text: "14:00", expect: { time: "14:00" } },
  { text: "3 giờ chiều", expect: { time: "15:00" } },
  { text: "9 giờ sáng", expect: { time: "09:00" } },
  { text: "8 giờ tối", expect: { time: "20:00" } },
];

function runIntentEval() {
  let correct = 0;
  const confusion = new Map(); // "EXPECTED->PREDICTED" -> count
  const failures = [];
  for (const [text, expected] of INTENT_TEST_SET) {
    const result = classifyIntent(text);
    const predicted = result.intent;
    const key = `${expected}->${predicted}`;
    confusion.set(key, (confusion.get(key) || 0) + 1);
    if (predicted === expected) correct += 1;
    else failures.push({ text, expected, predicted, score: result.score.toFixed(3) });
  }
  const accuracy = (correct / INTENT_TEST_SET.length) * 100;

  console.log("=== KIỂM THỬ PHÂN LOẠI INTENT (tập test độc lập với tập huấn luyện) ===");
  console.log(`Tổng số câu test: ${INTENT_TEST_SET.length}`);
  console.log(`Số câu đúng: ${correct}`);
  console.log(`Độ chính xác (accuracy): ${accuracy.toFixed(1)}%`);
  console.log();
  if (failures.length) {
    console.log("Các câu phân loại sai:");
    for (const f of failures) {
      console.log(`  - "${f.text}" | mong đợi=${f.expected} | dự đoán=${f.predicted} (score=${f.score})`);
    }
  } else {
    console.log("Không có câu nào bị phân loại sai trên tập test này.");
  }
  console.log();
  return { accuracy, correct, total: INTENT_TEST_SET.length, failures };
}

function runEntityEval() {
  console.log("=== KIỂM THỬ TRÍCH XUẤT THỰC THỂ NGÀY / GIỜ ===");
  let pass = 0;
  for (const { text, expect } of ENTITY_TEST_SET) {
    const period = /chieu|chiều/.test(text.toLowerCase()) ? "afternoon" : /sang|sáng/.test(text.toLowerCase()) ? "morning" : /toi|tối/.test(text.toLowerCase()) ? "evening" : null;
    let actual;
    let ok;
    if (expect.time) {
      actual = extractClockTime(text, period);
      ok = actual === expect.time;
    } else if (expect.date) {
      actual = extractDate(text);
      const re = new RegExp(expect.date.replace("match:", ""));
      ok = actual && re.test(actual);
    }
    if (ok) pass += 1;
    console.log(`  ${ok ? "OK  " : "FAIL"} "${text}" -> ${actual}`);
  }
  console.log(`Đạt: ${pass}/${ENTITY_TEST_SET.length}`);
  console.log();
  return { pass, total: ENTITY_TEST_SET.length };
}

function runWeekdayEval() {
  console.log("=== KIỂM THỬ SUY RA NGÀY TỪ 'THỨ' TRONG TUẦN ===");
  // Cố định "hôm nay" để kết quả tái lập được: 2026-09-23 là Thứ 4.
  const fixedNow = new Date("2026-09-23T00:00:00");
  const cases = [
    ["thứ 2", "2026-09-28"],        // Thứ 4 -> Thứ 2 gần nhất đã qua trong tuần này -> tuần sau
    ["thứ 6", "2026-09-25"],        // Thứ 4 -> Thứ 6 cùng tuần
    ["chủ nhật", "2026-09-27"],
    ["thứ 4 tuần sau", "2026-09-30"], // Hôm nay là Thứ 4 (diff=0) nhưng có "tuần sau" -> đẩy +7 ngày
  ];
  let pass = 0;
  for (const [text, expected] of cases) {
    const weekday = extractWeekday(text);
    const date = resolveDate({ weekday }, fixedNow);
    const ok = date === expected;
    if (ok) pass += 1;
    console.log(`  ${ok ? "OK  " : "FAIL"} "${text}" -> ${date} (mong đợi ${expected})`);
  }
  console.log(`Đạt: ${pass}/${cases.length}`);
  console.log();
}

function runFuzzyDemo() {
  console.log("=== DEMO KHỚP MỜ LEVENSHTEIN (chịu lỗi chính tả) ===");
  const pairs = [["dat lich", "dat lch"], ["huy hen", "hui hen"], ["cat toc nam", "cat toc nma"]];
  for (const [a, b] of pairs) {
    console.log(`  distance("${a}", "${b}") = ${levenshtein(a, b)}, similarity = ${similarity(a, b).toFixed(2)}`);
  }
  console.log();
}

const intentResult = runIntentEval();
runEntityEval();
runWeekdayEval();
runFuzzyDemo();

if (intentResult.accuracy < 70) {
  console.error("CẢNH BÁO: độ chính xác intent dưới 70%, cần bổ sung thêm câu mẫu huấn luyện.");
  process.exitCode = 1;
}
