/*
 * Chặn dò mật khẩu theo TÀI KHOẢN (bổ sung cho rate limit theo IP):
 *  - cùng (IP + tên đăng nhập) sai quá `perIpLimit` lần  -> khóa tạm cặp đó
 *  - cùng tên đăng nhập sai quá `perUserLimit` lần (nhiều IP, botnet) -> khóa tạm tên đó
 * Ngưỡng cặp IP+tên thấp hơn ngưỡng theo tên để kẻ xấu khó "khóa hộ" tài khoản người khác chỉ với một IP.
 * Lưu trong bộ nhớ (đủ cho 1 instance); nhiều instance nên dùng Redis.
 */
export function createLoginGuard({ windowMs = 15 * 60_000, perIpLimit = 6, perUserLimit = 25, now = () => Date.now() } = {}) {
  const fails = new Map(); // key -> number[] (thời điểm sai)

  const recent = (key) => {
    const t = now();
    const arr = (fails.get(key) || []).filter((x) => t - x < windowMs);
    if (arr.length) fails.set(key, arr); else fails.delete(key);
    return arr;
  };
  const keys = (ip, username) => [`ip:${ip}|${String(username).toLowerCase()}`, `user:${String(username).toLowerCase()}`];

  return {
    /** Trả về số giây phải chờ nếu đang bị khóa, ngược lại 0. */
    retryAfterSeconds(ip, username) {
      const [kIp, kUser] = keys(ip, username);
      let wait = 0;
      for (const [k, limit] of [[kIp, perIpLimit], [kUser, perUserLimit]]) {
        const arr = recent(k);
        if (arr.length >= limit) wait = Math.max(wait, Math.ceil((arr[0] + windowMs - now()) / 1000));
      }
      return Math.max(0, wait);
    },
    recordFailure(ip, username) {
      for (const k of keys(ip, username)) { const arr = recent(k); arr.push(now()); fails.set(k, arr); }
    },
    recordSuccess(ip, username) {
      fails.delete(keys(ip, username)[0]); // đăng nhập đúng chỉ xóa bộ đếm của cặp IP+tên
    },
    _size: () => fails.size,
  };
}

export const loginGuard = createLoginGuard();
