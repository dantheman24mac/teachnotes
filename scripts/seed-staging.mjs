import process from "node:process";

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

const baseUrl = required("SUPABASE_INTERNAL_URL");
const secretKey = required("SUPABASE_SECRET_KEY");
const adminHeaders = {
  apikey: secretKey,
  Authorization: `Bearer ${secretKey}`,
  "Content-Type": "application/json",
};

async function request(path, { method = "GET", body, allowStatuses = [], allowMessages = [] } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: adminHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const detail = await response.json();
      message = detail.message ?? detail.msg ?? detail.error ?? message;
    } catch {}
    if (allowStatuses.includes(response.status) || allowMessages.some((pattern) => pattern.test(message))) return null;
    throw new Error(`${method} ${path} failed (${response.status}): ${message}`);
  }
  if (response.status === 204 || response.headers.get("content-length") === "0") return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function ensureUser(email, password) {
  let page = 1;
  while (true) {
    const data = await request(`/auth/v1/admin/users?page=${page}&per_page=100`);
    const users = data.users ?? [];
    const found = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) {
      return request(`/auth/v1/admin/users/${found.id}`, {
        method: "PUT",
        body: { password, email_confirm: true },
      });
    }
    if (users.length < 100) break;
    page += 1;
  }
  return request("/auth/v1/admin/users", {
    method: "POST",
    body: { email, password, email_confirm: true },
  });
}

// Keep the Prefer header local to PostgREST writes while retaining the guarded
// request path above for Auth and Storage.
async function restUpsert(table, rows) {
  const response = await fetch(`${baseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...adminHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const detail = await response.json();
      message = detail.message ?? detail.details ?? detail.hint ?? message;
    } catch {}
    throw new Error(`POST /rest/v1/${table} failed (${response.status}): ${message}`);
  }
}

const admin = await ensureUser(required("STAGING_ADMIN_EMAIL"), required("STAGING_ADMIN_PASSWORD"));
const tutor = await ensureUser(required("STAGING_TUTOR_EMAIL"), required("STAGING_TUTOR_PASSWORD"));
const reviewedAt = new Date().toISOString();

await restUpsert("accounts", [
  { user_id: admin.id, email: admin.email, role: "admin", status: "approved", must_change_password: false, is_protected: true, reviewed_at: reviewedAt, reviewed_by: null },
  { user_id: tutor.id, email: tutor.email, role: "user", status: "approved", must_change_password: false, is_protected: false, reviewed_at: reviewedAt, reviewed_by: admin.id },
]);

await restUpsert("business_settings", {
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

await restUpsert("students", [
  { id: activeId, owner_id: admin.id, display_name: "Liam Staging", guardian_name: "Morgan Example", billing_email: "morgan@staging.teachnotes.test", billing_address: "10 Fictional Road", default_duration_minutes: 60, default_rate_cents: 45000, active: true, deleted_at: null },
  { id: secondId, owner_id: admin.id, display_name: "Amahle Staging", guardian_name: "Taylor Example", billing_email: "taylor@staging.teachnotes.test", billing_address: "20 Fictional Road", default_duration_minutes: 45, default_rate_cents: 38000, active: true, deleted_at: null },
  { id: archivedId, owner_id: admin.id, display_name: "Archived Staging Student", guardian_name: "Casey Example", billing_email: "casey@staging.teachnotes.test", billing_address: "30 Fictional Road", default_duration_minutes: 60, default_rate_cents: 40000, active: false, deleted_at: iso(-30) },
]);

const seriesId = "52000000-0000-4000-8000-000000000001";
await restUpsert("lesson_series", {
  id: seriesId, owner_id: admin.id, student_id: activeId,
  starts_at_local: iso(-21).replace("Z", ""), timezone: "Africa/Johannesburg",
  frequency: "weekly", weekdays: [now.getDay()], until: null, exclusions: [], active: true,
});

await restUpsert("lessons", [
  { id: "53000000-0000-4000-8000-000000000001", owner_id: admin.id, student_id: activeId, series_id: seriesId, occurrence_key: iso(-14), starts_at: iso(-14), duration_minutes: 60, rate_cents: 45000, status: "attended", billing_override: "default", notes: "Fictional attended staging lesson." },
  { id: "53000000-0000-4000-8000-000000000002", owner_id: admin.id, student_id: secondId, series_id: null, occurrence_key: null, starts_at: iso(-7), duration_minutes: 45, rate_cents: 38000, status: "no_show", billing_override: "default", notes: "Fictional no-show staging lesson." },
  { id: "53000000-0000-4000-8000-000000000003", owner_id: admin.id, student_id: activeId, series_id: seriesId, occurrence_key: iso(7), starts_at: iso(7), duration_minutes: 60, rate_cents: 45000, status: "scheduled", billing_override: "default", notes: "Future staging lesson; not invoice eligible." },
]);

await request("/storage/v1/bucket", {
  method: "POST",
  body: {
    id: "invoices",
    name: "invoices",
    public: false,
    file_size_limit: 10 * 1024 * 1024,
    allowed_mime_types: ["application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  },
  allowStatuses: [409],
  allowMessages: [/already exists/i],
});

process.stdout.write("Staging users and fictional fixtures are ready.\n");
