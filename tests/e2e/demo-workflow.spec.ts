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

test("calendar weekday controls have isolated accessible hit areas", async ({ page }) => {
  await page.goto("/calendar");
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const controls = weekdays.map((day) => page.getByRole("checkbox", { name: day }));

  await expect(controls[0]).toBeVisible();
  const boxes = await Promise.all(controls.map((control) => control.boundingBox()));
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    expect(box, `${weekdays[index]} checkbox should have a hit area`).not.toBeNull();
    const labelBox = await controls[index].locator("xpath=..").boundingBox();
    expect(labelBox, `${weekdays[index]} label should have a hit area`).not.toBeNull();
    expect(box!.width).toBeGreaterThan(20);
    expect(box!.height).toBeGreaterThanOrEqual(30);
    expect(box!.x).toBeGreaterThanOrEqual(labelBox!.x - 0.5);
    expect(box!.y).toBeGreaterThanOrEqual(labelBox!.y - 0.5);
    expect(box!.x + box!.width).toBeLessThanOrEqual(labelBox!.x + labelBox!.width + 0.5);
    expect(box!.y + box!.height).toBeLessThanOrEqual(labelBox!.y + labelBox!.height + 0.5);
    for (let other = index + 1; other < boxes.length; other += 1) {
      const next = boxes[other];
      expect(next).not.toBeNull();
      const overlaps = box!.x < next!.x + next!.width
        && box!.x + box!.width > next!.x
        && box!.y < next!.y + next!.height
        && box!.y + box!.height > next!.y;
      expect(overlaps, `${weekdays[index]} and ${weekdays[other]} hit areas should not overlap`).toBe(false);
    }
  }

  await controls[1].click();
  await controls[4].click();
  await expect(controls[1]).toBeChecked();
  await expect(controls[4]).toBeChecked();
  await expect(controls[6]).not.toBeChecked();

  await page.getByLabel("Repeats").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(controls[2]).toBeFocused();
  await expect.poll(() => controls[2].evaluate((control) => getComputedStyle(control.closest("label")!).outlineStyle)).toBe("solid");
  await expect.poll(() => controls[2].evaluate((control) => getComputedStyle(control.closest("label")!).outlineColor)).toBe("rgb(23, 71, 63)");
  await expect.poll(() => controls[2].evaluate((control) => getComputedStyle(control.closest("label")!).outlineWidth)).toBe("3px");
  await page.keyboard.press("Space");
  await expect(controls[2]).toBeChecked();
  await expect(controls[6]).not.toBeChecked();
  await expect.poll(() => controls[0].evaluate((control) => Array.from(
    new FormData(control.closest("form") as HTMLFormElement).getAll("weekdays"),
    String,
  ))).toEqual(["1", "2", "4"]);
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
