import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Key, Mail, Lock, CircleAlert, ArrowRight, ShieldAlert } from "lucide-react";
import ApiClient from "../lib/api";

interface LoginProps {
  locale: "en" | "pt";
  onLoginSuccess: (user: any, token: string) => void;
}

export default function Login({ locale, onLoginSuccess }: LoginProps) {
  const isDemoRuntime = import.meta.env.VITE_APP_RUNTIME_MODE !== "production";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [pendingToken, setPendingToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Roadmap (segurança): terceira etapa, mesmo padrão da etapa de MFA acima - o usuário novo (ou
  // que teve a senha redefinida pelo admin) precisa trocar a senha antes de entrar no app.
  const [mustChangePasswordStep, setMustChangePasswordStep] = useState(false);
  const [pendingUser, setPendingUser] = useState<any>(null);
  const [currentPasswordForChange, setCurrentPasswordForChange] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  // Localization Dictionary
  const dict = {
    en: {
      subtitle: "Enterprise Pre-Sales & Proposal Hardening Platform",
      emailLabel: "Work Email",
      passwordLabel: "Password",
      loginBtn: "Sign In",
      mfaTitle: "Multi-Factor Authentication",
      mfaSubtitle: "Enter the 6-digit verification code sent to your device",
      mfaLabel: "MFA Verification Code",
      mfaBtn: "Verify & Authenticate",
      mfaPlaceholder: isDemoRuntime ? "e.g., 123456" : "Verification code",
      mfaNotice: isDemoRuntime ? "MFA code: 123456, 000000, or 111111" : "",
      invalidCreds: "Invalid email or password.",
      invalidMfa: "Invalid verification code.",
      pwdChangeTitle: "Password Change Required",
      pwdChangeSubtitle: "This is either a new account or your password was reset - set a new password to continue.",
      currentPasswordLabel: "Current Password",
      newPasswordLabel: "New Password",
      confirmPasswordLabel: "Confirm New Password",
      pwdChangeBtn: "Set New Password",
      pwdMismatch: "The new password and confirmation don't match.",
      pwdTooShort: "The new password must be at least 8 characters long."
    },
    pt: {
      subtitle: "Plataforma de Engenharia de Pré-Vendas e Propostas",
      emailLabel: "E-mail Corporativo",
      passwordLabel: "Senha",
      loginBtn: "Entrar",
      mfaTitle: "Autenticação de Dois Fatores",
      mfaSubtitle: "Digite o código de 6 dígitos enviado para seu dispositivo",
      mfaLabel: "Código de Verificação MFA",
      mfaBtn: "Verificar e Autenticar",
      mfaPlaceholder: isDemoRuntime ? "ex: 123456" : "Código de verificação",
      mfaNotice: isDemoRuntime ? "Código MFA válido: 123456, 000000 ou 111111" : "",
      invalidCreds: "E-mail ou senha inválidos.",
      invalidMfa: "Código de verificação MFA inválido.",
      pwdChangeTitle: "Troca de Senha Obrigatória",
      pwdChangeSubtitle: "Esta é uma conta nova ou sua senha foi redefinida - defina uma nova senha para continuar.",
      currentPasswordLabel: "Senha Atual",
      newPasswordLabel: "Nova Senha",
      confirmPasswordLabel: "Confirmar Nova Senha",
      pwdChangeBtn: "Definir Nova Senha",
      pwdMismatch: "A nova senha e a confirmação não conferem.",
      pwdTooShort: "A nova senha precisa ter pelo menos 8 caracteres."
    }
  }[locale];

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res: any = await ApiClient.post("/api/auth/login", {
        email: email.trim(),
        password: password
      });

      if (res.success) {
        if (res.mfa_required) {
          setPendingToken(res.token);
          setMfaRequired(true);
        } else if (res.must_change_password) {
          setPendingToken(res.token);
          setPendingUser(res.user);
          setMustChangePasswordStep(true);
        } else {
          // No MFA required, direct login
          onLoginSuccess(res.user, res.token);
        }
      } else {
        setError(dict.invalidCreds);
      }
    } catch (err: any) {
      setError(err.message || dict.invalidCreds);
    } finally {
      setLoading(false);
    }
  };

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res: any = await ApiClient.post("/api/auth/mfa/verify", {
        token: pendingToken,
        code: mfaCode.trim()
      });

      if (res.success && res.verified) {
        if (res.must_change_password) {
          setPendingUser(res.user);
          setMustChangePasswordStep(true);
        } else {
          onLoginSuccess(res.user, pendingToken);
        }
      } else {
        setError(dict.invalidMfa);
      }
    } catch (err: any) {
      setError(err.message || dict.invalidMfa);
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError(dict.pwdTooShort);
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError(dict.pwdMismatch);
      return;
    }

    setLoading(true);
    try {
      const res: any = await ApiClient.post("/api/auth/change-password", {
        token: pendingToken,
        current_password: currentPasswordForChange,
        new_password: newPassword
      });

      if (res.success) {
        onLoginSuccess(pendingUser, pendingToken);
      } else {
        setError(res.message || dict.invalidCreds);
      }
    } catch (err: any) {
      setError(err.message || dict.invalidCreds);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="login-screen-wrapper" className="min-h-screen bg-brand-950 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Background Decorative Gradients */}
      <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_top_right,rgba(40,139,249,0.08),transparent_45%)] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-full h-full bg-[radial-gradient(circle_at_bottom_left,rgba(40,139,249,0.05),transparent_45%)] pointer-events-none" />

      <motion.div
        id="login-card"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md bg-brand-900 border border-brand-800 rounded-2xl shadow-2xl p-8 z-10"
      >
        {/* Header Branding */}
        <div className="text-center mb-8">
          <img src="/brand/logo-on-dark.svg" alt="Pre-Sales Compliance Platform" className="mx-auto h-14 w-auto object-contain mb-4" />
          <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">{dict.subtitle}</p>
        </div>

        <AnimatePresence mode="wait">
          {mustChangePasswordStep ? (
            <motion.form
              key="password-change-form"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              onSubmit={handleChangePassword}
              className="space-y-4"
            >
              <div className="text-center mb-4">
                <div className="mx-auto w-10 h-10 bg-warning-500/10 border border-warning-500/30 rounded-xl flex items-center justify-center mb-3 text-warning-400">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-semibold text-white">{dict.pwdChangeTitle}</h3>
                <p className="text-[11px] text-slate-400 max-w-xs mx-auto leading-normal mt-1">{dict.pwdChangeSubtitle}</p>
              </div>

              {error && (
                <div className="bg-danger-500/10 border border-danger-500/20 text-danger-400 p-3 rounded-lg flex items-center gap-2 text-xs">
                  <CircleAlert className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1.5">{dict.currentPasswordLabel}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                  <input
                    type="password"
                    required
                    value={currentPasswordForChange}
                    onChange={(e) => setCurrentPasswordForChange(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-brand-950 border border-brand-800 rounded-lg text-sm text-white focus:outline-none focus:border-brand-500 transition-colors"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1.5">{dict.newPasswordLabel}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-brand-950 border border-brand-800 rounded-lg text-sm text-white focus:outline-none focus:border-brand-500 transition-colors"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1.5">{dict.confirmPasswordLabel}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-brand-950 border border-brand-800 rounded-lg text-sm text-white focus:outline-none focus:border-brand-500 transition-colors"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {loading ? (locale === "pt" ? "Salvando..." : "Saving...") : dict.pwdChangeBtn}
                <ArrowRight className="w-4 h-4" />
              </button>
            </motion.form>
          ) : !mfaRequired ? (
            <motion.form
              key="credentials-form"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              onSubmit={handlePasswordLogin}
              className="space-y-4"
            >
              {error && (
                <div className="bg-danger-500/10 border border-danger-500/20 text-danger-400 p-3 rounded-lg flex items-center gap-2 text-xs">
                  <CircleAlert className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1.5">{dict.emailLabel}</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
                    className="w-full pl-10 pr-4 py-2 bg-brand-950 border border-brand-800 rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-brand-500 transition-colors"
                    placeholder="you@company.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1.5">{dict.passwordLabel}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
                    className="w-full pl-10 pr-4 py-2 bg-brand-950 border border-brand-800 rounded-lg text-sm text-white focus:outline-none focus:border-brand-500 transition-colors"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {loading ? (locale === "pt" ? "Autenticando..." : "Authenticating...") : dict.loginBtn}
                <ArrowRight className="w-4 h-4" />
              </button>
            </motion.form>
          ) : (
            <motion.form
              key="mfa-form"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              onSubmit={handleMfaVerify}
              className="space-y-4"
            >
              <div className="text-center mb-4">
                <div className="mx-auto w-10 h-10 bg-brand-500/10 border border-brand-500/30 rounded-xl flex items-center justify-center mb-3 text-brand-400">
                  <Key className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-semibold text-white">{dict.mfaTitle}</h3>
                <p className="text-[11px] text-slate-400 max-w-xs mx-auto leading-normal mt-1">{dict.mfaSubtitle}</p>
              </div>

              {error && (
                <div className="bg-danger-500/10 border border-danger-500/20 text-danger-400 p-3 rounded-lg flex items-center gap-2 text-xs">
                  <CircleAlert className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1.5 text-center">{dict.mfaLabel}</label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  className="w-full text-center tracking-[0.5em] font-mono text-lg py-2.5 bg-brand-950 border border-brand-800 rounded-lg text-white focus:outline-none focus:border-brand-500 transition-colors"
                  placeholder={dict.mfaPlaceholder}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {loading ? (dict.mfaBtn === "Verificar e Autenticar" ? "Verificando..." : "Verifying...") : dict.mfaBtn}
                <ArrowRight className="w-4 h-4" />
              </button>

              {isDemoRuntime && (
                <div className="text-center text-[10px] text-slate-500 pt-4 font-mono leading-normal">
                  {dict.mfaNotice}
                </div>
              )}
            </motion.form>
          )}
        </AnimatePresence>

        {/* Discreet footer mark -- not part of the product branding above, just credits the platform provider */}
        <div className="mt-8 pt-4 border-t border-brand-800/60 flex flex-col items-center gap-1">
          <span className="text-[9px] text-slate-400 uppercase tracking-wider font-mono">Powered by</span>
          <img src="/logo-cloudmountain-full.png" alt="CloudMountain" className="h-8 w-auto object-contain opacity-80" />
        </div>
      </motion.div>
    </div>
  );
}
