/**
 * How hard a model thinks, from least to most (the composer's effort dial). An engine offers a
 * subset (`EngineDescriptor.models[].efforts`). Persisted in thread metadata: never rename a value.
 */
export const ReasoningEffort = {
  None: "none",
  Minimal: "minimal",
  Low: "low",
  Medium: "medium",
  High: "high",
  Xhigh: "xhigh",
  Max: "max",
  Ultra: "ultra",
} as const;
export type ReasoningEffort = (typeof ReasoningEffort)[keyof typeof ReasoningEffort];

/** Request settings whose capabilities are advertised by the selected provider/model. */
export interface ModelPreferences {
  fast?: boolean;
  /** Optional client-side context budget override, in tokens. */
  contextWindow?: number;
}

/** What a model offers: its context window, and whether it has a Fast mode. */
export interface ModelCapabilities {
  contextWindow?: number;
  supportsFast?: boolean;
}

/** The preferences this model honors. Every provider compacts on its own, so none sets a window. */
export function supportedPreferences(value: ModelPreferences, model: ModelCapabilities): ModelPreferences {
  return {
    ...(model.supportsFast && typeof value.fast === "boolean" ? { fast: value.fast } : {}),
    ...(typeof value.contextWindow === "number" && Number.isInteger(value.contextWindow) && value.contextWindow > 0
      ? { contextWindow: Math.min(value.contextWindow, model.contextWindow ?? value.contextWindow) }
      : {}),
  };
}
