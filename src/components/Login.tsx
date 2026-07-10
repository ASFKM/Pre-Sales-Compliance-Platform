import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Shield, Key, Mail, Lock, CircleCheck, CircleAlert, ArrowRight, FingerprintPattern } from "lucide-react";
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

  // Localization Dictionary
  const dict = {
    en: {
      title: "Commercial Assistant AI",
      subtitle: "Enterprise Pre-Sales & Proposal Hardening Platform",
      emailLabel: "Work Email",
      passwordLabel: "Password",
      loginBtn: "Sign In Securely",
      mfaTitle: "Multi-Factor Authentication",
      mfaSubtitle: "Enter the 6-digit verification code sent to your device",
      mfaLabel: "MFA Verification Code",
      mfaBtn: "Verify & Authenticate",
      mfaPlaceholder: isDemoRuntime ? "e.g., 123456" : "Verification code",
      quickSelect: isDemoRuntime ? "Select B2B Seeded Role for Verification" : "",
      adminRole: isDemoRuntime ? "System Administrator (Sarah / Alex)" : "",
      managerRole: isDemoRuntime ? "Sales Manager (Marcus)" : "",
      engineerRole: isDemoRuntime ? "Pre-Sales Engineer (Elena)" : "",
      demoNotice: isDemoRuntime ? "Secure prototype mode. Default credentials: password123" : "",
      mfaNotice: isDemoRuntime ? "MFA code: 123456, 000000, or 111111" : "",
      invalidCreds: "Invalid email or password.",
      invalidMfa: "Invalid verification code."
    },
    pt: {
      title: "Commercial Assistant AI",
      subtitle: "Plataforma de Engenharia de Pré-Vendas e Propostas",
      emailLabel: "E-mail Corporativo",
      passwordLabel: "Senha",
      loginBtn: "Entrar com Segurança",
      mfaTitle: "Autenticação de Dois Fatores",
      mfaSubtitle: "Digite o código de 6 dígitos enviado para seu dispositivo",
      mfaLabel: "Código de Verificação MFA",
      mfaBtn: "Verificar e Autenticar",
      mfaPlaceholder: isDemoRuntime ? "ex: 123456" : "Código de verificação",
      quickSelect: isDemoRuntime ? "Selecionar Papel Semeado para Verificação" : "",
      adminRole: isDemoRuntime ? "Administrador do Sistema (Alex Rivera)" : "",
      managerRole: isDemoRuntime ? "Gerente de Vendas (Marcus Vance)" : "",
      engineerRole: isDemoRuntime ? "Engenheira de Pré-Vendas (Elena Rostova)" : "",
      demoNotice: isDemoRuntime ? "Modo protótipo seguro. Senha padrão: password123" : "",
      mfaNotice: isDemoRuntime ? "Código MFA válido: 123456, 000000 ou 111111" : "",
      invalidCreds: "E-mail ou senha inválidos.",
      invalidMfa: "Código de verificação MFA inválido."
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
        onLoginSuccess(res.user, pendingToken);
      } else {
        setError(dict.invalidMfa);
      }
    } catch (err: any) {
      setError(err.message || dict.invalidMfa);
    } finally {
      setLoading(false);
    }
  };

  const quickLogin = (type: "admin" | "manager" | "engineer") => {
    const creds = {
      admin: { email: "alex.rivera@enterprise.com", pass: "password123" },
      manager: { email: "marcus.vance@enterprise.com", pass: "password123" },
      engineer: { email: "elena.rostova@enterprise.com", pass: "password123" }
    }[type];

    setEmail(creds.email);
    setPassword(creds.pass);
    setError("");
  };

  return (
    <div id="login-screen-wrapper" className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Background Decorative Gradients */}
      <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.06),transparent_45%)] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-full h-full bg-[radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.06),transparent_45%)] pointer-events-none" />

      <motion.div
        id="login-card"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-8 z-10"
      >
        {/* Header Branding */}
        <div className="text-center mb-8">
          <div className="mx-auto w-12 h-12 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-center mb-4 text-emerald-400">
            <Shield className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight leading-none mb-1.5">{dict.title}</h1>
          <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">{dict.subtitle}</p>
        </div>

        <AnimatePresence mode="wait">
          {!mfaRequired ? (
            <motion.form
              key="credentials-form"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              onSubmit={handlePasswordLogin}
              className="space-y-4"
            >
              {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg flex items-center gap-2 text-xs">
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
                    className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
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
                    className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {loading ? (dict.loginBtn === "Entrar com Segurança" ? "Autenticando..." : "Authenticating...") : dict.loginBtn}
                <ArrowRight className="w-4 h-4" />
              </button>

              {isDemoRuntime && (
                <>
                  {/* Quick Profile Selection */}
                  <div className="pt-6 border-t border-slate-800/60 mt-4">
                    <span className="block text-[10px] font-mono text-slate-500 uppercase tracking-wider mb-3 text-center">{dict.quickSelect}</span>
                    <div className="grid grid-cols-1 gap-2">
                      <button
                        type="button"
                        onClick={() => quickLogin("admin")}
                        className="py-2 px-3 bg-slate-950 hover:bg-slate-800 border border-slate-800/80 rounded-lg text-left text-xs text-slate-300 flex items-center justify-between transition-colors cursor-pointer"
                      >
                        <span>{dict.adminRole}</span>
                        <FingerprintPattern className="w-3.5 h-3.5 text-emerald-500" />
                      </button>
                      <button
                        type="button"
                        onClick={() => quickLogin("manager")}
                        className="py-2 px-3 bg-slate-950 hover:bg-slate-800 border border-slate-800/80 rounded-lg text-left text-xs text-slate-300 flex items-center justify-between transition-colors cursor-pointer"
                      >
                        <span>{dict.managerRole}</span>
                        <FingerprintPattern className="w-3.5 h-3.5 text-sky-500" />
                      </button>
                      <button
                        type="button"
                        onClick={() => quickLogin("engineer")}
                        className="py-2 px-3 bg-slate-950 hover:bg-slate-800 border border-slate-800/80 rounded-lg text-left text-xs text-slate-300 flex items-center justify-between transition-colors cursor-pointer"
                      >
                        <span>{dict.engineerRole}</span>
                        <FingerprintPattern className="w-3.5 h-3.5 text-amber-500" />
                      </button>
                    </div>
                  </div>

                  <div className="text-center text-[10px] text-slate-500 pt-4 leading-normal font-mono">
                    {dict.demoNotice}
                  </div>
                </>
              )}
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
                <div className="mx-auto w-10 h-10 bg-sky-500/10 border border-sky-500/30 rounded-xl flex items-center justify-center mb-3 text-sky-400">
                  <Key className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-semibold text-white">{dict.mfaTitle}</h3>
                <p className="text-[11px] text-slate-400 max-w-xs mx-auto leading-normal mt-1">{dict.mfaSubtitle}</p>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg flex items-center gap-2 text-xs">
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
                  className="w-full text-center tracking-[0.5em] font-mono text-lg py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-sky-500 transition-colors"
                  placeholder={dict.mfaPlaceholder}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
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
      </motion.div>
    </div>
  );
}
