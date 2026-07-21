"use client";

import { KeyRound, LockKeyhole } from "lucide-react";
import { useActionState, useState } from "react";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { changeTemporaryPassword, type ChangePasswordState } from "./actions";

const initialState: ChangePasswordState = { message: "", resetTurnstile: 0 };

export function ChangePasswordForm({ turnstileSiteKey }: { turnstileSiteKey?: string | null }) {
  const [state, formAction, pending] = useActionState(changeTemporaryPassword, initialState);
  const [captchaToken, setCaptchaToken] = useState("");
  return <form className="login-form" action={formAction}>
    <label htmlFor="currentPassword">Temporary or current password</label>
    <div className="input-with-icon"><KeyRound size={18} /><input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required /></div>
    <label htmlFor="password">New password</label>
    <div className="input-with-icon"><LockKeyhole size={18} /><input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required placeholder="At least 12 characters" /></div>
    <label htmlFor="confirmPassword">Confirm new password</label>
    <div className="input-with-icon"><LockKeyhole size={18} /><input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required /></div>
    <input name="captchaToken" type="hidden" value={captchaToken} />
    <TurnstileWidget siteKey={turnstileSiteKey} onTokenChange={setCaptchaToken} resetKey={state.resetTurnstile} />
    {state.message && <p className="form-error" aria-live="polite">{state.message}</p>}
    <button className="button-primary" type="submit" disabled={pending || Boolean(turnstileSiteKey && !captchaToken)}>{pending ? "Changing password…" : turnstileSiteKey && !captchaToken ? "Complete security check" : "Set new password"}</button>
    <p className="form-help">TeachNotes access remains locked until this change succeeds.</p>
  </form>;
}
