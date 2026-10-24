/*
 * Log có cấu trúc: production in mỗi dòng một JSON (dễ đẩy vào Loki/ELK/CloudWatch),
 * development in dạng đọc được. Không phụ thuộc thư viện ngoài.
 */
const isProd = () => process.env.NODE_ENV === "production";

function serializeError(err) {
  if (!err) return undefined;
  if (!(err instanceof Error)) return { message: String(err) };
  return { name: err.name, message: err.message, code: err.code, number: err.number, stack: isProd() ? undefined : err.stack };
}

function write(level, message, meta = {}) {
  const { err, ...rest } = meta;
  const entry = { time: new Date().toISOString(), level, message, ...rest, ...(err ? { error: serializeError(err) } : {}) };
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (isProd()) out(JSON.stringify(entry));
  else out(`[${level}] ${message}${Object.keys(rest).length ? " " + JSON.stringify(rest) : ""}`, ...(err ? [err] : []));
}

export const logger = {
  info: (m, meta) => write("info", m, meta),
  warn: (m, meta) => write("warn", m, meta),
  error: (m, meta) => write("error", m, meta),
};
