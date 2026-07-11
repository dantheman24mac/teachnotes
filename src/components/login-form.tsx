"use client";

import { ArrowRight, CheckCircle2, Mail } from "lucide-react";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    const client = createClient();
    if (!client) { setError("Supabase is not configured. Copy .env.example to .env.local and add the local keys."); setBusy(false); return; }
    const { error: authError } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/today` } });
    if (authError) setError(authError.message); else setSent(true);
    setBusy(false);
  }
  if (sent) return <div className="login-message"><CheckCircle2 /><h2>Check your inbox</h2><p>We sent a secure sign-in link to <strong>{email}</strong>.</p></div>;
  return <form className="login-form" onSubmit={submit}><label htmlFor="email">Email address</label><div className="input-with-icon"><Mail size={18} /><input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></div>{error && <p className="form-error">{error}</p>}<button className="button-primary" disabled={busy} type="submit">{busy ? "Sending…" : "Email me a sign-in link"}<ArrowRight size={17} /></button><p className="form-help">No password to remember. Local email links appear in Supabase Mailpit.</p></form>;
}
