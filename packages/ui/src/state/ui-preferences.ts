export type UiTheme = "light" | "dark";

/**
 * User-selectable theme mode. `system` follows the OS `prefers-color-scheme`
 * and resolves to a concrete {@link UiTheme} at apply time. This is the
 * default for new users.
 */
export type UiThemeMode = "light" | "dark" | "system";

export type UiShellMode = "companion" | "native";

/**
 * Reasoning effort for a chat turn. `none` keeps the historical behaviour
 * (thinking suppressed, default model tier); higher levels turn on extended
 * thinking and raise the model tier server-side, and pass a model/directive
 * hint to coding sub-agents. Mirrors the effort control in Claude Code.
 */
export type ChatEffort = "none" | "low" | "medium" | "high";
