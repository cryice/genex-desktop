/**
 * The Codex row's connection switcher in Settings → Model Providers: which half is on for each
 * account, what a cc-switch connection says about the provider it selected, and what a row with
 * nothing to run reports.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CcswitchRowState,
  ccswitchConnectedLine,
  ccswitchProviderAt,
  ccswitchRowState,
  ccswitchTroubleLine,
  CONNECTION_ITEMS,
  connectionOf,
} from "../../src/renderer/panels/codex-connection.ts";
import { CodexConnection } from "../../src/shared/codex-connection.ts";
import { EngineStatusCode, type EngineStatus } from "../../src/shared/engine-descriptor.ts";
import { CCSWITCH_WORDS } from "../../src/renderer/words.ts";

const RELAY = { providerName: "My relay", host: "relay.example.test", model: "gpt-5-codex" } as const;

describe("the Codex row's connection", () => {
  it("offers the subscription first and cc-switch second, each with its own hint", () => {
    assert.deepEqual(
      CONNECTION_ITEMS.map((item) => item.key),
      [CodexConnection.Subscription, CodexConnection.Ccswitch],
    );
    assert.equal(CONNECTION_ITEMS[0]?.label, CCSWITCH_WORDS.subscription);
    assert.equal(CONNECTION_ITEMS[1]?.label, CCSWITCH_WORDS.ccswitch);
    assert.ok(CONNECTION_ITEMS[0]?.hint && CONNECTION_ITEMS[0].hint.length > 0);
    assert.notEqual(CONNECTION_ITEMS[1]?.hint, CONNECTION_ITEMS[0]?.hint);
  });

  it("is on the subscription until an account says otherwise", () => {
    assert.equal(connectionOf(null), CodexConnection.Subscription);
    assert.equal(connectionOf(undefined), CodexConnection.Subscription);
    assert.equal(
      connectionOf({ source: "isolated", afterSignOut: "signed-out", cli: { state: "ready" } }),
      CodexConnection.Subscription,
      "an engine with one connection says nothing about which one",
    );
    assert.equal(
      connectionOf({ source: "none", afterSignOut: "signed-out", cli: { state: "missing" }, connection: "ccswitch" }),
      CodexConnection.Ccswitch,
    );
  });
});

describe("a cc-switch connection's row", () => {
  it("follows the engine's own status", () => {
    assert.equal(ccswitchRowState({ code: EngineStatusCode.Ready }), CcswitchRowState.Connected);
    assert.equal(ccswitchRowState({ code: EngineStatusCode.NotRunning }), CcswitchRowState.NotConnected);
    assert.equal(ccswitchRowState({ code: EngineStatusCode.Error }), CcswitchRowState.Unreadable);
  });

  it("treats every other status as one it could not check", () => {
    for (const code of [EngineStatusCode.NeedsLogin, EngineStatusCode.NotInstalled] as const)
      assert.equal(ccswitchRowState({ code }), CcswitchRowState.Unreadable, code);
  });

  it("names the selected provider and its relay, or nothing before the file is read", () => {
    assert.equal(ccswitchProviderAt(RELAY), "My relay · relay.example.test");
    assert.equal(ccswitchProviderAt(undefined), null);
  });

  it("says the provider and what bills, even when the provider is unknown", () => {
    assert.equal(ccswitchConnectedLine(RELAY), "My relay · relay.example.test · billed by this provider");
    assert.equal(ccswitchConnectedLine(undefined), CCSWITCH_WORDS.billedByProvider);
  });

  it("reports a launch's own reason and remedy as one line", () => {
    const trouble: EngineStatus = { code: EngineStatusCode.NotRunning, detail: "Broke.", remedy: "Fix it." };
    assert.equal(ccswitchTroubleLine(trouble), "Broke. Fix it.");
    assert.equal(ccswitchTroubleLine({ ...trouble, remedy: undefined }), "Broke.");
    assert.equal(ccswitchTroubleLine({ code: EngineStatusCode.Error, detail: "" }), "");
  });
});
