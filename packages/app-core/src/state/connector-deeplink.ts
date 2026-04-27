/**
 * Connector deep-link bus.
 *
 * Lets any caller ask SettingsView to scroll a specific connector panel into
 * view. Used by:
 *   - AutomationsView's missing-credentials banner ("Connect Gmail →" button)
 *   - The `milady://settings/connectors/<provider>` external URL handler
 *     in apps/app/src/main.tsx
 *
 * Consumer side: SettingsView listens for SETTINGS_FOCUS_CONNECTOR_EVENT and
 * scrolls/highlights the matching `[data-connector="<provider>"]` element.
 *
 * The credType↔provider↔label mapping lives in `@elizaos/agent`'s
 * `connector-cred-types` module — single source of truth shared with the
 * server-side disconnect-purge path.
 */

export { providerFromCredType, prettyCredName } from "@elizaos/agent";

export const SETTINGS_FOCUS_CONNECTOR_EVENT = "milady:settings:focus-connector";

export interface SettingsFocusConnectorDetail {
  /** Canonical provider id matching `data-connector="..."` on a panel wrapper. */
  provider: string;
}

export function dispatchFocusConnector(provider: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SettingsFocusConnectorDetail>(
      SETTINGS_FOCUS_CONNECTOR_EVENT,
      { detail: { provider } },
    ),
  );
}
