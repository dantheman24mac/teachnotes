"use client";

import { ArrowRight, LockKeyhole, Mail } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { clearOfflineSessionMarker } from "@/lib/offline";
import { signUpWithPassword, type SignupState } from "./actions";

const initialState: SignupState = { message: "", resetTurnstile: 0 };

export function SignupForm({ turnstileSiteKey }: { turnstileSiteKey?: string | null }) {
  const [state, formAction, pending] = useActionState(signUpWithPassword, initialState);
  const [captchaToken, setCaptchaToken] = useState("");

  useEffect(() => {
    void clearOfflineSessionMarker();
  }, []);

  return <form className="login-form" action={formAction}>
    <label htmlFor="email">Email</label>
    <div className="input-with-icon"><Mail size={18} /><input id="email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required placeholder="you@example.com" /></div>
    <label htmlFor="password">Password</label>
    <div className="input-with-icon"><LockKeyhole size={18} /><input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required placeholder="At least 12 characters" /></div>
    <label htmlFor="confirmPassword">Confirm password</label>
    <div className="input-with-icon"><LockKeyhole size={18} /><input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required placeholder="Repeat your password" /></div>
    <input name="captchaToken" type="hidden" value={captchaToken} />
    <TurnstileWidget siteKey={turnstileSiteKey} onTokenChange={setCaptchaToken} resetKey={state.resetTurnstile} />
    {state.message && <p className="form-error" aria-live="polite">{state.message}</p>}
    <button className="button-primary" disabled={pending || Boolean(turnstileSiteKey && !captchaToken)} type="submit">{pending ? "Creating account…" : turnstileSiteKey && !captchaToken ? "Complete security check" : "Request account"}<ArrowRight size={17} /></button>
    <p className="auth-switch">Already have an account? <Link href="/login">Sign in</Link></p>
    <p className="form-help">No confirmation email will arrive. You will stay signed in while the administrator reviews your request.</p>
  </form>;
}
