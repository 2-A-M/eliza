/**
 * Local OAuth client methods — drives the loopback OAuth flows for
 * connector platforms that don't fit the bot-token paste pattern (Gmail
 * via Google OAuth 2; Slack OAuth v2 follows next).
 *
 * Backend routes live at `/api/oauth/<platform>/{initiate,callback}` in
 * `eliza/packages/agent/src/api/oauth-routes.ts`. The callback writes
 * tokens directly to `~/.milady/milady.json` so subsequent
 * `MiladyN8nCredentialProvider.resolve()` calls return real
 * `credential_data` for Gmail nodes.
 */

import { ElizaClient } from "./client-base";

export interface OAuthInitiateResponse {
  /** Full Google/Slack consent URL the user should be redirected to. */
  authorizeUrl: string;
  /** Loopback callback URL that the user must register in Google/Slack. */
  redirectUri: string;
}

declare module "./client-base" {
  interface ElizaClient {
    initiateLocalOauth(
      platform: "gmail" | "slack",
    ): Promise<OAuthInitiateResponse>;
  }
}

ElizaClient.prototype.initiateLocalOauth = async function (
  this: ElizaClient,
  platform,
): Promise<OAuthInitiateResponse> {
  return this.fetch<OAuthInitiateResponse>(
    `/api/oauth/${platform}/initiate`,
    {
      method: "POST",
    },
  );
};
