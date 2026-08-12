import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const enabled = process.env.AUTH_E2E === "true";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const missingConfiguration = [supabaseUrl, publishableKey, serviceKey].some((value) => !value);

async function waitForTurnstile(page: Page) {
  await expect(page.locator('input[name="captchaToken"]')).not.toHaveValue("", { timeout: 30_000 });
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/today$/);
}

async function accessToken(context: BrowserContext) {
  const authCookies = (await context.cookies()).filter(({ name }) => /-auth-token(?:\.\d+)?$/.test(name));
  expect(authCookies.length).toBeGreaterThan(0);
  const unchunked = authCookies.find(({ name }) => !/\.\d+$/.test(name));
  const raw = unchunked?.value ?? authCookies
    .sort((left, right) => Number(left.name.match(/\.(\d+)$/)?.[1] ?? 0) - Number(right.name.match(/\.(\d+)$/)?.[1] ?? 0))
    .map(({ value }) => value)
    .join("");
  const json = raw.startsWith("base64-")
    ? Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8")
    : raw;
  const session = JSON.parse(json) as { access_token?: string } | [string];
  const token = Array.isArray(session) ? session[0] : session.access_token;
  expect(token).toBeTruthy();
  return token!;
}

function monthInTimezone(date: Date) {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  return `${parts.find(({ type }) => type === "year")!.value}-${parts.find(({ type }) => type === "month")!.value}`;
}

test.describe("spreadsheet invoice finalization", () => {
  test.skip(!enabled, "Set AUTH_E2E=true to run authenticated Supabase coverage");
  test.skip(enabled && missingConfiguration, "Missing local Supabase service configuration");

  test("finalizes archived-student and consolidated invoices with private Excel and PDF downloads", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "desktop", "The stateful artifact lifecycle runs once in the desktop project");

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const runId = `${Date.now()}-${crypto.randomUUID()}`;
    const email = `invoice-artifact-e2e-${runId}@example.test`;
    const password = ["invoice-artifact", crypto.randomUUID(), "Aa1!"].join("-");
    let userId: string | null = null;
    let direct: SupabaseClient | null = null;

    try {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(createError).toBeNull();
      userId = created.user!.id;

      expect((await admin.from("accounts").upsert({
        user_id: userId,
        email,
        role: "user",
        status: "approved",
        must_change_password: false,
        is_protected: false,
        reviewed_at: new Date().toISOString(),
      }, { onConflict: "user_id" })).error).toBeNull();

      expect((await admin.from("business_settings").upsert({
        owner_id: userId,
        tutor_name: "Invoice Test Tutor",
        tutor_email: email,
        tutor_phone: "+27 82 000 0000",
        tutor_address: "1 Test Street, Cape Town",
        default_payer_name: "Test Academy",
        default_payer_email: "accounts@example.test",
        default_payer_address: "2 Test Avenue, Cape Town",
        payment_terms_days: 7,
        bank_details: "Test Bank\nAccount no.: 1234567890",
        invoice_prefix: "E2E",
        timezone: "Africa/Johannesburg",
      }, { onConflict: "owner_id" })).error).toBeNull();

      await signIn(page, email, password);
      direct = createClient(supabaseUrl, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${await accessToken(page.context())}` } },
      });

      const { data: students, error: studentError } = await direct.from("students").insert([
        {
          owner_id: userId,
          display_name: `Active ${runId}`,
          guardian_name: "Active Parent",
          billing_email: "active@example.test",
          billing_address: "3 Test Road",
          default_duration_minutes: 60,
          default_rate_cents: 26460,
          active: true,
          deleted_at: null,
        },
        {
          owner_id: userId,
          display_name: `Archived ${runId}`,
          guardian_name: "Archived Parent",
          billing_email: "archived@example.test",
          billing_address: "4 Test Road",
          default_duration_minutes: 45,
          default_rate_cents: 19845,
          active: false,
          deleted_at: new Date().toISOString(),
        },
      ]).select("id,display_name,deleted_at");
      expect(studentError).toBeNull();
      const activeStudent = students!.find(({ deleted_at }) => !deleted_at)!;
      const archivedStudent = students!.find(({ deleted_at }) => deleted_at)!;

      const lessonMonth = new Date();
      lessonMonth.setUTCDate(15);
      lessonMonth.setUTCMonth(lessonMonth.getUTCMonth() - 1);
      lessonMonth.setUTCHours(8, 0, 0, 0);
      const month = monthInTimezone(lessonMonth);
      const activeLessonId = crypto.randomUUID();
      const archivedLessonId = crypto.randomUUID();
      const { error: lessonError } = await direct.from("lessons").insert([
        {
          id: activeLessonId,
          owner_id: userId,
          student_id: activeStudent.id,
          starts_at: lessonMonth.toISOString(),
          duration_minutes: 60,
          rate_cents: 26460,
          status: "scheduled",
          billing_override: "billable",
          notes: "Explicit billable override",
        },
        {
          id: archivedLessonId,
          owner_id: userId,
          student_id: archivedStudent.id,
          starts_at: new Date(lessonMonth.getTime() + 86_400_000).toISOString(),
          duration_minutes: 45,
          rate_cents: 19845,
          status: "no_show",
          billing_override: "default",
          notes: "Archived student history",
        },
      ]);
      expect(lessonError).toBeNull();

      await page.goto(`/invoices/new?month=${month}&kind=student&student=${archivedStudent.id}`);
      await expect(page.getByText("1 eligible lessons", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Finalize & create Excel + PDF" }).click();
      await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]+$/, { timeout: 30_000 });
      const individualId = page.url().match(/\/invoices\/([0-9a-f-]+)$/)![1];
      await expect(page.getByRole("link", { name: "Download Excel" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible();

      const individualXlsx = await page.request.get(`/api/invoices/${individualId}/xlsx`);
      expect(individualXlsx.status()).toBe(200);
      expect(individualXlsx.headers()["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      const individualXlsxBody = await individualXlsx.body();
      expect(individualXlsxBody.subarray(0, 2).toString()).toBe("PK");
      const individualPdf = await page.request.get(`/api/invoices/${individualId}/pdf`);
      expect(individualPdf.status()).toBe(200);
      expect(individualPdf.headers()["content-type"]).toBe("application/pdf");
      expect((await individualPdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

      const { data: individualRow } = await direct.from("invoices")
        .select("kind,status,document_format,total_cents,xlsx_path,pdf_path")
        .eq("id", individualId)
        .single();
      expect(individualRow).toMatchObject({
        kind: "student",
        status: "finalized",
        document_format: "spreadsheet_v1",
        total_cents: 19845,
      });
      expect(individualRow?.xlsx_path).toContain(`/${individualId}/`);
      expect(individualRow?.pdf_path).toContain(`/${individualId}/`);
      const { error: overwriteError } = await direct.storage.from("invoices").upload(
        individualRow!.xlsx_path,
        Buffer.from("PK tampered workbook"),
        { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", upsert: true },
      );
      expect(overwriteError).toBeTruthy();
      expect(await (await page.request.get(`/api/invoices/${individualId}/xlsx`)).body()).toEqual(individualXlsxBody);
      expect((await direct.from("lessons").select("invoiced_at").eq("id", archivedLessonId).single()).data?.invoiced_at).toBeTruthy();

      await page.goto(`/invoices/new?month=${month}`);
      await expect(page.getByText("1 eligible lessons", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Finalize & create Excel + PDF" }).click();
      await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]+$/, { timeout: 30_000 });
      const consolidatedId = page.url().match(/\/invoices\/([0-9a-f-]+)$/)![1];
      expect(consolidatedId).not.toBe(individualId);
      await expect(page.getByRole("link", { name: "Download Excel" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible();
      expect((await page.request.get(`/api/invoices/${consolidatedId}/xlsx`)).status()).toBe(200);
      expect((await page.request.get(`/api/invoices/${consolidatedId}/pdf`)).status()).toBe(200);

      const { data: consolidatedRow } = await direct.from("invoices")
        .select("kind,status,document_format,total_cents,xlsx_path,pdf_path")
        .eq("id", consolidatedId)
        .single();
      expect(consolidatedRow).toMatchObject({
        kind: "consolidated",
        status: "finalized",
        document_format: "spreadsheet_v1",
        total_cents: 26460,
      });
      expect((await direct.from("lessons").select("invoiced_at").eq("id", activeLessonId).single()).data?.invoiced_at).toBeTruthy();

      await page.goto(`/invoices/new?month=${month}`);
      await expect(page.getByRole("heading", { name: "Nothing to invoice" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Finalize & create Excel + PDF" })).toBeDisabled();

      const retryLessonId = crypto.randomUUID();
      const retryInvoiceId = crypto.randomUUID();
      const retryLessonDate = new Date(lessonMonth.getTime() + 2 * 86_400_000).toISOString();
      expect((await direct.from("lessons").insert({
        id: retryLessonId,
        owner_id: userId,
        student_id: activeStudent.id,
        starts_at: retryLessonDate,
        duration_minutes: 30,
        rate_cents: 15000,
        status: "attended",
        billing_override: "default",
        notes: "Retry snapshot lesson",
        invoiced_at: new Date().toISOString(),
      })).error).toBeNull();
      const tutorSnapshot = {
        tutorName: "Invoice Test Tutor",
        tutorEmail: email,
        tutorPhone: "+27 82 000 0000",
        tutorAddress: "1 Test Street, Cape Town",
        defaultPayerName: "Test Academy",
        defaultPayerEmail: "accounts@example.test",
        defaultPayerAddress: "2 Test Avenue, Cape Town",
        paymentTermsDays: 7,
        bankDetails: "Test Bank\nAccount no.: 1234567890",
        invoicePrefix: "E2E",
        timezone: "Africa/Johannesburg",
        currency: "ZAR",
      };
      expect((await direct.from("invoices").insert({
        id: retryInvoiceId,
        owner_id: userId,
        number: `E2E-RETRY-${Date.now()}`,
        kind: "student",
        status: "finalized",
        document_format: "spreadsheet_v1",
        student_id: activeStudent.id,
        period_start: lessonMonth.toISOString(),
        period_end: new Date(lessonMonth.getTime() + 86_400_000).toISOString(),
        tutor_snapshot: tutorSnapshot,
        recipient_snapshot: { name: "Active Parent", email: "active@example.test", address: "3 Test Road" },
        total_cents: 15000,
        issued_at: new Date().toISOString(),
        due_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      })).error).toBeNull();
      expect((await direct.from("invoice_lines").insert({
        invoice_id: retryInvoiceId,
        lesson_id: retryLessonId,
        student_name: activeStudent.display_name,
        lesson_date: retryLessonDate,
        duration_minutes: 30,
        lesson_status: "attended",
        amount_cents: 15000,
      })).error).toBeNull();

      await page.goto(`/invoices/${retryInvoiceId}?artifact=failed`);
      await expect(page.locator(".artifact-notice.error")).toContainText("files could not be created");
      await page.getByRole("button", { name: "Retry file generation" }).click();
      await expect(page).toHaveURL(new RegExp(`/invoices/${retryInvoiceId}\\?artifact=ready$`), { timeout: 30_000 });
      await expect(page.getByRole("link", { name: "Download Excel" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible();
      expect((await direct.from("invoices").select("xlsx_path,pdf_path").eq("id", retryInvoiceId).single()).data).toEqual({
        xlsx_path: expect.stringContaining(`/${retryInvoiceId}/`),
        pdf_path: expect.stringContaining(`/${retryInvoiceId}/`),
      });

      const legacyInvoiceId = crypto.randomUUID();
      expect((await direct.from("invoices").insert({
        id: legacyInvoiceId,
        owner_id: userId,
        number: `LEGACY-${Date.now()}`,
        kind: "consolidated",
        status: "finalized",
        document_format: "legacy_pdf",
        period_start: lessonMonth.toISOString(),
        period_end: new Date(lessonMonth.getTime() + 86_400_000).toISOString(),
        tutor_snapshot: tutorSnapshot,
        recipient_snapshot: { name: "Legacy Payer", email: "legacy@example.test", address: "5 Test Road" },
        total_cents: 0,
        issued_at: new Date().toISOString(),
        due_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      })).error).toBeNull();
      await page.goto(`/invoices/${legacyInvoiceId}`);
      await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Download Excel" })).toHaveCount(0);
      expect((await page.request.get(`/api/invoices/${legacyInvoiceId}/xlsx`)).status()).toBe(404);
      const legacyPdf = await page.request.get(`/api/invoices/${legacyInvoiceId}/pdf`);
      expect(legacyPdf.status()).toBe(200);
      expect((await legacyPdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    } finally {
      if (direct && userId) {
        const { data: folders } = await direct.storage.from("invoices").list(userId).catch(() => ({ data: null }));
        for (const folder of folders ?? []) {
          const folderPath = `${userId}/${folder.name}`;
          const { data: files } = await direct.storage.from("invoices").list(folderPath).catch(() => ({ data: null }));
          if (files?.length) await direct.storage.from("invoices").remove(files.map(({ name }) => `${folderPath}/${name}`)).catch(() => undefined);
        }
      }
      if (userId) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
  });
});
