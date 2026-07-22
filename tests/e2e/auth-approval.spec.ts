import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const enabled = process.env.AUTH_E2E === "true";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const adminEmail = process.env.AUTH_E2E_ADMIN_EMAIL ?? "";
const adminPassword = process.env.AUTH_E2E_ADMIN_PASSWORD ?? "";
const appBaseUrl = process.env.AUTH_E2E_BASE_URL ?? "http://localhost:3000";
const missingConfiguration = [
  ["NEXT_PUBLIC_SUPABASE_URL", supabaseUrl],
  ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publishableKey],
  ["SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY", serviceKey],
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

async function authCookieNames(context: BrowserContext) {
  return (await context.cookies())
    .map(({ name }) => name)
    .filter((name) => /-auth-token(?:\.\d+)?$/.test(name));
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

async function seedOfflineStudent(page: Page, databaseName: string, id: string) {
  await page.evaluate(async ({ databaseName: name, id: studentId }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("students", "readwrite");
      transaction.objectStore("students").put({ id: studentId, displayName: "Offline cleanup sentinel" });
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }), { databaseName, id });
}

async function teachNotesCacheNames(page: Page) {
  return page.evaluate(async () => (await caches.keys()).filter((name) => name.startsWith("teachnotes-")));
}

test.describe("authenticated account approval", () => {
  test.skip(!enabled, "Set AUTH_E2E=true to run authenticated Supabase coverage");
  test.skip(enabled && missingConfiguration.length > 0, `Missing authenticated E2E configuration: ${missingConfiguration.join(", ")}`);

  test("signup, approval, isolation, revocation and password replacement", async ({ browser, page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "The stateful authenticated lifecycle runs once in the desktop project");
    test.setTimeout(180_000);

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
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    for (const [label, observedPage] of [["user-a", page], ["admin", adminPage], ["user-b", userBPage]] as const) {
      observedPage.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(`${label}: ${message.text()}`);
      });
      observedPage.on("pageerror", (error) => pageErrors.push(`${label}: ${error.message}`));
    }

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
      const directAdmin = userClient(adminToken);
      const { error: protectedError } = await directAdmin.rpc("review_account", {
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
      await expect(page).toHaveURL(/\/today$/, { timeout: 15_000 });
      await reviewFromAdmin(adminPage, admin, emailB, "pending", "Approve", "approved");
      await expect(userBPage).toHaveURL(/\/today$/, { timeout: 15_000 });

      await createStudent(page, studentA);
      await createStudent(userBPage, studentB);
      await page.goto("/students");
      await expect(page.getByText(studentA, { exact: true })).toBeVisible();
      await expect(page.getByText(studentB, { exact: true })).toHaveCount(0);
      await userBPage.goto("/students");
      await expect(userBPage.getByText(studentB, { exact: true })).toBeVisible();
      await expect(userBPage.getByText(studentA, { exact: true })).toHaveCount(0);

      const { data: rowsA, error: rowsAError } = await directA.from("students").select("id,display_name");
      const { data: rowsB, error: rowsBError } = await directB.from("students").select("id,display_name");
      expect(rowsAError).toBeNull();
      expect(rowsBError).toBeNull();
      expect(rowsA?.map(({ display_name }) => display_name)).toEqual([studentA]);
      expect(rowsB?.map(({ display_name }) => display_name)).toEqual([studentB]);
      const { data: crossTenantRows } = await directB.from("students").select("id").eq("id", rowsA![0].id);
      expect(crossTenantRows).toEqual([]);

      const databaseA = `teachnotes-user-${accountA.user_id}`;
      await expect.poll(() => page.evaluate(() => localStorage.getItem("teachnotes-active-user"))).toBe(accountA.user_id);
      await expect.poll(() => databaseNames(page)).toContain(databaseA);
      await seedOfflineStudent(page, databaseA, rowsA![0].id);
      await expect.poll(() => databaseRecordExists(page, databaseA, "students", rowsA![0].id)).toBe(true);
      await expect.poll(() => teachNotesCacheNames(page)).toContain("teachnotes-offline-v4");

      await reviewFromAdmin(adminPage, admin, emailA, "approved", "Revoke", "rejected");
      await page.goto("/students");
      await expect(page).toHaveURL(/\/pending$/);
      await expect(page.getByRole("heading", { name: "Your account is not active" })).toBeVisible();
      expect((await page.context().request.get("/api/sync")).status()).toBe(403);
      expect((await directA.from("students").select("id")).data).toEqual([]);
      await expect.poll(() => page.evaluate(() => localStorage.getItem("teachnotes-active-user"))).toBeNull();
      await expect.poll(() => databaseRecordExists(page, databaseA, "students", rowsA![0].id)).toBe(false);

      await page.getByRole("button", { name: "Sign out and clear this device", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
      await expect.poll(() => authCookieNames(page.context())).toHaveLength(0);
      expect((await page.context().request.get("/api/account-status")).status()).toBe(401);
      expect(await databaseRecordExists(page, databaseA, "students", rowsA![0].id)).toBe(false);
      expect(await page.evaluate(() => localStorage.getItem("teachnotes-active-user"))).toBeNull();
      await expect.poll(() => teachNotesCacheNames(page)).toEqual([]);

      await signIn(page, emailA, initialPasswordA);
      await expect(page).toHaveURL(/\/pending$/);
      await expect(page.getByRole("heading", { name: "Your account is not active" })).toBeVisible();

      await reviewFromAdmin(adminPage, admin, emailA, "rejected", "Approve", "approved");
      await expect(page).toHaveURL(/\/today$/, { timeout: 15_000 });

      await reviewFromAdmin(adminPage, admin, emailA, "approved", "Revoke", "rejected");
      await page.goto("/students");
      await expect(page).toHaveURL(/\/pending$/);
      await expect(page.getByRole("heading", { name: "Your account is not active" })).toBeVisible();
      const { error: manualApprovalError } = await directAdmin.rpc("review_account", {
        p_user_id: accountA.user_id,
        p_status: "approved",
      });
      expect(manualApprovalError).toBeNull();
      await expect.poll(async () => (await accountByEmail(admin, emailA))?.status).toBe("approved");
      await page.getByRole("button", { name: "Check now" }).click();
      await expect(page).toHaveURL(/\/today$/);

      const temporaryPassword = await resetPasswordFromAdmin(adminPage, admin, emailA);
      await page.goto("/today");
      if (new URL(page.url()).pathname === "/login") await signIn(page, emailA, temporaryPassword);
      await expect(page).toHaveURL(/\/change-password$/);
      await page.getByLabel("Temporary or current password").fill(temporaryPassword);
      await page.getByLabel("New password", { exact: true }).fill(finalPasswordA);
      await page.getByLabel("Confirm new password").fill(finalPasswordA);
      await waitForTurnstile(page);
      await page.getByRole("button", { name: "Set new password" }).click();
      await expect(page).toHaveURL(/\/today$/);
      await expect.poll(async () => (await accountByEmail(admin, emailA))?.must_change_password).toBe(false);

      await page.goto("/settings");
      await page.getByRole("complementary").getByRole("button", { name: "Sign out and clear this device", exact: true }).click();
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

      expect(pageErrors, "Browser pages must not throw runtime errors").toEqual([]);
      expect(
        consoleErrors.filter((message) => /hydration|Minified React error #418|server rendered HTML/i.test(message)),
        "Browser consoles must not report hydration failures",
      ).toEqual([]);
    } finally {
      await adminContext.close();
      await userBContext.close();
      for (const email of [emailA, emailB]) {
        const user = await findAuthUser(admin, email).catch(() => null);
        if (user) await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
      }
    }
  });
});
