import { expect, test } from "@playwright/test";

test("tutor can navigate the demo lesson workflow", async ({ page }) => {
  await page.goto("/today");
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
});

test("invoice preview groups billable lessons", async ({ page }) => {
  await page.goto("/invoices/new");
  await expect(page.getByRole("heading", { name: "New invoice" })).toBeVisible();
  await expect(page.getByText("Invoice total")).toBeVisible();
  await expect(page.getByRole("button", { name: "Finalize & create PDF" })).toBeVisible();
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
