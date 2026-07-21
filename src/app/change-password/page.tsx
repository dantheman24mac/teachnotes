import { GraduationCap, KeyRound } from "lucide-react";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { getAccountContext } from "@/lib/auth";
import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "Change password" };
export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const context = await getAccountContext();
  if (!context) redirect("/login");
  if (!context.account || context.account.status !== "approved") redirect("/pending");
  if (!context.account.mustChangePassword) redirect("/today");
  const siteKey = process.env.TURNSTILE_SITE_KEY ?? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  return <main className="login-page"><section className="login-story"><div className="login-brand"><span><GraduationCap /></span>TeachNotes</div><div><p className="eyebrow light">Secure your account</p><h1>Choose a password<br />only you know.</h1><p>The administrator issued a one-time password. Replace it before opening any tutor data.</p></div><div className="login-benefits"><span><KeyRound /> Required before access</span></div></section><section className="login-panel"><div className="login-card"><p className="eyebrow">Password change required</p><h2>Set your new password</h2><p className="subtle">Enter the password the administrator shared with you, then choose a new one.</p><ChangePasswordForm turnstileSiteKey={siteKey} /><div className="status-signout"><SignOutButton /></div></div></section></main>;
}
