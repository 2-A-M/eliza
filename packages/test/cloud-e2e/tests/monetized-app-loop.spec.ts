import {
  DAILY_CONTAINER_COST_USD,
  runMonetizedAppLoop,
  SIMULATED_EARNINGS_USD,
} from "../src/helpers/monetized-app-loop";
import { expect, test } from "../src/helpers/test-fixtures";

/**
 * The autonomous monetized-app loop, exercised against the full mock-backed
 * cloud stack. This is the CI-automated form of
 * `scripts/monetized-app-loop-smoke.ts` — same steps via the shared
 * `runMonetizedAppLoop` helper, asserted with Playwright `expect`.
 *
 * Seeds a fresh org (1000 credits) via the `seededUser` fixture, then drives:
 *   apps.create -> apps.monetization.update -> domains.check -> domains.buy
 *   (real credit debit) -> record inference-markup earnings -> survival
 *   economics (earning agent pays its daily bill from earnings; broke agent is
 *   flagged for shutdown).
 */

// Custom-domain registration price (Cloudflare registrar / e2e stub), in USD.
const DOMAIN_PRICE_USD = 14.95;

test.describe("monetized-app loop", () => {
  // The first real request bundles + boots the worker (wrangler/workerd cold
  // start), which can outrun the default per-test timeout.
  test("create -> monetize -> buy domain -> survive on earnings", async ({
    stack,
    seededUser,
  }) => {
    test.setTimeout(300_000);

    const result = await runMonetizedAppLoop({
      apiUrl: stack.urls.api,
      seededUser,
    });

    // App was created.
    expect(result.appId, "apps.create returns an app id").toBeTruthy();

    // The org started with the seeded 1000 credits.
    expect(result.initialBalance).toBeCloseTo(1000, 2);

    // Domain registered + attached (Cloudflare stub reports success + verified).
    expect(result.domainBuy.json?.success).toBe(true);
    expect(result.domainBuy.json?.verified).toBe(true);

    // Buying the domain debited real credits by exactly the registration price.
    expect(
      result.initialBalance - result.balanceAfterBuy,
      "domain purchase debits the registration price",
    ).toBeCloseTo(DOMAIN_PRICE_USD, 2);

    // Inference-markup earnings were recorded for the app owner.
    expect(result.earningsAvailable).toBeCloseTo(SIMULATED_EARNINGS_USD, 6);

    // Earning agent survives: the daily container bill is paid from earnings.
    expect(result.survivingPlan.action).toBe("billed");
    expect(result.survivingPlan.fromEarnings).toBeGreaterThanOrEqual(
      DAILY_CONTAINER_COST_USD - 1e-9,
    );

    // Broke agent (no earnings, no credits) hits the shutdown path.
    expect(result.brokePlan.action).toBe("insufficient");

    // Earnings were drawn down to fund hosting.
    expect(result.convert.success).toBe(true);
  });
});
