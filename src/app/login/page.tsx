import { GraduationCap, ShieldCheck, WifiOff } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getAccountContext } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const context = await getAccountContext();
  if (context?.account?.status === "approved") redirect(context.account.mustChangePassword ? "/change-password" : "/today");
  if (context) redirect("/pending");
  const siteKey = process.env.TURNSTILE_SITE_KEY ?? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  return <main className="login-page"><section className="login-story"><div className="login-brand"><span><GraduationCap /></span>TeachNotes</div><div><p className="eyebrow light">A clearer teaching day</p><h1>Keep the lesson.<br />Lose the paperwork.</h1><p>Notes, attendance, recurring schedules and accurate monthly invoices—kept together and available even when the connection isn’t.</p></div><div className="login-benefits"><span><WifiOff /> Offline lesson notes</span><span><ShieldCheck /> Private by default</span></div></section><section className="login-panel"><div className="login-card"><p className="eyebrow">Welcome back</p><h2>Sign in to your workspace</h2><p className="subtle">Use the email and password for your approved TeachNotes account.</p><LoginForm turnstileSiteKey={siteKey} />{!isSupabaseConfigured() && <Link className="demo-link" href="/today">Explore with demo data →</Link>}</div></section></main>;
}
