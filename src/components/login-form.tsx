"use client";

import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";
import { useActionState } from "react";
import { signInWithPassword, type LoginState } from "@/app/login/actions";

const initialState: LoginState = { message: "" };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signInWithPassword, initialState);

  return <form className="login-form" action={formAction}>
    <label htmlFor="username">Username</label>
    <div className="input-with-icon"><UserRound size={18} /><input id="username" name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required placeholder="Your username" /></div>
    <label htmlFor="password">Password</label>
    <div className="input-with-icon"><LockKeyhole size={18} /><input id="password" name="password" type="password" autoComplete="current-password" required placeholder="Your password" /></div>
    {state.message && <p className="form-error" aria-live="polite">{state.message}</p>}
    <button className="button-primary" disabled={pending} type="submit">{pending ? "Signing in…" : "Sign in"}<ArrowRight size={17} /></button>
    <p className="form-help">Use the private username and password configured by the tutor.</p>
  </form>;
}
