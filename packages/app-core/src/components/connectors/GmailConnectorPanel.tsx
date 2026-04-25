/**
 * Gmail OAuth connector settings panel.
 *
 * Drives the bring-your-own-client OAuth flow defined in
 * `eliza/packages/agent/src/api/oauth-routes.ts`.
 *
 * Two-step UX:
 *   1. User pastes their Google Cloud OAuth client_id + client_secret.
 *      We persist via `client.saveConnector("gmail", {...})`.
 *   2. User clicks "Connect Gmail" → we call
 *      `client.initiateLocalOauth("gmail")`, receive the consent URL,
 *      open it in a popup, and listen for `milady:oauth:complete`
 *      postMessage from the callback page.
 *
 * After step 2 the milady.json config carries `connectors.gmail.{accessToken,
 * refreshToken, expiresAt, scope, email}` and the n8n credential provider
 * starts returning real credential_data for `gmailOAuth2` nodes.
 *
 * Note on quota: this is BYO client, so all Google API calls from generated
 * workflows count against the user's own Google Cloud project quota.
 */

import { Button, PagePanel } from "@elizaos/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { client } from "../../api";
import { useApp } from "../../state";

interface GmailConnectorState {
  enabled?: boolean;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  email?: string;
}

const REDIRECT_URI_HINT = "http://localhost:31337/api/oauth/gmail/callback";

export function GmailConnectorPanel() {
  const { t } = useApp();

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [credsSaved, setCredsSaved] = useState(false);
  const [oauthEmail, setOauthEmail] = useState<string | null>(null);
  const [oauthScope, setOauthScope] = useState<string | null>(null);
  const [hasRefreshToken, setHasRefreshToken] = useState(false);

  const [savingCreds, setSavingCreds] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { connectors } = await client.getConnectors();
      const gmail =
        (connectors.gmail as GmailConnectorState | undefined) ?? {};
      setClientId(gmail.clientId ?? "");
      setClientSecret(gmail.clientSecret ?? "");
      setCredsSaved(Boolean(gmail.clientId && gmail.clientSecret));
      setOauthEmail(gmail.email ?? null);
      setOauthScope(gmail.scope ?? null);
      setHasRefreshToken(Boolean(gmail.refreshToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  // Listen for the OAuth-complete postMessage from the callback popup.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (
        event.data &&
        typeof event.data === "object" &&
        (event.data as { type?: string }).type === "milady:oauth:complete" &&
        (event.data as { platform?: string }).platform === "gmail"
      ) {
        const status = (event.data as { status?: string }).status;
        if (status === "ok") {
          setNotice("Connected. Refreshing status…");
        } else {
          setError("OAuth flow returned an error. Try again.");
        }
        setConnecting(false);
        void refreshState();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [refreshState]);

  const handleSaveCreds = useCallback(async () => {
    setSavingCreds(true);
    setError(null);
    setNotice(null);
    try {
      await client.saveConnector("gmail", {
        enabled: true,
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      } as Parameters<typeof client.saveConnector>[1]);
      setCredsSaved(true);
      setNotice(
        "Saved. Click Connect Gmail next to run the OAuth consent flow.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingCreds(false);
    }
  }, [clientId, clientSecret]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    setNotice(null);
    try {
      const { authorizeUrl } = await client.initiateLocalOauth("gmail");
      // Open in a popup so the postMessage handler above can listen.
      const popup = window.open(
        authorizeUrl,
        "milady-gmail-oauth",
        "width=560,height=720",
      );
      if (!popup) {
        // Popup blocked — fall back to redirecting in the same window.
        window.location.href = authorizeUrl;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConnecting(false);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    setError(null);
    setNotice(null);
    try {
      // Keep clientId/clientSecret so the user doesn't have to re-paste;
      // wipe just the OAuth-derived tokens. The auto-enable check requires
      // refreshToken so this effectively disables the connector.
      await client.saveConnector("gmail", {
        enabled: false,
        clientId,
        clientSecret,
      } as Parameters<typeof client.saveConnector>[1]);
      setNotice("Disconnected. Re-run Connect Gmail to re-authorize.");
      await refreshState();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDisconnecting(false);
    }
  }, [clientId, clientSecret, refreshState]);

  const status = useMemo(() => {
    if (loading) return "Loading…";
    if (hasRefreshToken && oauthEmail) return `Connected as ${oauthEmail}`;
    if (hasRefreshToken) return "Connected";
    if (credsSaved) return "Credentials saved — click Connect Gmail";
    return "Not configured";
  }, [credsSaved, hasRefreshToken, loading, oauthEmail]);

  const formDisabled = savingCreds || connecting || disconnecting;
  const canSaveCreds =
    clientId.trim().length > 0 && clientSecret.trim().length > 0;
  const canConnect = credsSaved && !connecting;

  return (
    <PagePanel>
      <div className="space-y-4">
        <div>
          <h3 className="font-semibold text-txt">
            {t("connectors.gmail.title", { defaultValue: "Gmail" })}
          </h3>
          <p className="text-muted">
            {t("connectors.gmail.description", {
              defaultValue:
                "Connect a Gmail account so n8n workflows can read and send mail. Uses your own Google Cloud OAuth client.",
            })}
          </p>
          <p className="text-muted">{status}</p>
        </div>

        <div className="space-y-2 rounded-xl border border-border/40 bg-bg/40 p-3 text-xs-tight">
          <div className="font-medium text-txt">
            {t("connectors.gmail.setupHeader", {
              defaultValue: "1. Create a Google Cloud OAuth client",
            })}
          </div>
          <ol className="ml-4 list-decimal space-y-1 text-muted">
            <li>
              Open{" "}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
                className="text-accent underline"
              >
                console.cloud.google.com/apis/credentials
              </a>
            </li>
            <li>
              Enable the Gmail API at{" "}
              <a
                href="https://console.cloud.google.com/apis/library/gmail.googleapis.com"
                target="_blank"
                rel="noreferrer"
                className="text-accent underline"
              >
                console.cloud.google.com/apis/library/gmail.googleapis.com
              </a>
            </li>
            <li>
              <strong>Create credentials → OAuth client ID → Web application</strong>
            </li>
            <li>
              Add this Authorized redirect URI:
              <pre className="mt-1 select-all rounded bg-bg/80 p-2 font-mono text-xs">
                {REDIRECT_URI_HINT}
              </pre>
            </li>
            <li>
              Copy the resulting <strong>Client ID</strong> and{" "}
              <strong>Client secret</strong> into the fields below.
            </li>
          </ol>
        </div>

        <div className="space-y-2">
          <div className="font-medium text-txt">
            {t("connectors.gmail.credsHeader", {
              defaultValue: "2. Paste OAuth client credentials",
            })}
          </div>
          <label className="block space-y-1">
            <span className="text-muted">Client ID</span>
            <input
              type="text"
              className="h-9 w-full rounded-xl border border-border/40 bg-bg px-3 text-sm text-txt"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              disabled={formDisabled}
              placeholder="1234567890-abcdef.apps.googleusercontent.com"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-muted">Client Secret</span>
            <input
              type="password"
              className="h-9 w-full rounded-xl border border-border/40 bg-bg px-3 text-sm text-txt"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              disabled={formDisabled}
              placeholder="GOCSPX-…"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-xl px-4 text-xs-tight font-semibold"
            onClick={() => void handleSaveCreds()}
            disabled={!canSaveCreds || formDisabled}
          >
            {savingCreds ? "Saving…" : "Save credentials"}
          </Button>
          <Button
            variant="default"
            size="sm"
            className="h-8 rounded-xl px-4 text-xs-tight font-semibold"
            onClick={() => void handleConnect()}
            disabled={!canConnect || formDisabled}
          >
            {connecting ? "Opening consent…" : "Connect Gmail"}
          </Button>
          {hasRefreshToken ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-xl px-4 text-xs-tight font-semibold"
              onClick={() => void handleDisconnect()}
              disabled={formDisabled}
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          ) : null}
        </div>

        {oauthScope ? (
          <div className="text-muted text-xs-tight">
            <strong>Granted scopes:</strong> {oauthScope}
          </div>
        ) : null}

        {error ? <div className="text-danger">{error}</div> : null}
        {notice ? <div className="text-ok">{notice}</div> : null}
      </div>
    </PagePanel>
  );
}
