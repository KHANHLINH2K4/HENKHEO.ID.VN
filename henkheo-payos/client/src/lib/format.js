
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

export const formatVND = (n) => `${Number(n || 0).toLocaleString("vi-VN")}đ`;

export const timeToMin = (t) => { const [h, m] = String(t || "00:00").slice(0, 5).split(":").map(Number); return h * 60 + m; };

export const toHHMM = (t) => String(t || "").slice(0, 5);

export const dmLabel = (iso) => { if (!iso) return "—"; const d = new Date(String(iso).slice(0, 10) + "T00:00:00"); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; };

export const addDays = (n, baseISO = null) => { const d = baseISO ? new Date(`${String(baseISO).slice(0, 10)}T00:00:00`) : new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

export const dowLabel = (iso) => ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][new Date(`${iso}T00:00:00`).getDay()];

export const SLOTS = Array.from({ length: 20 }, (_, i) => { const total = 8 * 60 + i * 30; return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; });
