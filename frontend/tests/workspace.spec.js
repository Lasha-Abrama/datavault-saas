import { test, expect } from "@playwright/test";
const api = "http://localhost:3000/backend";
const owner = {
  _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  fullName: "Alex Morgan",
  email: "alex@example.test",
  role: "company_owner",
  companyId: "cccccccccccccccccccccccc",
  createdAt: "2026-09-01T00:00:00Z",
};
const member = {
  ...owner,
  _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
  role: "company_member",
  fullName: "Sam Lee",
  email: "sam@example.test",
};
const plans = [
  {
    code: "free",
    name: "Free",
    includedFilesPerMonth: 10,
    maxEmployees: 0,
    basePriceCents: 0,
    employeePriceCents: 0,
    extraFilePriceCents: null,
    currency: "USD",
    interval: "month",
  },
  {
    code: "basic",
    name: "Basic",
    includedFilesPerMonth: 100,
    maxEmployees: 10,
    basePriceCents: 0,
    employeePriceCents: 500,
    extraFilePriceCents: null,
    currency: "USD",
    interval: "month",
  },
  {
    code: "premium",
    name: "Premium",
    includedFilesPerMonth: 1000,
    maxEmployees: null,
    basePriceCents: 30000,
    employeePriceCents: 0,
    extraFilePriceCents: 50,
    currency: "USD",
    interval: "month",
  },
];
const billing = {
  plan: plans[1],
  billingPeriod: {
    startsAt: "2026-09-01T00:00:00Z",
    endsAt: "2026-10-01T00:00:00Z",
  },
  successfulUploads: 38,
  includedUploadAllowance: 100,
  employeeCount: 1,
  billableEmployeeCount: 1,
  employeeUnitPriceCents: 500,
  employeeChargeCents: 500,
  baseAmountCents: 0,
  overageChargeCents: 0,
  billableOverageUploads: 0,
  overageUnitPriceCents: 50,
  totalAmountCents: 500,
};
const files = [
  {
    id: "dddddddddddddddddddddddd",
    uploaderId: owner._id,
    originalFilename: "Quarterly revenue.xlsx",
    fileType: "xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: 23000,
    visibility: "company_wide",
    restrictedUserIds: [],
    createdAt: "2026-09-24T09:00:00Z",
    updatedAt: "2026-09-24T09:00:00Z",
  },
  {
    id: "eeeeeeeeeeeeeeeeeeeeeeee",
    uploaderId: member._id,
    originalFilename: "Operations.csv",
    fileType: "csv",
    size: 1200,
    visibility: "restricted",
    restrictedUserIds: [member._id],
    createdAt: "2026-09-23T09:00:00Z",
    updatedAt: "2026-09-23T09:00:00Z",
  },
];
// Fixtures exist only in automated tests. The application always uses the real API.
async function fixture(page, role = "owner") {
  await page.addInitScript(() =>
    sessionStorage.setItem("datavault.session", "test-only-session"),
  );
  await page.route(`${api}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      /^\/backend/,
      "",
    );
    const bodies = {
      "/auth/current-user": role === "owner" ? owner : member,
      "/companies/current": {
        name: "Northstar Studio",
        country: "GE",
        industry: "Technology",
        createdAt: owner.createdAt,
      },
      "/subscriptions/current": {
        plan: plans[1],
        billingPeriod: { ...billing.billingPeriod, uploadedFiles: 38 },
        employeeCount: 1,
        monthlyPriceEstimateCents: 500,
        billingSummary: billing,
      },
      "/subscriptions/current/billing": billing,
      "/plans": plans,
      "/statistics/current": {
        subscription: { planName: "Basic" },
        employees: { accepted: 1, pendingInvitations: 1 },
        files: {
          currentlyStored: { total: 2, restricted: 1, companyWide: 1 },
          currentBillingPeriod: {
            ...billing.billingPeriod,
            successfulUploads: 38,
            includedAllowance: 100,
            remainingIncludedUploads: 62,
          },
        },
        billing: { totalAmountCents: 500 },
      },
      "/files": { files, total: 2, page: 1, take: 30 },
      "/users": { users: [owner, member], total: 2, page: 1, take: 30 },
      "/invitations": { invitations: [], total: 0, page: 1, take: 30 },
      [`/files/${files[0].id}`]: files[0],
      [`/files/${files[1].id}`]: files[1],
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(bodies[path] || { message: "Updated" }),
    });
  });
}
test("redesigned directories and forms remain within desktop and mobile viewports", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in to your workspace" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/redesign-login.png",
    fullPage: true,
    animations: "disabled",
  });
  await fixture(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [route, heading] of [
      ["", "The big picture."],
      ["/files", "The file vault"],
      ["/employees", "Your people"],
      ["/billing", "Room to grow."],
      ["/settings", "Workspace settings"],
    ]) {
      await page.goto(`/dashboard${route}`);
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
      await expect(page.locator(".loading-state")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${route} at ${width}px`,
      ).toBeTruthy();
      await page.screenshot({
        path: `test-results/redesign-${route.slice(1) || "overview"}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
  }
});
test("unauthenticated routes redirect and registration renders without overflow", async ({
  page,
}) => {
  await page.goto("/dashboard/files");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Sign in to your workspace" })).toBeVisible();
  const loginHeadline = await page.locator(".story-body h1").boundingBox();
  await page.goto("/register");
  await expect(
    page.getByRole("heading", { name: "A home for your data." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create your workspace", exact: true })).toBeVisible();
  const signupHeadline = await page.locator(".story-body h1").boundingBox();
  expect(Math.abs(signupHeadline.y - loginHeadline.y)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/register-mobile.png",
    fullPage: true,
  });
});
test("owner workspace uses real response shape, filters files, and saves permissions", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "The big picture." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/overview-desktop.png",
    animations: "disabled",
    fullPage: true,
  });
  await page.goto("/dashboard/files");
  await page.getByRole("combobox", { name: "File type" }).selectOption("csv");
  await expect(
    page.getByRole("button", { name: "View Operations.csv" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Quarterly revenue.xlsx/ }),
  ).toHaveCount(0);
  await page.getByRole("combobox", { name: "File type" }).selectOption("");
  await page
    .getByRole("button", { name: "View Quarterly revenue.xlsx" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("radio", { name: /Selected employees only/ }).check();
  await page.getByRole("checkbox", { name: /Sam Lee/ }).check();
  const save = page.waitForRequest(
    (r) => r.method() === "PATCH" && r.url().endsWith("/permissions"),
  );
  await page.getByRole("button", { name: "Save access" }).click();
  expect((await save).postDataJSON()).toEqual({
    visibility: "restricted",
    restrictedUserIds: [member._id],
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("member cannot access employee controls; backend forbidden stays friendly", async ({
  page,
}) => {
  await fixture(page, "member");
  await page.goto("/dashboard/employees");
  await expect(
    page.getByRole("heading", { name: "Administrator access required" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Employees", exact: true }),
  ).toHaveCount(0);
  await page.route(`${api}/files?**`, (route) =>
    route.fulfill({
      status: 403,
      json: { message: "Internal forbidden detail" },
    }),
  );
  await page.goto("/dashboard/files");
  await expect(page.getByText(/You don’t have permission/)).toBeVisible();
  await expect(page.getByText("Internal forbidden detail")).toHaveCount(0);
});
test("expired sessions return to login; activation token is removed from history", async ({
  page,
}) => {
  await fixture(page);
  await page.route(`${api}/auth/current-user`, (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/activate?token=" + "a".repeat(43));
  await expect(page).toHaveURL(/\/activate$/);
  await page.route(`${api}/auth/verify-account`, (route) =>
    route.fulfill({ status: 400, json: {} }),
  );
  await page.getByRole("button", { name: "Activate account" }).click();
  await expect(
    page.getByText(/invalid, expired, or has already been used/),
  ).toBeVisible();
});
test("mobile navigation and billing fit viewport", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Billing", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Room to grow." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/billing-mobile.png",
    animations: "disabled",
    fullPage: true,
  });
});

test("AI conversations persist, continue and delete through documented endpoints", async ({
  page,
}) => {
  await fixture(page);
  const id = "ffffffffffffffffffffffff";
  const conversation = {
    id,
    title: "Usage question",
    messageCount: 2,
    createdAt: "2026-09-26T10:00:00Z",
    updatedAt: "2026-09-26T10:00:00Z",
  };
  let saved = false,
    deleted = false;
  let messages = [
    {
      id: "111111111111111111111111",
      role: "user",
      content: "What is our plan?",
    },
    {
      id: "222222222222222222222222",
      role: "assistant",
      content: "Your company is on the Basic plan.",
    },
  ];
  await page.route(`${api}/ai/conversations?**`, (route) =>
    route.fulfill({
      json: {
        conversations: saved && !deleted ? [conversation] : [],
        total: saved && !deleted ? 1 : 0,
        page: 1,
        limit: 20,
      },
    }),
  );
  await page.route(`${api}/ai/conversations/${id}`, (route) => {
    if (route.request().method() === "DELETE") {
      deleted = true;
      return route.fulfill({ json: { message: "Conversation deleted" } });
    }
    return route.fulfill({ json: { conversation, messages } });
  });
  await page.route(`${api}/ai/chat`, (route) => {
    saved = true;
    return route.fulfill({
      json: {
        requestId: "test",
        conversation,
        messages,
        usage: { totalTokens: 20 },
      },
    });
  });
  await page.goto("/dashboard/assistant");
  await page.getByLabel("Message the assistant").fill("What is our plan?");
  const first = page.waitForRequest(
    (r) => r.url().endsWith("/ai/chat") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect((await first).postDataJSON()).toEqual({
    message: "What is our plan?",
  });
  await expect(
    page.getByText("Your company is on the Basic plan.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Message the assistant").fill("What about limits?");
  const followup = page.waitForRequest(
    (r) => r.url().endsWith("/ai/chat") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect((await followup).postDataJSON()).toEqual({
    conversationId: id,
    message: "What about limits?",
  });
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete conversation: Usage question" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(
    page.getByText("Conversation deleted", { exact: true }),
  ).toBeVisible();
});

test("AI disabled state keeps the draft and mobile chat fits the viewport", async ({
  page,
}) => {
  await fixture(page, "member");
  await page.route(`${api}/ai/conversations?**`, (route) =>
    route.fulfill({
      json: { conversations: [], total: 0, page: 1, limit: 20 },
    }),
  );
  await page.route(`${api}/ai/chat`, (route) =>
    route.fulfill({
      status: 503,
      json: { code: "ai_disabled", message: "AI assistant is not configured" },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/assistant");
  await page
    .getByLabel("Message the assistant")
    .fill("How much usage is left?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByText("The AI assistant is not enabled on the server yet.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Message the assistant")).toHaveValue(
    "How much usage is left?",
  );
  await expect(page.getByLabel("Message the assistant")).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("floating chat opens from login and preserves a draft across workspace navigation", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Open AI chat", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little help, right here." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close chat", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open AI chat", exact: true }),
  ).toBeFocused();
  await fixture(page);
  await page.route(`${api}/ai/conversations?**`, (r) =>
    r.fulfill({ json: { conversations: [], total: 0, page: 1, limit: 20 } }),
  );
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Open AI chat", exact: true }).click();
  await page.getByLabel("Message the assistant").fill("Keep this draft for me");
  await page.getByRole("button", { name: "Close chat", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Open AI chat", exact: true }).click();
  await expect(page.getByLabel("Message the assistant")).toHaveValue(
    "Keep this draft for me",
  );
  await page.screenshot({
    path: "test-results/floating-chat-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/floating-chat-mobile.png",
    fullPage: true,
  });
  const panel = await page
    .getByRole("dialog", { name: "DataVault chat", exact: true })
    .boundingBox();
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(390);
  expect(panel.y).toBeGreaterThanOrEqual(0);
  expect(panel.y + panel.height).toBeLessThanOrEqual(844);
});
