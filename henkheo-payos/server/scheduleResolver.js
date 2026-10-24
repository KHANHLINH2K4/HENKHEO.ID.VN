import { sql } from "./db.js";

/* ------------------------------------------------------------------
 * Tiện ích thời gian
 * ------------------------------------------------------------------ */
export function parseSqlTime(value) {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // mssql trả cột TIME dưới dạng Date (1970-01-01, giờ UTC)
    const h = value.getUTCHours();
    const m = value.getUTCMinutes();
    return { hours: h, minutes: m, text: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
  }
  const text = String(value).slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(text)) return null;
  const [hours, minutes] = text.split(":").map(Number);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes, text };
}

export function timeToMinutes(value) {
  const t = parseSqlTime(value);
  return t ? t.hours * 60 + t.minutes : 0;
}

export function timeText(value) {
  return parseSqlTime(value)?.text || "";
}

export function isValidISODate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date || ""));
}

/** Cộng/trừ ngày trên chuỗi YYYY-MM-DD, không phụ thuộc múi giờ máy chủ. */
export function addDaysISO(date, n) {
  const [y, m, d] = String(date).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** ISO weekday: Thứ Hai = 1 ... Chủ Nhật = 7 (tính theo UTC nên không lệch múi giờ). */
export function isoWeekday(date) {
  if (!isValidISODate(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

const dateKey = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));

/* ------------------------------------------------------------------
 * Quy tắc ưu tiên lịch làm việc (một nguồn sự thật duy nhất)
 *
 *   1) Ngoại lệ theo ngày (staff_schedule_exceptions)   – cao nhất
 *   2) Lịch tuần mặc định (staff_schedule_templates)
 *   3) Lịch cứng cũ (staff_schedules) – CHỈ dùng khi nhân viên chưa
 *      có bất kỳ dòng lịch tuần nào (dữ liệu legacy).
 *
 * Trước đây lịch cứng được ưu tiên hơn lịch tuần nên khi Admin chỉnh lịch
 * tuần thì không có tác dụng với những ngày đã có lịch cứng, và nhân viên
 * mới hết 14 ngày lịch cứng là không thể đặt lịch.
 * ------------------------------------------------------------------ */
function makeRequest(pool, tx) {
  return tx ? new sql.Request(tx) : pool.request();
}

/**
 * Quy tắc ưu tiên cho MỘT ngày (hàm thuần, dùng chung cho 1 nhân viên và cho nhiều nhân viên).
 *   ex: dòng ngoại lệ của ngày (hoặc undefined) · weekdayRows: dòng lịch tuần đúng thứ
 *   hasTemplates: nhân viên có bất kỳ dòng lịch tuần nào · legacy: các dòng lịch cứng cũ của ngày
 */
export function resolveDay(date, { ex, weekdayRows = [], hasTemplates = false, legacy = [] }) {
  const weekday = isoWeekday(date);
  const base = { date, weekday, is_working: false, shifts: [], source: "NONE", note: "" };

  // 1. Ngoại lệ
  if (ex) {
    if (ex.is_day_off) return { ...base, source: "EXCEPTION", note: ex.reason || "Nghỉ cả ngày" };
    return {
      ...base,
      is_working: true,
      source: "EXCEPTION",
      note: ex.reason || "Ca làm ngoại lệ",
      shifts: [{ start_time: timeText(ex.start_time), end_time: timeText(ex.end_time) }],
    };
  }

  // 2. Lịch tuần
  if (hasTemplates) {
    const working = weekdayRows.filter((r) => r.is_working);
    if (working.length) {
      return {
        ...base,
        is_working: true,
        source: "TEMPLATE",
        note: working[0].note || "Lịch làm định kỳ",
        shifts: working.map((r) => ({ start_time: timeText(r.start_time), end_time: timeText(r.end_time) })),
      };
    }
    return { ...base, source: "TEMPLATE", note: weekdayRows[0]?.note || "Nghỉ theo lịch tuần" };
  }

  // 3. Legacy
  const workingLegacy = legacy.filter((r) => !!r.is_available);
  if (workingLegacy.length) {
    return {
      ...base,
      is_working: true,
      source: "CONCRETE",
      note: workingLegacy[0].note || "Ca làm việc",
      shifts: workingLegacy.map((r) => ({ start_time: timeText(r.start_time), end_time: timeText(r.end_time) })),
    };
  }
  if (legacy.length) return { ...base, source: "CONCRETE", note: legacy[0].note || "Nghỉ" };
  return base;
}

/**
 * Lịch làm hiệu lực của nhiều ngày liên tiếp cho 1 nhân viên.
 * Trả về mảng, mỗi phần tử là một ngày:
 *   { date, weekday, is_working, shifts:[{start_time,end_time}], source, note }
 */
export async function getEffectiveScheduleRange(pool, staffId, from, to, tx = null) {
  if (!isValidISODate(from) || !isValidISODate(to) || from > to) return [];

  const q = (query, extra = (r) => r) =>
    extra(makeRequest(pool, tx)
      .input("staffId", sql.Int, Number(staffId))
      .input("fromDate", sql.Date, from)
      .input("toDate", sql.Date, to)).query(query);

  const queries = [
    () => q(`SELECT id, work_date, is_day_off, start_time, end_time, reason
       FROM dbo.staff_schedule_exceptions
       WHERE staff_id=@staffId AND work_date BETWEEN @fromDate AND @toDate`),
    () => q(`SELECT id, day_of_week, start_time, end_time, is_working, note
       FROM dbo.staff_schedule_templates
       WHERE staff_id=@staffId
       ORDER BY day_of_week, start_time`),
    () => q(`SELECT id, work_date, start_time, end_time, is_available, note
       FROM dbo.staff_schedules
       WHERE staff_id=@staffId AND work_date BETWEEN @fromDate AND @toDate
       ORDER BY work_date, start_time`),
  ];
  // Trong transaction chỉ được chạy tuần tự (1 kết nối = 1 request tại một thời điểm).
  let exceptions, templates, concrete;
  if (tx) {
    exceptions = await queries[0]();
    templates = await queries[1]();
    concrete = await queries[2]();
  } else {
    [exceptions, templates, concrete] = await Promise.all(queries.map((f) => f()));
  }

  const exMap = new Map();
  for (const r of exceptions.recordset) exMap.set(dateKey(r.work_date), r);

  const tplByDay = new Map();
  for (const r of templates.recordset) {
    if (!tplByDay.has(r.day_of_week)) tplByDay.set(r.day_of_week, []);
    tplByDay.get(r.day_of_week).push(r);
  }
  const hasTemplates = templates.recordset.length > 0;

  const concreteByDate = new Map();
  for (const r of concrete.recordset) {
    const k = dateKey(r.work_date);
    if (!concreteByDate.has(k)) concreteByDate.set(k, []);
    concreteByDate.get(k).push(r);
  }

  const days = [];
  for (let date = from; date <= to; date = addDaysISO(date, 1)) {
    days.push(resolveDay(date, {
      ex: exMap.get(date),
      weekdayRows: tplByDay.get(isoWeekday(date)) || [],
      hasTemplates,
      legacy: concreteByDate.get(date) || [],
    }));
  }
  return days;
}

/**
 * Giữ nguyên chữ ký cũ để các route đặt lịch/đổi lịch/chatbot dùng tiếp.
 * Trả về danh sách ca làm của đúng 1 ngày ([] nếu nghỉ).
 */
export async function getEffectiveSchedules(pool, staffId, date, tx = null) {
  if (!isValidISODate(date)) return [];
  const [day] = await getEffectiveScheduleRange(pool, staffId, date, date, tx);
  if (!day || !day.is_working) return [];
  return day.shifts.map((s, i) => ({
    id: `${day.source.toLowerCase()}-${date}-${i}`,
    staff_id: Number(staffId),
    work_date: date,
    start_time: s.start_time,
    end_time: s.end_time,
    is_available: true,
    note: day.note,
    source: day.source,
  }));
}

export function scheduleContains(scheduleRows, startMinutes, endMinutes) {
  return scheduleRows.some((row) => {
    const s = timeToMinutes(row.start_time);
    const e = timeToMinutes(row.end_time);
    return startMinutes >= s && endMinutes <= e;
  });
}

const toSchedules = (day, staffId, date) => (!day || !day.is_working ? [] : day.shifts.map((sh, i) => ({
  id: `${day.source.toLowerCase()}-${date}-${i}`,
  staff_id: Number(staffId),
  work_date: date,
  start_time: sh.start_time,
  end_time: sh.end_time,
  is_available: true,
  note: day.note,
  source: day.source,
})));

/**
 * Ca làm hiệu lực của NHIỀU nhân viên trong một ngày, chỉ 3 truy vấn (thay vì 3 truy vấn cho mỗi nhân viên).
 * Trả về Map<staffId, schedules[]> cùng định dạng với getEffectiveSchedules.
 */
export async function getEffectiveSchedulesForStaff(pool, staffIds, date) {
  const ids = [...new Set((staffIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const out = new Map(ids.map((id) => [id, []]));
  if (!ids.length || !isValidISODate(date)) return out;
  const list = ids.join(","); // chỉ gồm số nguyên đã kiểm tra ở trên
  const rq = () => pool.request().input("d", sql.Date, date);
  const [exs, tpls, cons] = await Promise.all([
    rq().query(`SELECT staff_id, is_day_off, start_time, end_time, reason FROM dbo.staff_schedule_exceptions WHERE staff_id IN (${list}) AND work_date=@d`),
    rq().query(`SELECT staff_id, day_of_week, start_time, end_time, is_working, note FROM dbo.staff_schedule_templates WHERE staff_id IN (${list}) ORDER BY day_of_week, start_time`),
    rq().query(`SELECT staff_id, start_time, end_time, is_available, note FROM dbo.staff_schedules WHERE staff_id IN (${list}) AND work_date=@d ORDER BY start_time`),
  ]);
  const group = (rows) => { const m = new Map(); for (const r of rows) { if (!m.has(r.staff_id)) m.set(r.staff_id, []); m.get(r.staff_id).push(r); } return m; };
  const exBy = new Map(exs.recordset.map((r) => [r.staff_id, r]));
  const tplBy = group(tpls.recordset);
  const conBy = group(cons.recordset);
  const weekday = isoWeekday(date);
  for (const id of ids) {
    const tplRows = tplBy.get(id) || [];
    const day = resolveDay(date, {
      ex: exBy.get(id),
      weekdayRows: tplRows.filter((r) => r.day_of_week === weekday),
      hasTemplates: tplRows.length > 0,
      legacy: conBy.get(id) || [],
    });
    out.set(id, toSchedules(day, id, date));
  }
  return out;
}
