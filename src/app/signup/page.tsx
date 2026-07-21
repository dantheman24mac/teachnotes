import { GraduationCap, ShieldCheck, UserRoundCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/auth";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Request an account" };

export default async function SignupPage() {
  const context = await getAccountContext();
  if (context?.account?.status === "approved") redirect(context.account.mustChangePassword ? "/change-password" : "/today");
  if (context) redirect("/pending");
  const siteKey = process.env.TURNSTILE_SITE_KEY ?? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  return <main className="login-page"><section className="login-story"><div className="login-brand"><span><GraduationCap /></span>TeachNotes</div><div><p className="eyebrow light">Join your teaching workspace</p><h1>Start with a<br />private account.</h1><p>Create your login now. The TeachNotes administrator will review it before any student, lesson, or invoice tools become available.</p></div><div className="login-benefits"><span><ShieldCheck /> Admin-approved access</span><span><UserRoundCheck /> Separate tutor workspace</span></div></section><section className="login-panel"><div className="login-card"><p className="eyebrow">Account request</p><h2>Create your sign-in</h2><p className="subtle">Your email identifies your account but is not verified by email.</p><SignupForm turnstileSiteKey={siteKey} /></div></section></main>;
}
