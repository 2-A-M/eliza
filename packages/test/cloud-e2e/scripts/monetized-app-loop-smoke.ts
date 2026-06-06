/**
 * Monetized-app loop smoke test (standalone).
 *
 * Proves the autonomous monetized-app loop end to end on the local mock:
 *   seed org (1000 credits) → apps.create → apps.monetization.update →
 *   domains.check → domains.buy (Cloudflare stub, real credit debit) →
 *   record inference-markup earnings → survival-economics decision
 *   (computeContainerBillingPlan: earnings pay the daily container bill, so an
 *   earning agent stays alive; a broke agent hits the shutdown path).
 *
 * The loop steps live in `../src/helpers/monetized-app-loop` so the cloud-e2e
 * Playwright spec (`tests/monetized-app-loop.spec.ts`) and this script exercise
 * the exact same behaviour; this script only adds CLI ergonomics + assertions.
 *
 * Two modes:
 *
 *   # self-booting (default) — boots an API-only mock stack, runs, tears down
 *   NODE_ENV=test ELIZA_KMS_BACKEND=memory \
 *   bun run packages/test/cloud-e2e/scripts/monetized-app-loop-smoke.ts
 *
 *   # against an already-running stack — set API_BASE + DATABASE_URL yourself
 *   #   terminal 1: CLOUD_E2E=1 NODE_ENV=test bun run cloud:mock --no-frontend --reset
 *   #   terminal 2:
 *   API_BASE=http://127.0.0.1:<apiPort> \
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:<pglitePort>/postgres \
 *   NODE_ENV=test ELIZA_KMS_BACKEND=memory \
 *   bun run packages/test/cloud-e2e/scripts/monetized-app-loop-smoke.ts
 *
 * Exits non-zero if any assertion fails.
 */

import { seedTestUser } from "../src/fixtures/seed";
import { type StackHandle, startCloudStack } from "../src/fixtures/stack";
import {
  DAILY_CONTAINER_COST_USD,
  runMonetizedAppLoop,
  SIMULATED_EARNINGS_USD,
} from "../src/helpers/monetized-app-loop";

// Pin test defaults before cloud-shared crypto is first *used* (KMS resolves
// its backend lazily at `seedTestUser` time, not at import time) so the
// in-memory KMS is used and `seedTestUser` doesn't fall through to `steward`.
process.env.NODE_ENV ??= "test";
process.env.ELIZA_KMS_BACKEND ??= "memory";

// Custom-domain registration price (Cloudflare registrar / e2e stub), in USD.
const DOMAIN_PRICE_USD = 14.95;
const EXTERNAL_API = process.env.API_BASE;

const failures: string[] = [];
function check(label: string, cond: boolean): void {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}`);
  if (!cond) failures.push(label);
}

function log(step: string, data: unknown): void {
  console.log(`\n=== ${step} ===`);
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

async function main(): Promise<void> {
  let stack: StackHandle | undefined;
  let apiUrl = EXTERNAL_API;

  if (!apiUrl) {
    log(
      "boot",
      "no API_BASE set — booting an API-only mock stack (frontend: false)",
    );
    stack = await startCloudStack({ frontend: false });
    apiUrl = stack.urls.api;
    log("boot", { api: apiUrl, pglite: stack.urls.pglite });
  }

  try {
    // Seed an org (1000 credits) + API key directly in the DB.
    const seeded = await seedTestUser({
      slug: `loop-${Date.now().toString(36)}`,
    });
    log("seedTestUser", {
      organizationId: seeded.organizationId,
      apiKeyPrefix: `${seeded.apiKey.slice(0, 12)}…`,
    });

    const result = await runMonetizedAppLoop(
      { apiUrl, seededUser: seeded },
      log,
    );

    console.log("\n=== ASSERTIONS ===");
    check("app created", Boolean(result.appId));
    check(
      "started with 1000 credits",
      Math.abs(result.initialBalance - 1000) < 0.01,
    );
    check(
      "domain registered + attached",
      result.domainBuy.json?.success === true &&
        result.domainBuy.json?.verified === true,
    );
    check(
      `domain debited (~$${DOMAIN_PRICE_USD})`,
      Math.abs(
        result.initialBalance - result.balanceAfterBuy - DOMAIN_PRICE_USD,
      ) < 0.01,
    );
    check(
      "earnings recorded ($5 available)",
      Math.abs(result.earningsAvailable - SIMULATED_EARNINGS_USD) < 1e-6,
    );
    check(
      "earning agent survives: daily bill paid from earnings",
      result.survivingPlan.action === "billed" &&
        result.survivingPlan.fromEarnings >= DAILY_CONTAINER_COST_USD - 1e-9,
    );
    check(
      "broke agent flagged insufficient (shutdown path)",
      result.brokePlan.action === "insufficient",
    );
    check("earnings drawn down for hosting", result.convert.success === true);

    console.log(
      `\n=== ${failures.length === 0 ? "ALL PASS" : `FAILED (${failures.length})`} ===`,
    );
    log("DONE", {
      appId: result.appId,
      domain: result.domain,
      organizationId: seeded.organizationId,
      balanceAfterBuy: result.balanceAfterBuy,
    });
    if (failures.length > 0) process.exitCode = 1;
  } finally {
    if (stack) await stack.stop().catch(() => undefined);
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error("monetized-app-loop-smoke error:", err);
    process.exit(1);
  },
);
