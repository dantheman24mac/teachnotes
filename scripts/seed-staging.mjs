import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

if (required("TEACHNOTES_ENVIRONMENT") !== "staging") throw new Error("Seed is staging-only");
if (required("NEXT_PUBLIC_SUPABASE_URL") !== "https://staging-api.teachnotes.fyi") {
  throw new Error("Refusing to seed a non-staging public URL");
}
if (required("SUPABASE_INTERNAL_URL") !== "http://kong:8000") {
  throw new Error("Refusing to seed an unexpected internal URL");
}

const supabase = createClient(required("SUPABASE_INTERNAL_URL"), required("SUPABASE_SECRET_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function ensureUser(email, password) {
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 100) break;
    page += 1;
  }
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  return data.user;
}

const admin = await ensureUser(required("STAGING_ADMIN_EMAIL"), required("STAGING_ADMIN_PASSWORD"));
const tutor = await ensureUser(required("STAGING_TUTOR_EMAIL"), required("STAGING_TUTOR_PASSWORD"));

const { error: accountError } = await supabase.from("accounts").upsert([
  { user_id: admin.id, email: admin.email, role: "admin", status: "approved", must_change_password: false, is_protected: true, reviewed_at: new Date().toISOString() },
  { user_id: tutor.id, email: tutor.email, role: "user", status: "approved", must_change_password: false, is_protected: false, reviewed_at: new Date().toISOString(), reviewed_by: admin.id },
]);
if (accountError) throw accountError;

const { error: settingsError } = await supabase.from("business_settings").upsert({
  owner_id: admin.id,
  tutor_name: "Staging Tutor",
  tutor_email: "admin@staging.teachnotes.test",
  tutor_phone: "+27 00 000 0000",
  tutor_address: "1 Fictional Avenue, Testville",
  default_payer_name: "Staging Learning Centre",
  default_payer_email: "accounts@staging.teachnotes.test",
  default_payer_address: "2 Example Street, Testville",
  payment_terms_days: 7,
  bank_details: "TEST BANK ONLY\nAccount: 000000000\nNo real payments",
  invoice_prefix: "STG",
  timezone: "Africa/Johannesburg",
  currency: "ZAR",
});
if (settingsError) throw settingsError;

const activeId = "51000000-0000-4000-8000-000000000001";
const secondId = "51000000-0000-4000-8000-000000000002";
const archivedId = "51000000-0000-4000-8000-000000000003";
const now = new Date();
const iso = (days, hour = 14) => {
  const value = new Date(now);
  value.setDate(value.getDate() + days);
  value.setHours(hour, 0, 0, 0);
  return value.toISOString();
};

const { error: studentError } = await supabase.from("students").upsert([
  { id: activeId, owner_id: admin.id, display_name: "Liam Staging", guardian_name: "Morgan Example", billing_email: "morgan@staging.teachnotes.test", billing_address: "10 Fictional Road", default_duration_minutes: 60, default_rate_cents: 45000, active: true, deleted_at: null },
  { id: secondId, owner_id: admin.id, display_name: "Amahle Staging", guardian_name: "Taylor Example", billing_email: "taylor@staging.teachnotes.test", billing_address: "20 Fictional Road", default_duration_minutes: 45, default_rate_cents: 38000, active: true, deleted_at: null },
  { id: archivedId, owner_id: admin.id, display_name: "Archived Staging Student", guardian_name: "Casey Example", billing_email: "casey@staging.teachnotes.test", default_duration_minutes: 60, default_rate_cents: 40000, active: false, deleted_at: iso(-30) },
]);
if (studentError) throw studentError;

const seriesId = "52000000-0000-4000-8000-000000000001";
const { error: seriesError } = await supabase.from("lesson_series").upsert({
  id: seriesId, owner_id: admin.id, student_id: activeId,
  starts_at_local: iso(-21).replace("Z", ""), timezone: "Africa/Johannesburg",
  frequency: "weekly", weekdays: [now.getDay()], until: null, exclusions: [], active: true,
});
if (seriesError) throw seriesError;

const { error: lessonError } = await supabase.from("lessons").upsert([
  { id: "53000000-0000-4000-8000-000000000001", owner_id: admin.id, student_id: activeId, series_id: seriesId, occurrence_key: iso(-14), starts_at: iso(-14), duration_minutes: 60, rate_cents: 45000, status: "attended", billing_override: "default", notes: "Fictional attended staging lesson." },
  { id: "53000000-0000-4000-8000-000000000002", owner_id: admin.id, student_id: secondId, series_id: null, occurrence_key: null, starts_at: iso(-7), duration_minutes: 45, rate_cents: 38000, status: "no_show", billing_override: "default", notes: "Fictional no-show staging lesson." },
  { id: "53000000-0000-4000-8000-000000000003", owner_id: admin.id, student_id: activeId, series_id: seriesId, occurrence_key: iso(7), starts_at: iso(7), duration_minutes: 60, rate_cents: 45000, status: "scheduled", billing_override: "default", notes: "Future staging lesson; not invoice eligible." },
]);
if (lessonError) throw lessonError;

const { error: bucketError } = await supabase.storage.createBucket("invoices", {
  public: false,
  fileSizeLimit: 10 * 1024 * 1024,
  allowedMimeTypes: ["application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
});
if (bucketError && !/already exists/i.test(bucketError.message)) throw bucketError;

process.stdout.write("Staging users and fictional fixtures are ready.\n");
