/**
 * Monetized-app autonomous loop — the shared step sequence.
 *
 * Both the cloud-e2e Playwright spec (`tests/monetized-app-loop.spec.ts`) and
 * the standalone smoke script (`scripts/monetized-app-loop-smoke.ts`) drive the
 * exact same loop through this helper, so the behaviour under test lives in one
 * place. The helper performs the steps and returns the raw observations — it
 * makes NO assertions, leaving each caller to assert in its own idiom
 * (Playwright `expect` vs the script's CLI `check`).
 *
 * The loop proves, end to end against a running cloud-api + in-process
 * cloud-shared:
 *   apps.create -> apps.monetization.update -> domains.check -> domains.buy
 *   (real credit debit) -> record inference-markup earnings -> survival-economics
 *   decision (an earning agent pays its daily container bill from earnings; a
 *   broke agent hits the shutdown path).
 *
 * Direct `redeemableEarningsService` / `computeContainerBillingPlan` calls run
 * in-process, so the caller must have `DATABASE_URL` pointing at the running
 * PGlite bridge (the stack fixture sets this) before invoking.
 */

import { computeContainerBillingPlan } from "@elizaos/cloud-shared/lib/services/container-billing-policy";
import { redeemableEarningsService } from "@elizaos/cloud-shared/lib/services/redeemable-earnings";
import type { SeededUser } from "../fixtures/seed";

/** Daily container hosting cost the survival policy bills against (USD). */
export const DAILY_CONTAINER_COST_USD = 0.67;
/** Simulated inference-markup earnings recorded for the app owner (USD). */
export const SIMULATED_EARNINGS_USD = 5;

export interface ApiResponse {
  status: number;
  json: any;
}

/** Per-request ceiling once the worker is warm (responses return in ms). */
const REQUEST_TIMEOUT_MS = 60_000;
/**
 * Budget for the very first real (non-health) request. It triggers the worker's
 * lazy bootstrap (createApp + the full route tree); under wrangler/workerd the
 * first fetch also bundles the worker, which can take tens of seconds cold.
 * Every later request is warm.
 */
const COLD_START_TIMEOUT_MS = 180_000;

export interface MonetizedAppLoopInput {
  apiUrl: string;
  seededUser: Pick<SeededUser, "userId" | "organizationId" | "apiKey">;
  /** Unique suffix for app / domain names. Defaults to a time-based token. */
  nonce?: string;
}

export interface MonetizedAppLoopResult {
  healthStatus: number;
  initialBalance: number;
  appId: string;
  domain: string;
  created: ApiResponse;
  monetization: ApiResponse;
  domainCheck: ApiResponse;
  domainBuy: ApiResponse;
  balanceAfterBuy: number;
  earningsAvailable: number;
  /** Survival plan for an earning agent with zero org credits. */
  survivingPlan: ReturnType<typeof computeContainerBillingPlan>;
  /** Survival plan for a broke agent (no earnings, no credits). */
  brokePlan: ReturnType<typeof computeContainerBillingPlan>;
  convert: Awaited<
    ReturnType<typeof redeemableEarningsService.convertToCredits>
  >;
}

async function call(
  apiUrl: string,
  method: string,
  path: string,
  apiKey: string,
  body?: unknown,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<ApiResponse> {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-API-Key": apiKey,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = text.slice(0, 400);
  }
  return { status: res.status, json };
}

/**
 * Run the monetized-app loop and return the raw observations. Throws only on
 * an unrecoverable step (e.g. `apps.create` returns no id); all other outcomes
 * are reported in the result for the caller to assert on.
 */
export async function runMonetizedAppLoop(
  input: MonetizedAppLoopInput,
  onStep?: (step: string, data: unknown) => void,
): Promise<MonetizedAppLoopResult> {
  const { apiUrl, seededUser } = input;
  const key = seededUser.apiKey;
  const nonce = input.nonce ?? Date.now().toString(36);
  const step = (label: string, data: unknown) => onStep?.(label, data);

  const healthStatus = await fetch(`${apiUrl}/api/health`).then(
    (r) => r.status,
  );
  step("health", { status: healthStatus });

  // First real request — absorbs the one-time cold start (see COLD_START_*).
  const initial = await call(
    apiUrl,
    "GET",
    "/api/v1/credits/balance",
    key,
    undefined,
    COLD_START_TIMEOUT_MS,
  );
  step("credits.balance", initial);
  const initialBalance = Number(initial.json?.balance);

  // 1. Create the app.
  const created = await call(apiUrl, "POST", "/api/v1/apps", key, {
    name: `Loop App ${nonce}`,
    app_url: "https://placeholder.invalid",
    skipGitHubRepo: true,
  });
  step("apps.create", created);
  const appId = created.json?.app?.id ?? created.json?.id;
  if (!appId) {
    throw new Error(
      `apps.create returned no id (status ${created.status}): ${JSON.stringify(created.json).slice(0, 300)}`,
    );
  }

  // 2. Enable monetization (inference markup + purchase share).
  const monetization = await call(
    apiUrl,
    "PUT",
    `/api/v1/apps/${appId}/monetization`,
    key,
    {
      monetizationEnabled: true,
      inferenceMarkupPercentage: 100,
      purchaseSharePercentage: 10,
    },
  );
  step("apps.monetization.update", monetization);

  // 3. Buy a custom domain (Cloudflare stub) — debits real credits.
  const domain = `loop-${nonce}.com`;
  const domainCheck = await call(
    apiUrl,
    "POST",
    `/api/v1/apps/${appId}/domains/check`,
    key,
    { domain },
  );
  step("domains.check", domainCheck);
  const domainBuy = await call(
    apiUrl,
    "POST",
    `/api/v1/apps/${appId}/domains/buy`,
    key,
    { domain },
  );
  step("domains.buy", domainBuy);

  const afterBuy = await call(apiUrl, "GET", "/api/v1/credits/balance", key);
  step("credits.balance (after buy)", afterBuy);
  const balanceAfterBuy = Number(afterBuy.json?.balance);

  // 4. Record inference-markup earnings for the app owner.
  const earn = await redeemableEarningsService.addEarnings({
    userId: seededUser.userId,
    amount: SIMULATED_EARNINGS_USD,
    source: "app_owner_revenue_share",
    sourceId: appId,
    description: "simulated inference markup",
  });
  step("addEarnings", earn);
  const balance = await redeemableEarningsService.getBalance(seededUser.userId);
  step("earnings.getBalance", balance);
  const earningsAvailable = balance?.availableBalance ?? 0;

  // 5. Survival economics: the exact pure policy the container-billing cron
  //    uses. With earnings and ZERO org credits the bill is paid from earnings
  //    (agent stays alive); with neither it returns "insufficient" (shutdown).
  const survivingPlan = computeContainerBillingPlan({
    dailyCost: DAILY_CONTAINER_COST_USD,
    currentBalance: 0,
    ownerEarningsAvailable: earningsAvailable,
    payAsYouGoFromEarnings: true,
  });
  step("billing plan (earnings, 0 credits)", survivingPlan);
  const brokePlan = computeContainerBillingPlan({
    dailyCost: DAILY_CONTAINER_COST_USD,
    currentBalance: 0,
    ownerEarningsAvailable: 0,
    payAsYouGoFromEarnings: true,
  });
  step("billing plan (no earnings, no credits)", brokePlan);

  const convert = await redeemableEarningsService.convertToCredits({
    userId: seededUser.userId,
    amount: DAILY_CONTAINER_COST_USD,
    organizationId: seededUser.organizationId,
    description: "survival: fund container hosting from earnings",
  });
  step("convertToCredits (daily cost)", convert);

  return {
    healthStatus,
    initialBalance,
    appId,
    domain,
    created,
    monetization,
    domainCheck,
    domainBuy,
    balanceAfterBuy,
    earningsAvailable,
    survivingPlan,
    brokePlan,
    convert,
  };
}
