import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("tutor can navigate the demo lesson workflow", async ({ page }) => {
  await page.goto("/today");
  await expect(page.getByLabel("Portfolio demo information")).toContainText("Synthetic portfolio demo");
  await expect(page.getByRole("link", { name: "View source" })).toHaveAttribute("href", "https://github.com/dantheman24mac/teachnotes");
  await expect(page.getByRole("heading", { name: "Today’s agenda" })).toBeVisible();
  await expect(page.getByText("Liam Jacobs").first()).toBeVisible();
  const navigation = (page.viewportSize()?.width ?? 1280) < 700
    ? page.getByLabel("Mobile navigation")
    : page.getByLabel("Primary navigation");
  await navigation.getByRole("link", { name: "Students" }).click();
  await expect(page.getByRole("heading", { name: "Students" })).toBeVisible();
  await page.getByRole("link", { name: /Liam Jacobs/ }).click();
  await expect(page.getByRole("heading", { name: "Liam Jacobs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Previous lesson notes/ })).toBeVisible();
  await expect(page.getByText("Archive student", { exact: true })).toBeVisible();
});

test("student directory separates active and archived profiles", async ({ page }) => {
  await page.goto("/students");
  await expect(page).toHaveURL(/\/students$/);
  await expect(page.getByRole("link", { name: /Active 3/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Liam Jacobs", { exact: true })).toBeVisible();
  await expect(page.getByText("Maya Petersen", { exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: /Archived 1/ }).click();
  await expect(page).toHaveURL(/\/students\?view=archived$/);
  await expect(page.getByText("Maya Petersen", { exact: true })).toBeVisible();
  await expect(page.getByText("Liam Jacobs", { exact: true })).toHaveCount(0);

  const search = page.getByLabel("Search archived students");
  await search.fill("not a student");
  await expect(page.getByRole("heading", { name: "No matching students" })).toBeVisible();
  await search.fill("Maya");
  await page.getByRole("link", { name: /Maya Petersen/ }).click();

  await expect(page.getByRole("heading", { name: "Maya Petersen" })).toBeVisible();
  await expect(page.getByText(/Archived \d/)).toBeVisible();
  await expect(page.getByText("Completed the final revision session and reviewed the exam checklist.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore student" })).toBeVisible();
});

test("invoice preview groups billable lessons", async ({ page }) => {
  await page.goto("/invoices/new");
  await expect(page.getByRole("heading", { name: "New invoice" })).toBeVisible();
  await expect(page.getByText("Invoice total")).toBeVisible();
  await expect(page.getByRole("button", { name: "Finalize & create Excel + PDF" })).toBeVisible();
  await page.getByLabel("Invoice type").selectOption("student");
  await expect(page.getByLabel("Student").locator("option", { hasText: "Maya Petersen (Archived)" })).toHaveCount(1);
});

test("today remains readable after the network drops", async ({ page, context }) => {
  await page.goto("/today");
  await page.waitForLoadState("networkidle");
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBeGreaterThan(0);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Today’s agenda" })).toBeVisible();
  await context.setOffline(false);
});
