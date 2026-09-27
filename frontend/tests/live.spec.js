import { test, expect } from "@playwright/test";
test("live public API responds through the same-origin gateway and rejects unauthenticated access", async ({
  page,
}) => {
  test.setTimeout(110000);
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const base = "/backend";
    const plans = await fetch(base + "/plans");
    const body = await plans.json();
    const protectedResponse = await fetch(base + "/auth/current-user");
    const paymentsResponse = await fetch(base + "/payments/current");
    const webhookResponse = await fetch(base + "/payments/webhook", { method: "POST" });
    return {
      status: plans.status,
      codes: body.map((p) => p.code),
      protectedStatus: protectedResponse.status,
      paymentsStatus: paymentsResponse.status,
      webhookStatus: webhookResponse.status,
    };
  });
  expect(result).toEqual({
    status: 200,
    codes: ["free", "basic", "premium"],
    protectedStatus: 401,
    paymentsStatus: 401,
    webhookStatus: 404,
  });
  await page.screenshot({
    path: "test-results/login-desktop.png",
    fullPage: true,
  });
});
