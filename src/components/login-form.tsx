"use client";

import { ArrowRight, LockKeyhole, Mail } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { signInWithPassword, type LoginState } from "@/app/login/actions";
import { clearOfflineSessionMarker } from "@/lib/offline";
import { TurnstileWidget } from "./turnstile-widget";

const initialState: LoginState = { message: "", resetTurnstile: 0 };

export function LoginForm({ turnstileSiteKey }: { turnstileSiteKey?: string | null }) {
  const [state, formAction, pending] = useActionState(signInWithPassword, initialState);
  const [captchaToken, setCaptchaToken] = useState("");

  useEffect(() => {
    void clearOfflineSessionMarker();
  }, []);

  return <form className="login-form" action={formAction}>
    <label htmlFor="email">Email</label>
    <div className="input-with-icon"><Mail size={18} /><input id="email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required placeholder="you@example.com" /></div>
    <label htmlFor="password">Password</label>
    <div className="input-with-icon"><LockKeyhole size={18} /><input id="password" name="password" type="password" autoComplete="current-password" required placeholder="Your password" /></div>
    <input name="captchaToken" type="hidden" value={captchaToken} />
    <TurnstileWidget siteKey={turnstileSiteKey} onTokenChange={setCaptchaToken} resetKey={state.resetTurnstile} />
    {state.message && <p className="form-error" aria-live="polite">{state.message}</p>}
    <button className="button-primary" disabled={pending || Boolean(turnstileSiteKey && !captchaToken)} type="submit">{pending ? "Signing in…" : turnstileSiteKey && !captchaToken ? "Complete security check" : "Sign in"}<ArrowRight size={17} /></button>
    <p className="auth-switch">New to TeachNotes? <Link href="/signup">Request an account</Link></p>
    <p className="form-help">There is no email password recovery. Contact the administrator if you need help signing in.</p>
  </form>;
}
