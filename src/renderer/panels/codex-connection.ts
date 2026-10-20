/**
 * The Codex row's connection in Settings → Model Providers: the ChatGPT subscription, or a provider
 * cc-switch manages on this Mac. Which half of the switcher is on, and what a cc-switch connection
 * says about the provider it selected — pure decisions; the row (`ModelsSection.tsx`) renders them.
 *
 * A cc-switch connection is read afresh every check (cc-switch is the control plane, Genex the
 * consumer), so a row's words come from the engine's own status: the reason there is nothing to
 * run, and the remedy beside it, exactly as a failed launch would say it.
 */
import { CodexConnection } from "../../shared/codex-connection.ts";
import {
  type CcswitchInfo,
  type EngineAccount,
  type EngineStatus,
  EngineStatusCode,
} from "../../shared/engine-descriptor.ts";
import { CCSWITCH_WORDS } from "../words.ts";

/** The switcher's halves, in order: the subscription first, cc-switch second. */
export const CONNECTION_ITEMS = [
  { key: CodexConnection.Subscription, label: CCSWITCH_WORDS.subscription, hint: CCSWITCH_WORDS.subscriptionHint },
  { key: CodexConnection.Ccswitch, label: CCSWITCH_WORDS.ccswitch, hint: CCSWITCH_WORDS.ccswitchHint },
] as const;

/** The connection a row is on: cc-switch when the engine says so, the subscription otherwise. */
export function connectionOf(account: EngineAccount | null | undefined): CodexConnection {
  return account?.connection ?? CodexConnection.Subscription;
}

/** What a cc-switch connection's row shows, from nothing selected to a provider with a key. */
export const CcswitchRowState = {
  /** A provider with a key: the row runs on it. */
  Connected: "connected",
  /** cc-switch selected no provider, or the provider has no key. */
  NotConnected: "not_connected",
  /** cc-switch's config could not be read. */
  Unreadable: "unreadable",
} as const;
export type CcswitchRowState = (typeof CcswitchRowState)[keyof typeof CcswitchRowState];

/** Each status of a cc-switch connection as the row's state; any other is one it could not check. */
const CCSWITCH_STATES: Partial<Record<EngineStatusCode, CcswitchRowState>> = {
  [EngineStatusCode.Ready]: CcswitchRowState.Connected,
  [EngineStatusCode.NotRunning]: CcswitchRowState.NotConnected,
  [EngineStatusCode.Error]: CcswitchRowState.Unreadable,
};

/** The row's state from the engine's status. */
export function ccswitchRowState(status: Pick<EngineStatus, "code">): CcswitchRowState {
  return CCSWITCH_STATES[status.code] ?? CcswitchRowState.Unreadable;
}

/** "My relay · api.kytok.xyz": the selected provider, or null before cc-switch's file is read. */
export function ccswitchProviderAt(ccswitch: CcswitchInfo | undefined): string | null {
  return ccswitch ? CCSWITCH_WORDS.providerAt(ccswitch.providerName, ccswitch.host) : null;
}

/**
 * The connected row's line: the selected provider and what bills for it. A provider the file named
 * carries its own name; a relay Genex could not read a provider from still says what bills.
 */
export function ccswitchConnectedLine(ccswitch: CcswitchInfo | undefined): string {
  const provider = ccswitchProviderAt(ccswitch);
  return provider ? `${provider} · ${CCSWITCH_WORDS.billedByProvider}` : CCSWITCH_WORDS.billedByProvider;
}

/**
 * The line of a row with nothing to run: the engine's own reason, and the remedy beside it — the
 * same two sentences a launch that found nothing would report.
 */
export function ccswitchTroubleLine(status: EngineStatus): string {
  return [status.detail, status.remedy].filter(Boolean).join(" ");
}
