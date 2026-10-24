import React, { useState } from "react";
import { ArrowRight, CalendarCheck, Eye, EyeOff, Loader2 } from "lucide-react";

const C = {
  ink: "#181523",
  inkSoft: "#635E72",
  primary: "#6C4CF0",
  secondary: "#00C2A8",
  accent: "#FF6B6B",
  line: "rgba(24,21,35,0.08)",
  danger: "#E5484D",
};
const bodyFont = "'Inter', sans-serif";
const displayFont = "'Space Grotesk', sans-serif";
const gradient = `linear-gradient(135deg, ${C.primary}, ${C.secondary})`;

export default function Login({ onLogin, onBack }) {
  // Liên kết trong email đặt lại mật khẩu: /?reset=<token>
  const resetToken = useState(() => { try { return new URLSearchParams(window.location.search).get("reset") || ""; } catch { return ""; } })[0];
  const [mode, setMode] = useState(resetToken ? "reset" : "login"); // login | register | forgot | reset
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const postJson = async (url, body) => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || "Không thể thực hiện.");
    return data;
  };

  const submitForgot = async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!username.trim()) { setError("Vui lòng nhập tên đăng nhập hoặc email."); return; }
    setBusy(true);
    try { const data = await postJson("/api/auth/forgot-password", { identifier: username.trim() }); setSuccess(data.message); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const submitReset = async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) { setError("Mật khẩu phải có ít nhất 8 ký tự, gồm cả chữ và số."); return; }
    setBusy(true);
    try {
      const data = await postJson("/api/auth/reset-password", { token: resetToken, newPassword: password });
      window.history.replaceState({}, "", window.location.pathname);
      setPassword(""); setMode("login"); setSuccess(data.message);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const submit = async (e) => {
    if (mode === "forgot") return submitForgot(e);
    if (mode === "reset") return submitReset(e);
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!username.trim() || !password) {
      setError("Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.");
      return;
    }
    if (mode === "register" && (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password))) {
      setError("Mật khẩu phải có ít nhất 8 ký tự, gồm cả chữ và số.");
      return;
    }
    if (mode === "register" && !fullName.trim()) {
      setError("Vui lòng nhập họ và tên.");
      return;
    }
    if (mode === "register" && !/^(\+84|84|0)(3[2-9]|5[25689]|7[06-9]|8[1-9]|9\d)\d{7}$/.test(phone.replace(/[\s.-]/g, ""))) {
      setError("Số điện thoại di động không hợp lệ, ví dụ 0912345678.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "login"
          ? { username: username.trim(), password }
          : { username: username.trim(), password, fullName: fullName.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || "Không thể thực hiện.");

      localStorage.setItem("henkheo_token", data.token);
      localStorage.setItem("henkheo_user", JSON.stringify(data.user));
      setSuccess(mode === "login" ? "Đăng nhập thành công." : "Đăng ký thành công.");
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[75vh] flex items-center justify-center px-5 py-14">
      <div className="glass-strong w-full max-w-md rounded-[30px] p-7 sm:p-9 fade-up">
        <button onClick={onBack} className="flex items-center gap-2 mb-8">
          <div style={{ background: gradient }} className="w-10 h-10 rounded-xl flex items-center justify-center">
            <CalendarCheck size={19} color="#fff" />
          </div>
          <span style={{ fontFamily: displayFont, color: C.ink }} className="text-xl font-bold">Hẹn Khéo</span>
        </button>

        <div className="mb-7">
          <h1 style={{ fontFamily: displayFont, color: C.ink }} className="text-3xl font-bold mb-2">{{ login: "Đăng nhập", register: "Tạo tài khoản", forgot: "Quên mật khẩu", reset: "Đặt mật khẩu mới" }[mode]}</h1>
          <p style={{ fontFamily: bodyFont, color: C.inkSoft }} className="text-sm">{{ login: "Đăng nhập để đặt lịch và quản lý lịch hẹn.", register: "Tài khoản đăng ký sẽ được tạo với quyền CUSTOMER và hồ sơ khách hàng.", forgot: "Nhập tên đăng nhập hoặc email — chúng tôi sẽ gửi liên kết đặt lại mật khẩu (hiệu lực 30 phút).", reset: "Nhập mật khẩu mới cho tài khoản của bạn." }[mode]}</p>
        </div>

        <form onSubmit={submit} className="space-y-3.5">
          {mode === "register" && <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Họ và tên" className="w-full px-4 py-3 rounded-xl text-sm outline-none" style={{ border: `1px solid ${C.line}`, fontFamily: bodyFont }} />}
          {mode !== "reset" && <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={mode === "forgot" ? "Tên đăng nhập hoặc email" : "Tên đăng nhập"} autoComplete="username" className="w-full px-4 py-3 rounded-xl text-sm outline-none" style={{ border: `1px solid ${C.line}`, fontFamily: bodyFont }} />}
          {mode === "register" && <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (không bắt buộc)" type="email" autoComplete="email" className="w-full px-4 py-3 rounded-xl text-sm outline-none" style={{ border: `1px solid ${C.line}`, fontFamily: bodyFont }} />}
          {mode === "register" && <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Số điện thoại" required inputMode="numeric" className="w-full px-4 py-3 rounded-xl text-sm outline-none" style={{ border: `1px solid ${C.line}`, fontFamily: bodyFont }} />}
          {mode !== "forgot" && <div className="relative">
            <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "reset" ? "Mật khẩu mới" : "Mật khẩu"} type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} className="w-full px-4 py-3 pr-11 rounded-xl text-sm outline-none" style={{ border: `1px solid ${C.line}`, fontFamily: bodyFont }} />
            <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2"><span style={{ color: C.inkSoft }}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</span></button>
          </div>}

          {error && <div style={{ color: C.danger, background: "rgba(229,72,77,.08)", fontFamily: bodyFont }} className="rounded-xl px-4 py-3 text-sm">{error}</div>}
          {success && <div style={{ color: "#087E5B", background: "rgba(18,183,106,.08)", fontFamily: bodyFont }} className="rounded-xl px-4 py-3 text-sm">{success}</div>}

          <button type="submit" disabled={busy} style={{ background: gradient, fontFamily: bodyFont }} className="w-full py-3 rounded-full text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60">
            {busy && <Loader2 size={16} className="animate-spin" />}
            {{ login: "Đăng nhập", register: "Đăng ký", forgot: "Gửi liên kết đặt lại", reset: "Đặt mật khẩu" }[mode]}
            <ArrowRight size={16} />
          </button>
        </form>

        {mode === "login" && <button onClick={() => { setMode("forgot"); setError(""); setSuccess(""); }} style={{ color: C.inkSoft, fontFamily: bodyFont }} className="w-full mt-4 text-sm font-semibold">Quên mật khẩu?</button>}
        <button onClick={() => { setMode((v) => v === "login" ? "register" : "login"); setError(""); setSuccess(""); }} style={{ color: C.primary, fontFamily: bodyFont }} className="w-full mt-4 text-sm font-semibold">
          {mode === "login" ? "Chưa có tài khoản? Đăng ký" : mode === "register" ? "Đã có tài khoản? Đăng nhập" : "← Quay lại đăng nhập"}
        </button>

        {/* Chỉ hiện ở môi trường phát triển (vite dev); bản build production KHÔNG lộ tài khoản mặc định. */}
        {import.meta.env.DEV && mode === "login" && <div style={{ color: C.inkSoft, border: `1px solid ${C.line}`, fontFamily: bodyFont }} className="mt-6 rounded-2xl p-4 text-xs leading-relaxed">
          <b>[Dev] Tài khoản quản trị demo (sau khi chạy seed:admin / seed demo):</b><br />Mật khẩu ADMIN được in ra khi chạy <code>npm run seed:admin</code>.
        </div>}
      </div>
    </div>
  );
}
