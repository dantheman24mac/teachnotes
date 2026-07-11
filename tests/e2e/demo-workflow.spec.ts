import { expect, test } from "@playwright/test";

test("tutor can navigate the demo lesson workflow", async ({ page }) => {
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "Today’s agenda" })).toBeVisible();
  await expect(page.getByText("Liam Jacobs").first()).toBeVisible();
  await page.getByRole("link", { name: "Students" }).first().click();
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
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Today’s agenda" })).toBeVisible();
  await context.setOffline(false);
});
