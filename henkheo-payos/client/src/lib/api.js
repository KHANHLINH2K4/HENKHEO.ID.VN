export const API = "/api";
export const TOKEN_KEY = "henkheo_token";
export const USER_KEY = "henkheo_user";

export function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
export function clearAuth() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }

/* Server trả code=AUTH_INVALID khi token hết hạn / tài khoản bị khóa / đã đổi mật khẩu:
   xóa phiên và quay về trang đăng nhập (chỉ khi thực sự đang có token, tránh vòng lặp tải lại). */
function failIfSessionInvalid(data, hadToken) {
  if (hadToken && data?.code === "AUTH_INVALID") {
    clearAuth();
    window.location.reload();
  }
}

async function request(path, init, hadToken, fallbackMessage) {
  let res;
  try {
    res = await fetch(`${API}${path}`, init);
  } catch {
    throw new Error("Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    failIfSessionInvalid(data, hadToken);
    throw new Error(data.message || data.error || fallbackMessage);
  }
  return data;
}

export async function apiGet(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return request(path, { ...options, headers, cache: options.cache || "no-store" }, !!token, "Không thể tải dữ liệu.");
}

export async function apiSend(path, method, body, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return request(path, { method, headers, body: JSON.stringify(body) }, !!token, "Có lỗi xảy ra.");
}

/* Tải một file có xác thực (CSV, .ics...) rồi cho trình duyệt lưu xuống. */
export async function apiDownload(path, fallbackName = "download") {
  const token = getToken();
  let res;
  try {
    res = await fetch(`${API}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" });
  } catch {
    throw new Error("Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    failIfSessionInvalid(data, !!token);
    throw new Error(data.message || "Không thể tải file.");
  }
  const match = /filename="?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") || "");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = match?.[1] || fallbackName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
