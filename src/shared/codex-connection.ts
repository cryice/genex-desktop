/**
 * How the Codex row connects. The person's ChatGPT subscription (the CLI's own login, mirrored
 * by the engine) or a provider cc-switch manages on this Mac: cc-switch rewrites
 * `~/.codex/config.toml` and Genex reads it at launch, injecting the selected provider as CLI
 * overrides and its key into the child's environment. Wire values: never rename one.
 */
export const CodexConnection = {
  Subscription: "subscription",
  Ccswitch: "ccswitch",
} as const;
export type CodexConnection = (typeof CodexConnection)[keyof typeof CodexConnection];
