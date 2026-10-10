import { test, expect } from "@playwright/test";

const company = { id: "company1", name: "Alpha" };
const user = {
  id: "user1",
  fullName: "Alex Owner",
  email: "alex@example.test",
  companyId: company.id,
};
const file = {
  id: "file1",
  originalFilename: "Payroll.xlsx",
  fileType: "xlsx",
  size: 2048,
  createdAt: "2026-10-10T10:00:00Z",
  uploaderId: user.id,
  companyId: company.id,
  uploader: user,
  company,
  visibility: "restricted",
};

async function setup(page, respond) {
  const queries = [];
  await page.addInitScript(() =>
    sessionStorage.setItem("datavault.platform.session", "fixture-admin"),
  );
  await page.route("**/backend/admin/**", async (route) => {
    const url = new URL(route.request().url());
    expect(route.request().method()).toBe("GET");
    if (url.pathname.endsWith("/files")) {
      queries.push(url.searchParams);
      if (respond) return respond(route, url);
      return route.fulfill({
        json: { items: [file], pagination: { total: 30 } },
      });
    }
    if (url.pathname.endsWith("/companies"))
      return route.fulfill({
        json: { items: [company], pagination: { total: 1 } },
      });
    if (url.pathname.endsWith("/users"))
      return route.fulfill({
        json: { items: [user], pagination: { total: 1 } },
      });
    return route.fulfill({ json: {} });
  });
  await page.goto("/admin");
  return queries;
}

test("file metadata, server filters, sorting, pagination, and uploader drilldown", async ({
  page,
}) => {
  const queries = await setup(page);
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.getByRole("table")).toContainText("Payroll.xlsx");
  await expect(page.getByRole("table")).toContainText("alex@example.test");
  await expect(page.getByRole("table")).toContainText("Alpha");
  await expect(page.getByRole("table")).toContainText("2 KB");
  await expect(page.getByRole("table")).toContainText("Restricted");
  await expect(page.locator("time")).toHaveAttribute(
    "datetime",
    file.createdAt,
  );
  await page.getByLabel("Filename", { exact: true }).fill("Payroll");
  await page.getByLabel("Uploader name or email").fill("alex@");
  await page.getByRole("button", { name: "Search files", exact: true }).click();
  await expect.poll(() => queries.at(-1).get("search")).toBe("Payroll");
  expect(queries.at(-1).get("uploaderSearch")).toBe("alex@");
  await page.getByLabel("Company filter").selectOption(company.id);
  await expect.poll(() => queries.at(-1).get("companyId")).toBe(company.id);
  await expect(page.getByLabel("User filter")).toBeEnabled();
  await page.getByLabel("User filter").selectOption(user.id);
  await expect.poll(() => queries.at(-1).get("userId")).toBe(user.id);
  await page.getByLabel("Sort files").selectOption("size");
  await page.getByLabel("Sort direction").selectOption("asc");
  await page.getByLabel("Files per page").selectOption("10");
  await expect.poll(() => queries.at(-1).get("limit")).toBe("10");
  expect(queries.at(-1).get("sortBy")).toBe("size");
  expect(queries.at(-1).get("order")).toBe("asc");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect.poll(() => queries.at(-1).get("page")).toBe("2");
  await page
    .getByRole("button", { name: "View uploader files for Alex Owner" })
    .click();
  await expect.poll(() => queries.at(-1).get("page")).toBe("1");
  expect(queries.at(-1).get("search")).toBeNull();
  expect(queries.at(-1).get("uploaderSearch")).toBeNull();
  expect(queries.at(-1).get("userId")).toBe(user.id);
  await page.getByLabel("File type").selectOption("xlsx");
  await expect.poll(() => queries.at(-1).get("fileType")).toBe("xlsx");
  await page.getByLabel("File access").selectOption("restricted");
  await expect.poll(() => queries.at(-1).get("visibility")).toBe("restricted");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect.poll(() => queries.at(-1).has("userId")).toBe(false);
  expect(queries.at(-1).has("fileType")).toBe(false);
  expect(queries.at(-1).has("visibility")).toBe(false);
  await expect(page.getByLabel("User filter")).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/admin-files-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/admin-files-desktop.png",
    fullPage: true,
  });
});

test("selected user's files are reachable from Users", async ({ page }) => {
  const queries = await setup(page);
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await page.getByRole("button", { name: "View files for Alex Owner" }).click();
  await expect.poll(() => queries.at(-1)?.get("userId")).toBe(user.id);
  expect(queries.at(-1).get("companyId")).toBe(company.id);
  await expect(
    page.getByRole("region", { name: "Admin file management" }),
  ).toContainText("Files uploaded by Alex Owner");
});

test("loading, error recovery, empty results, and expired admin session", async ({
  page,
}) => {
  let mode = "loading",
    release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await setup(page, async (route) => {
    if (mode === "loading") await pending;
    if (mode === "error")
      return route.fulfill({
        status: 503,
        json: { message: "Directory temporarily unavailable" },
      });
    if (mode === "unauthorized")
      return route.fulfill({
        status: 401,
        json: { message: "Session expired" },
      });
    return route.fulfill({ json: { items: [], pagination: { total: 0 } } });
  });
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.getByText("Loading files", { exact: true })).toBeVisible();
  mode = "error";
  release();
  await expect(
    page
      .getByRole("region", { name: "Admin file management" })
      .getByRole("alert"),
  ).toContainText("DataVault is temporarily unavailable");
  mode = "empty";
  await page.getByRole("button", { name: "Retry files" }).click();
  await expect(page.getByText("No files match these filters.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();
  mode = "unauthorized";
  await page.getByLabel("Sort direction").selectOption("asc");
  await expect(
    page.getByRole("heading", { name: "Platform administration" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("datavault.platform.session"),
    ),
  ).toBeNull();
});
