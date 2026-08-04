import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const enabled = process.env.AUTH_E2E === "true";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const adminEmail = process.env.AUTH_E2E_ADMIN_EMAIL ?? "";
const adminPassword = process.env.AUTH_E2E_ADMIN_PASSWORD ?? "";
const appBaseUrl = process.env.AUTH_E2E_BASE_URL ?? "http://localhost:3000";
const missingServiceConfiguration = [
  ["NEXT_PUBLIC_SUPABASE_URL", supabaseUrl],
  ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publishableKey],
  ["SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY", serviceKey],
].filter(([, value]) => !value).map(([name]) => name);
const missingAdminConfiguration = [
  ["AUTH_E2E_ADMIN_EMAIL", adminEmail],
  ["AUTH_E2E_ADMIN_PASSWORD", adminPassword],
].filter(([, value]) => !value).map(([name]) => name);

type AccountRow = {
  user_id: string;
  email: string;
  role: "admin" | "user";
  status: "pending" | "approved" | "rejected";
  must_change_password: boolean;
  is_protected: boolean;
};

function serviceClient() {
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function userClient(accessToken: string) {
  return createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function findAuthUser(admin: SupabaseClient, email: string): Promise<User | null> {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
}

async function accountByEmail(admin: SupabaseClient, email: string): Promise<AccountRow | null> {
  const { data, error } = await admin
    .from("accounts")
    .select("user_id,email,role,status,must_change_password,is_protected")
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
  return data as AccountRow | null;
}

async function waitForAccount(admin: SupabaseClient, email: string) {
  let account: AccountRow | null = null;
  await expect.poll(async () => {
    account = await accountByEmail(admin, email);
    return account?.status ?? null;
  }).toBe("pending");
  return account!;
}

async function waitForTurnstile(page: Page) {
  const token = page.locator('input[name="captchaToken"]');
  await expect(token, "Turnstile must provide a token; use Cloudflare's always-pass test keys locally").not.toHaveValue("", { timeout: 30_000 });
}

async function signUp(page: Page, email: string, password: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: "Request account" }).click();
  await expect(page).toHaveURL(/\/pending$/);
  await expect(page.getByRole("heading", { name: "Your request is in the queue" })).toBeVisible();
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await waitForTurnstile(page);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function accessToken(context: BrowserContext) {
  const authCookies = (await context.cookies())
    .filter(({ name }) => /-auth-token(?:\.\d+)?$/.test(name));
  expect(authCookies.length, "Supabase SSR auth cookie should exist").toBeGreaterThan(0);

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
  expect(token, "Supabase SSR cookie should contain an access token").toBeTruthy();
  return token!;
}

async function reviewFromAdmin(
  page: Page,
  admin: SupabaseClient,
  email: string,
  currentStatus: AccountRow["status"],
  action: "Approve" | "Reject" | "Revoke",
  expectedStatus: AccountRow["status"],
) {
  await page.goto("/admin/users");
  await page.getByRole("button", { name: new RegExp(`^${currentStatus}`, "i") }).click();
  const row = page.locator("article.account-row").filter({ hasText: email });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: action }).click();
  await expect.poll(async () => (await accountByEmail(admin, email))?.status).toBe(expectedStatus);
}

async function resetPasswordFromAdmin(page: Page, admin: SupabaseClient, email: string) {
  await page.goto("/admin/users");
  await page.getByRole("button", { name: /^approved/i }).click();
  const row = page.locator("article.account-row").filter({ hasText: email });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Reset password" }).click();
  await expect.poll(async () => (await accountByEmail(admin, email))?.must_change_password).toBe(true);
  const password = row.locator(".temporary-password code");
  await expect(password).toBeVisible();
  return (await password.textContent())!;
}

async function createStudent(page: Page, name: string) {
  await page.goto("/students");
  await page.getByLabel("Student name").fill(name);
  await page.getByRole("button", { name: "Add student" }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

async function createLegacyDatabase(page: Page, studentId: string) {
  await page.evaluate(async ({ id }) => {
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase("teachnotes");
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error);
      deletion.onblocked = () => reject(new Error("Legacy database deletion was blocked"));
    });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("teachnotes", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        const lessons = db.createObjectStore("lessons", { keyPath: "id" });
        lessons.createIndex("by-start", "startsAt");
        db.createObjectStore("students", { keyPath: "id" });
        const outbox = db.createObjectStore("outbox", { keyPath: "id" });
        outbox.createIndex("by-created", "clientTimestamp");
        db.createObjectStore("conflicts", { keyPath: "operation.id" });
        db.createObjectStore("meta", { keyPath: "key" });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("students", "readwrite");
        transaction.objectStore("students").put({
          id,
          displayName: "Legacy browser student",
          guardianName: null,
          billingEmail: null,
          billingAddress: null,
          defaultDurationMinutes: 60,
          defaultRateCents: 45000,
          active: true,
          syncRevision: 1,
        });
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, { id: studentId });
}

async function databaseNames(page: Page) {
  return page.evaluate(async () => (await indexedDB.databases()).map(({ name }) => name ?? ""));
}

async function databaseRecordExists(page: Page, databaseName: string, storeName: string, id: string) {
  return page.evaluate(async ({ databaseName: name, storeName: store, id: key }) => new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(store)) { db.close(); resolve(false); return; }
      const lookup = db.transaction(store).objectStore(store).get(key);
      lookup.onsuccess = () => { db.close(); resolve(Boolean(lookup.result)); };
      lookup.onerror = () => { db.close(); reject(lookup.error); };
    };
  }), { databaseName, storeName, id });
}

test.describe("authenticated account approval", () => {
  test.skip(!enabled, "Set AUTH_E2E=true to run authenticated Supabase coverage");
  test.skip(enabled && missingServiceConfiguration.length > 0, `Missing authenticated E2E configuration: ${missingServiceConfiguration.join(", ")}`);

  test("signup, approval, isolation, revocation and password replacement", async ({ browser, page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "desktop", "The stateful authenticated lifecycle runs once in the desktop project");
    test.skip(missingAdminConfiguration.length > 0, `Missing authenticated admin configuration: ${missingAdminConfiguration.join(", ")}`);

    const runId = `${Date.now()}-${crypto.randomUUID()}`;
    const emailA = `auth-e2e-a-${runId}@example.test`;
    const emailB = `auth-e2e-b-${runId}@example.test`;
    const generatedCredential = (label: string) => [label, crypto.randomUUID(), "Aa1!"].join("-");
    const initialPasswordA = generatedCredential("initial-a");
    const initialPasswordB = generatedCredential("initial-b");
    const finalPasswordA = generatedCredential("changed-a");
    const studentA = `Alice-only ${runId}`;
    const studentB = `Bob-only ${runId}`;
    const legacyStudentId = crypto.randomUUID();
    const admin = serviceClient();
    const adminContext = await browser.newContext({ baseURL: appBaseUrl });
    const userBContext = await browser.newContext({ baseURL: appBaseUrl });
    const adminPage = await adminContext.newPage();
    const userBPage = await userBContext.newPage();

    try {
      const adminAccount = await accountByEmail(admin, adminEmail);
      expect(adminAccount).toMatchObject({ role: "admin", status: "approved", is_protected: true });

      await adminPage.goto("/login");
      await createLegacyDatabase(adminPage, legacyStudentId);
      await signIn(adminPage, adminEmail, adminPassword);
      await expect(adminPage).toHaveURL(/\/today$/);

      const adminDatabase = `teachnotes-user-${adminAccount!.user_id}`;
      await expect.poll(() => databaseNames(adminPage)).toContain(adminDatabase);
      await expect.poll(() => databaseNames(adminPage)).not.toContain("teachnotes");
      await expect.poll(() => databaseRecordExists(adminPage, adminDatabase, "students", legacyStudentId)).toBe(true);

      const adminToken = await accessToken(adminContext);
      const { error: protectedError } = await userClient(adminToken).rpc("review_account", {
        p_user_id: adminAccount!.user_id,
        p_status: "rejected",
      });
      expect(protectedError, "The protected administrator must be guarded in SQL").toBeTruthy();
      expect(await accountByEmail(admin, adminEmail)).toMatchObject({ status: "approved", is_protected: true });

      await signUp(page, emailA, initialPasswordA);
      const accountA = await waitForAccount(admin, emailA);
      const tokenA = await accessToken(page.context());
      const directA = userClient(tokenA);

      const statusResponse = await page.context().request.get("/api/account-status");
      expect(statusResponse.status()).toBe(200);
      expect(await statusResponse.json()).toMatchObject({ status: "pending", mustChangePassword: false });
      const syncResponse = await page.context().request.get("/api/sync");
      expect(syncResponse.status()).toBe(403);

      const { data: ownAccounts, error: ownAccountError } = await directA.from("accounts").select("user_id,status");
      expect(ownAccountError).toBeNull();
      expect(ownAccounts).toEqual([{ user_id: accountA.user_id, status: "pending" }]);
      const { data: hiddenStudents, error: hiddenStudentError } = await directA.from("students").select("id");
      expect(hiddenStudentError).toBeNull();
      expect(hiddenStudents).toEqual([]);
      const { error: insertError } = await directA.from("students").insert({
        owner_id: accountA.user_id,
        display_name: "Pending user must not create this",
        default_duration_minutes: 60,
        default_rate_cents: 10000,
      });
      expect(insertError).toBeTruthy();
      const { error: invoiceRpcError } = await directA.rpc("next_invoice_number", { p_prefix: "E2E" });
      expect(invoiceRpcError).toBeTruthy();
      const { error: reviewRpcError } = await directA.rpc("review_account", {
        p_user_id: accountA.user_id,
        p_status: "approved",
      });
      expect(reviewRpcError).toBeTruthy();
      const { error: storageError } = await directA.storage
        .from("invoices")
        .upload(`${accountA.user_id}/pending.pdf`, new Blob(["blocked"], { type: "application/pdf" }));
      expect(storageError).toBeTruthy();

      await signUp(userBPage, emailB, initialPasswordB);
      const accountB = await waitForAccount(admin, emailB);
      const tokenB = await accessToken(userBContext);
      const directB = userClient(tokenB);

      await reviewFromAdmin(adminPage, admin, emailA, "pending", "Approve", "approved");
      await page.getByRole("button", { name: "Check now" }).click();
      await expect(page).toHaveURL(/\/today$/);
      await reviewFromAdmin(adminPage, admin, emailB, "pending", "Approve", "approved");
      await userBPage.getByRole("button", { name: "Check now" }).click();
      await expect(userBPage).toHaveURL(/\/today$/);

      await createStudent(page, studentA);
      await createStudent(userBPage, studentB);
      await page.goto("/students");
      await expect(page.getByText(studentA, { exact: true })).toBeVisible();
      await expect(page.getByText(studentB, { exact: true })).toHaveCount(0);
      await userBPage.goto("/students");
      await expect(userBPage.getByText(studentB, { exact: true })).toBeVisible();
      await expect(userBPage.getByText(studentA, { exact: true })).toHaveCount(0);

      const { data: rowsA, error: rowsAError } = await directA.from("students").select("id,display_name,sync_revision");
      const { data: rowsB, error: rowsBError } = await directB.from("students").select("id,display_name");
      expect(rowsAError).toBeNull();
      expect(rowsBError).toBeNull();
      expect(rowsA?.map(({ display_name }) => display_name)).toEqual([studentA]);
      expect(rowsB?.map(({ display_name }) => display_name)).toEqual([studentB]);
      const { data: crossTenantRows } = await directB.from("students").select("id").eq("id", rowsA![0].id);
      expect(crossTenantRows).toEqual([]);

      const archiveAfterRevision = Number(rowsA![0].sync_revision);
      const now = Date.now();
      const pastAttendedAt = new Date(now - 86_400_000).toISOString();
      const futureScheduledAt = new Date(now + 7 * 86_400_000).toISOString();
      const futureNoShowAt = new Date(now + 8 * 86_400_000).toISOString();
      const futureInvoicedAt = new Date(now + 9 * 86_400_000).toISOString();
      const { data: series, error: seriesError } = await directA.from("lesson_series").insert({
        owner_id: accountA.user_id,
        student_id: rowsA![0].id,
        starts_at_local: "2099-01-01T10:00:00",
        timezone: "Africa/Johannesburg",
        frequency: "weekly",
        weekdays: [1],
      }).select("id").single();
      expect(seriesError).toBeNull();
      const lessonFixtures = [
        { id: crypto.randomUUID(), starts_at: pastAttendedAt, status: "attended", invoiced_at: null },
        { id: crypto.randomUUID(), starts_at: futureScheduledAt, status: "scheduled", invoiced_at: null },
        { id: crypto.randomUUID(), starts_at: futureNoShowAt, status: "no_show", invoiced_at: null },
        { id: crypto.randomUUID(), starts_at: futureInvoicedAt, status: "scheduled", invoiced_at: new Date(now).toISOString() },
      ];
      const { error: lessonFixtureError } = await directA.from("lessons").insert(lessonFixtures.map((lesson, index) => ({
        ...lesson,
        owner_id: accountA.user_id,
        student_id: rowsA![0].id,
        series_id: series!.id,
        occurrence_key: lesson.starts_at,
        duration_minutes: 60,
        rate_cents: 45000,
        notes: index === 0 ? "Preserved archive history" : "",
      })));
      expect(lessonFixtureError).toBeNull();

      const staleLessonPage = await page.context().newPage();
      const staleLessonResponse = await staleLessonPage.goto(`/lessons/${lessonFixtures[1].id}`);
      expect(staleLessonResponse?.status()).toBe(200);
      await staleLessonPage.getByText("Reschedule this lesson or series", { exact: true }).click();
      await expect(staleLessonPage.getByRole("button", { name: "Update schedule" })).toBeVisible();

      expect((await directB.rpc("archive_student", { p_student_id: rowsA![0].id })).error).toBeTruthy();
      expect((await directB.rpc("restore_student", { p_student_id: rowsA![0].id })).error).toBeTruthy();

      await page.goto(`/students/${rowsA![0].id}`);
      await page.getByText("Archive student", { exact: true }).click();
      await page.getByRole("button", { name: "Confirm archive" }).click();
      await expect(page).toHaveURL(/\/students\?view=archived$/);
      await expect(page.getByText(studentA, { exact: true })).toBeVisible();

      const { data: archivedStudent } = await directA.from("students").select("active,deleted_at").eq("id", rowsA![0].id).single();
      expect(archivedStudent?.active).toBe(false);
      expect(archivedStudent?.deleted_at).toBeTruthy();
      const { data: archivedSeries } = await directA.from("lesson_series").select("active,deleted_at").eq("id", series!.id).single();
      expect(archivedSeries).toMatchObject({ active: false });
      expect(archivedSeries?.deleted_at).toBeTruthy();
      const { data: archivedLessons } = await directA.from("lessons").select("id,status,invoiced_at,deleted_at").in("id", lessonFixtures.map((lesson) => lesson.id));
      expect(archivedLessons?.find((lesson) => lesson.id === lessonFixtures[0].id)?.deleted_at).toBeNull();
      expect(archivedLessons?.find((lesson) => lesson.id === lessonFixtures[1].id)?.deleted_at).toBeTruthy();
      expect(archivedLessons?.find((lesson) => lesson.id === lessonFixtures[2].id)?.deleted_at).toBeNull();
      expect(archivedLessons?.find((lesson) => lesson.id === lessonFixtures[3].id)?.deleted_at).toBeNull();

      await staleLessonPage.getByLabel("New date and time").fill("2099-01-02T10:00");
      await staleLessonPage.getByRole("button", { name: "Update schedule" }).click();
      await expect.poll(async () => {
        const { data, error } = await directA
          .from("lessons")
          .select("starts_at,deleted_at")
          .eq("id", lessonFixtures[1].id)
          .single();
        if (error) throw error;
        return {
          startsAt: new Date(data.starts_at).toISOString(),
          deleted: Boolean(data.deleted_at),
        };
      }).toEqual({ startsAt: futureScheduledAt, deleted: true });
      await staleLessonPage.close();

      const archivedLessonResponse = await page.goto(`/lessons/${lessonFixtures[1].id}`);
      expect(archivedLessonResponse?.status()).toBe(404);
      await expect(page.getByRole("button", { name: "Save lesson" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Update schedule" })).toHaveCount(0);

      const preservedNoShowResponse = await page.goto(`/lessons/${lessonFixtures[2].id}`);
      expect(preservedNoShowResponse?.status()).toBe(200);
      await expect(page.getByRole("button", { name: "Save lesson" })).toBeVisible();
      const preservedInvoicedResponse = await page.goto(`/lessons/${lessonFixtures[3].id}`);
      expect(preservedInvoicedResponse?.status()).toBe(200);
      await expect(page.getByRole("button", { name: "Save lesson" })).toBeVisible();

      await page.goto("/calendar");
      await expect(page.getByLabel("Student").locator("option", { hasText: studentA })).toHaveCount(0);
      await page.goto("/invoices/new?kind=student");
      await expect(page.getByLabel("Student").locator("option", { hasText: `${studentA} (Archived)` })).toHaveCount(1);

      const archivedSyncResponse = await page.context().request.get(`/api/sync?after=${archiveAfterRevision}`);
      expect(archivedSyncResponse.status()).toBe(200);
      const archivedSync = await archivedSyncResponse.json();
      expect(archivedSync.tombstones).toEqual(expect.arrayContaining([
        { entity: "student", id: rowsA![0].id },
        { entity: "lesson", id: lessonFixtures[1].id },
      ]));

      await page.goto(`/students/${rowsA![0].id}`);
      await page.getByRole("button", { name: "Restore student" }).click();
      await expect(page).toHaveURL(new RegExp(`/students/${rowsA![0].id}$`));
      await expect(page.getByText("Archive student", { exact: true })).toBeVisible();
      const { data: restoredStudent } = await directA.from("students").select("active,deleted_at").eq("id", rowsA![0].id).single();
      expect(restoredStudent).toEqual({ active: true, deleted_at: null });
      const { data: stillArchivedSeries } = await directA.from("lesson_series").select("active,deleted_at").eq("id", series!.id).single();
      expect(stillArchivedSeries?.active).toBe(false);
      expect(stillArchivedSeries?.deleted_at).toBeTruthy();
      const { data: stillDeletedLesson } = await directA.from("lessons").select("starts_at,deleted_at").eq("id", lessonFixtures[1].id).single();
      expect(stillDeletedLesson?.deleted_at).toBeTruthy();
      expect(new Date(stillDeletedLesson!.starts_at).toISOString()).toBe(futureScheduledAt);
      const restoredArchivedLessonResponse = await page.goto(`/lessons/${lessonFixtures[1].id}`);
      expect(restoredArchivedLessonResponse?.status()).toBe(404);

      const restoredSyncResponse = await page.context().request.get(`/api/sync?after=${archivedSync.revision}`);
      expect(restoredSyncResponse.status()).toBe(200);
      const restoredSync = await restoredSyncResponse.json();
      expect(restoredSync.students.some((student: { id: string }) => student.id === rowsA![0].id)).toBe(true);
      await page.goto("/calendar");
      await expect(page.getByLabel("Student").locator("option", { hasText: studentA })).toHaveCount(1);

      const databaseA = `teachnotes-user-${accountA.user_id}`;
      await expect.poll(() => page.evaluate(() => localStorage.getItem("teachnotes-active-user"))).toBe(accountA.user_id);
      await expect.poll(() => databaseNames(page)).toContain(databaseA);

      await reviewFromAdmin(adminPage, admin, emailA, "approved", "Revoke", "rejected");
      await page.goto("/students");
      await expect(page).toHaveURL(/\/pending$/);
      await expect(page.getByRole("heading", { name: "Your account is not active" })).toBeVisible();
      expect((await page.context().request.get("/api/sync")).status()).toBe(403);
      expect((await directA.from("students").select("id")).data).toEqual([]);

      await reviewFromAdmin(adminPage, admin, emailA, "rejected", "Approve", "approved");
      await page.getByRole("button", { name: "Check now" }).click();
      await expect(page).toHaveURL(/\/today$/);

      const temporaryPassword = await resetPasswordFromAdmin(adminPage, admin, emailA);
      await signIn(page, emailA, temporaryPassword);
      await expect(page).toHaveURL(/\/change-password$/);
      await page.reload();
      await page.getByLabel("Temporary or current password").fill(temporaryPassword);
      await page.getByLabel("New password", { exact: true }).fill(finalPasswordA);
      await page.getByLabel("Confirm new password").fill(finalPasswordA);
      await waitForTurnstile(page);
      await page.getByRole("button", { name: "Set new password" }).click();
      await expect(page).toHaveURL(/\/today$/);
      await expect.poll(async () => (await accountByEmail(admin, emailA))?.must_change_password).toBe(false);

      await page.goto("/settings");
      await page.getByRole("main").getByRole("button", { name: /Sign out and clear this device/ }).click();
      await expect(page).toHaveURL(/\/login$/);
      await expect.poll(() => databaseRecordExists(page, databaseA, "students", rowsA![0].id)).toBe(false);

      await signIn(page, emailB, initialPasswordB);
      await expect(page).toHaveURL(/\/today$/);
      const databaseB = `teachnotes-user-${accountB.user_id}`;
      await expect.poll(() => page.evaluate(() => localStorage.getItem("teachnotes-active-user"))).toBe(accountB.user_id);
      await expect.poll(() => databaseNames(page)).toContain(databaseB);
      expect(databaseB).not.toBe(databaseA);
      await page.goto("/students");
      await expect(page.getByText(studentB, { exact: true })).toBeVisible();
      await expect(page.getByText(studentA, { exact: true })).toHaveCount(0);

      await adminPage.goto("/admin/users");
      await adminPage.getByRole("button", { name: /^approved/i }).click();
      const protectedRow = adminPage.locator("article.account-row").filter({ hasText: adminEmail });
      await expect(protectedRow.getByText("Protected administrator")).toBeVisible();
      await expect(protectedRow.getByRole("button", { name: /Reject|Revoke|Reset password/ })).toHaveCount(0);
    } finally {
      await adminContext.close();
      await userBContext.close();
      for (const email of [emailA, emailB]) {
        const user = await findAuthUser(admin, email).catch(() => null);
        if (user) await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
      }
    }
  });

  test("lesson detail attendance syncs without the browser active-user marker and becomes invoice eligible", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(testInfo.project.name !== "desktop", "The authenticated lesson sync regression runs once in the desktop project");

    const runId = `${Date.now()}-${crypto.randomUUID()}`;
    const email = `lesson-sync-e2e-${runId}@example.test`;
    const password = ["lesson-sync", crypto.randomUUID(), "Aa1!"].join("-");
    const admin = serviceClient();
    let userId: string | null = null;

    try {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(createError).toBeNull();
      expect(created.user).not.toBeNull();
      userId = created.user!.id;

      const { error: accountError } = await admin.from("accounts").upsert({
        user_id: userId,
        email,
        role: "user",
        status: "approved",
        must_change_password: false,
        is_protected: false,
        reviewed_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      expect(accountError).toBeNull();
      const { error: settingsError } = await admin.from("business_settings").upsert({
        owner_id: userId,
        tutor_email: email,
      }, { onConflict: "owner_id" });
      expect(settingsError).toBeNull();

      await signIn(page, email, password);
      await expect(page).toHaveURL(/\/today$/);
      const token = await accessToken(page.context());
      const direct = userClient(token);

      const studentName = `Invoice eligibility ${runId}`;
      const { data: student, error: studentError } = await direct.from("students").insert({
        owner_id: userId,
        display_name: studentName,
        default_duration_minutes: 60,
        default_rate_cents: 45000,
      }).select("id").single();
      expect(studentError).toBeNull();

      const targetDate = new Date();
      targetDate.setUTCDate(15);
      targetDate.setUTCMonth(targetDate.getUTCMonth() - 1);
      targetDate.setUTCHours(10, 0, 0, 0);
      const monthParts = new Intl.DateTimeFormat("en-ZA", {
        timeZone: "Africa/Johannesburg",
        year: "numeric",
        month: "2-digit",
      }).formatToParts(targetDate);
      const year = monthParts.find(({ type }) => type === "year")!.value;
      const monthNumber = monthParts.find(({ type }) => type === "month")!.value;
      const invoiceMonth = `${year}-${monthNumber}`;
      const withinMonth = (hoursBeforeTarget: number) => new Date(targetDate.getTime() - hoursBeforeTarget * 3_600_000).toISOString();
      const outOfMonthDate = new Date(targetDate);
      outOfMonthDate.setUTCDate(15);
      outOfMonthDate.setUTCMonth(outOfMonthDate.getUTCMonth() - 1);
      const futureScheduledDate = new Date(Date.now() + 7 * 86_400_000);
      const targetLessonId = crypto.randomUUID();
      const fixtureLessons = [
        { id: targetLessonId, starts_at: targetDate.toISOString(), duration_minutes: 41, status: "scheduled", invoiced_at: null, deleted_at: null },
        { id: crypto.randomUUID(), starts_at: withinMonth(2), duration_minutes: 42, status: "no_show", invoiced_at: null, deleted_at: null },
        { id: crypto.randomUUID(), starts_at: withinMonth(4), duration_minutes: 51, status: "scheduled", invoiced_at: null, deleted_at: null },
        { id: crypto.randomUUID(), starts_at: futureScheduledDate.toISOString(), duration_minutes: 52, status: "scheduled", invoiced_at: null, deleted_at: null },
        { id: crypto.randomUUID(), starts_at: withinMonth(6), duration_minutes: 53, status: "attended", invoiced_at: new Date().toISOString(), deleted_at: null },
        { id: crypto.randomUUID(), starts_at: withinMonth(8), duration_minutes: 54, status: "attended", invoiced_at: null, deleted_at: new Date().toISOString() },
        { id: crypto.randomUUID(), starts_at: withinMonth(10), duration_minutes: 55, status: "canceled_rescheduled", invoiced_at: null, deleted_at: null },
        { id: crypto.randomUUID(), starts_at: outOfMonthDate.toISOString(), duration_minutes: 56, status: "attended", invoiced_at: null, deleted_at: null },
      ];
      const { error: lessonError } = await direct.from("lessons").insert(fixtureLessons.map((lesson) => ({
        ...lesson,
        owner_id: userId,
        student_id: student!.id,
        rate_cents: 45000,
        billing_override: "default",
        notes: "",
      })));
      expect(lessonError).toBeNull();

      await page.goto(`/lessons/${targetLessonId}`);
      await expect(page.getByRole("heading", { name: studentName })).toBeVisible();
      await expect(page.getByRole("button", { name: "Connection and synchronization status" })).toContainText("Synced");
      await expect.poll(() => page.evaluate(() => localStorage.getItem("teachnotes-active-user"))).toBe(userId);
      await page.evaluate(() => localStorage.removeItem("teachnotes-active-user"));
      expect(await page.evaluate(() => localStorage.getItem("teachnotes-active-user"))).toBeNull();

      await page.getByRole("group", { name: "Attendance" }).getByRole("button", { name: /Attended/ }).click();
      await page.getByRole("button", { name: "Save lesson" }).click();
      await expect.poll(async () => {
        const { data, error } = await direct.from("lessons").select("status").eq("id", targetLessonId).single();
        if (error) throw error;
        return data.status;
      }).toBe("attended");
      expect(await page.evaluate(() => localStorage.getItem("teachnotes-active-user"))).toBeNull();

      await page.goto(`/invoices/new?month=${invoiceMonth}&kind=student&student=${student!.id}`);
      const preview = page.locator(".invoice-preview");
      await expect(preview.getByText("2 eligible lessons", { exact: true })).toBeVisible();
      await expect(preview.getByText("41 min", { exact: true })).toBeVisible();
      await expect(preview.getByText("42 min", { exact: true })).toBeVisible();
      for (const duration of [51, 52, 53, 54, 55, 56]) {
        await expect(preview.getByText(`${duration} min`, { exact: true })).toHaveCount(0);
      }
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
  });
});
