/**
 * What a build sells in its game's Genex store (loop/store-items.ts): the launch names each thing the
 * user prices in Nex, the harness lists each one with `genex__cli shop add` before the build starts,
 * so its card is in the chat at once, and every agent that reads the goal reads them as sold, never
 * as cut. A fishing game "with a fishing rod for nex" once launched with "Nex payments" in its cut
 * list, and its two-hour build never listed the rod.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setImmediate } from "node:timers/promises";
import {
  DEFAULT_ITEM_PRICE,
  GenexStoreCall,
  listStoreItems,
  notListedWords,
  STORE_ITEMS_MAX,
  storeItemsOf,
  StoreItemType,
  storeScopeItems,
} from "../../src/harness-seed/loop/store-items.ts";
import { createScope, restoreScope } from "../../src/harness-seed/loop/scope.ts";
import { scopeLines } from "../../src/harness-seed/loop/scope-prompts.ts";
import { launchFromIntake } from "../../src/harness-seed/loop/chat-dispatch.ts";
import { HostMethod } from "../../src/harness-seed/loop/host-methods.ts";
import { argumentProblems } from "../../src/harness-seed/tools/index.ts";
import { tools as gameTools } from "../../src/harness-seed/tools/game-tools.ts";

const ASK = "create fisher game with fishing rod for nex";
const ROD = {
  name: "Fishing Rod",
  price: 300,
  type: StoreItemType.Durable,
  description: "A carbon rod that casts twice as far.",
};

describe("a launch names what the user sells for Nex", () => {
  for (const name of ["start_autopilot", "start_unattended_run"]) {
    it(`${name} carries store_items onto its run, as a list or as JSON text`, async () => {
      const tool = gameTools.find((t) => t.name === name);
      assert.ok(tool);
      const ctx = { autopilot: { hours: 1 }, loop: { hours: 1 }, engine: "vendor" };
      for (const store_items of [[ROD], JSON.stringify([ROD])]) {
        const args = { goal: ASK, direction: "cozy lake", store_items };
        assert.deepEqual(argumentProblems(tool.parameters as never, args), [], "the launch is not refused");
        const result = (await tool.execute(args, ctx as never)) as { details?: { run?: Record<string, unknown> } };
        assert.deepEqual(result.details?.run?.storeItems, [ROD]);
      }
    });
  }

  it("gives an item the user priced no price the store's first step, and keeps each name once", () => {
    assert.deepEqual(
      storeItemsOf([{ name: "Rod" }, { name: "rod", price: 800 }, { name: "Bait", price: "300" }, { price: 5 }, "Net"]),
      [
        { name: "Rod", price: DEFAULT_ITEM_PRICE, type: "durable" },
        { name: "Bait", price: 300, type: "durable" },
      ],
    );
    assert.deepEqual(
      storeItemsOf([
        { name: "Hat", price: -3 },
        { name: "Cap", price: 2.5 },
      ]),
      [
        { name: "Hat", price: DEFAULT_ITEM_PRICE, type: "durable" },
        { name: "Cap", price: DEFAULT_ITEM_PRICE, type: "durable" },
      ],
    );
    const many = Array.from({ length: STORE_ITEMS_MAX + 3 }, (_, i) => ({ name: `Skin ${i}`, price: 100 }));
    assert.equal(storeItemsOf(many).length, STORE_ITEMS_MAX);
    for (const nothing of [undefined, null, "", "not json", "{}", 7, {}]) assert.deepEqual(storeItemsOf(nothing), []);
  });

  it("keeps a thing bought once by default; only one named consumable is used up", () => {
    const named = [{ name: "Rogue" }, { name: "Potion", type: "consumable" }, { name: "Wings", type: "rig" }];
    assert.deepEqual(
      storeItemsOf(named).map((item) => item.type),
      ["durable", "consumable", "durable"],
    );
  });

  it("takes the store grid's price nearest the one the user named, never Free for a paid one", () => {
    const priced = (price: number) => storeItemsOf([{ name: "Thing", price }])[0]?.price;
    assert.deepEqual(
      [10, 50, 100, 250, 500, 1000, 3000, 999999, 0].map(priced),
      [100, 100, 100, 300, 800, 1200, 5000, 50000, 0],
    );
  });

  it("names nothing when the launch names no store items", async () => {
    const tool = gameTools.find((t) => t.name === "start_autopilot");
    assert.ok(tool);
    const ctx = { autopilot: { hours: 1 }, engine: "vendor" };
    const result = (await tool.execute({ goal: "a game with an in-game shop", direction: "d" }, ctx as never)) as {
      details?: { run?: Record<string, unknown> };
    };
    assert.equal(result.details?.run?.storeItems, undefined);
  });
});

/** A host that answers `plugins.invoke` with `answer` for each call, recording every call in order. */
function storeHost(answer: (args: Record<string, unknown>) => unknown) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const host = {
    call: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method !== HostMethod.PluginsInvoke) return null;
      const result = answer(params.args as Record<string, unknown>);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { host, calls };
}

const LOCAL = (args: Record<string, unknown>) => ({
  command: "shop add",
  ok: true,
  output: { kind: "genex.item_draft", state: "local", localId: `local_${String(args.args).length}abcdefghijk` },
});

describe("listing the items before the build", () => {
  it("lists each item in the game's chat as genex__cli shop add, one after another, and keeps its id", async () => {
    const { host, calls } = storeHost(LOCAL);
    const listed = await listStoreItems(host, { project: "fishing-rod", threadId: "t-1" }, [
      ROD,
      { name: "Golden Bait", price: 100, type: "durable" },
    ]);
    assert.deepEqual(
      calls.map((call) => call.params),
      [
        {
          project: "fishing-rod",
          threadId: "t-1",
          name: GenexStoreCall.Tool,
          args: {
            command: "shop add",
            args: "Fishing Rod",
            options: { price: 300, type: "durable", description: ROD.description },
          },
        },
        {
          project: "fishing-rod",
          threadId: "t-1",
          name: GenexStoreCall.Tool,
          args: { command: "shop add", args: "Golden Bait", options: { price: 100, type: "durable" } },
        },
      ],
    );
    assert.deepEqual(
      listed.map((item) => item.id),
      ["local_11abcdefghijk", "local_11abcdefghijk"],
    );
    assert.deepEqual(storeScopeItems(listed), [
      "Fishing Rod for 300 Nex (listed: local_11abcdefghijk)",
      "Golden Bait for 100 Nex (listed: local_11abcdefghijk)",
    ]);
    assert.equal(notListedWords(listed), "");
  });

  it("keeps why an item was not listed, lists the rest, and never throws", async () => {
    const { host } = storeHost((args) =>
      args.args === "Fishing Rod"
        ? new Error("Genex is locked: ask the user to unlock Genex in Studio's Plugins page, then try again.")
        : { command: "shop add", ok: true, output: { kind: "genex.item_draft", id: "sku_bait" } },
    );
    const listed = await listStoreItems(host, { project: "fishing-rod", threadId: "t-1" }, [
      ROD,
      { name: "Golden Bait", price: 100, type: "durable" },
    ]);
    assert.equal(listed[0]?.id, undefined);
    assert.match(listed[0]?.problem ?? "", /Genex is locked/);
    assert.equal(listed[1]?.id, "sku_bait");
    assert.match(storeScopeItems(listed)[0] ?? "", /^Fishing Rod for 300 Nex \(not listed yet: Genex is locked/);
    assert.match(notListedWords(listed), /Fishing Rod \(Genex is locked.*genex__cli shop add/);

    const failed = await listStoreItems(
      storeHost(() => ({ command: "shop add", ok: false, output: "price: must be a whole number" })).host,
      { project: "fishing-rod", threadId: "t-1" },
      [ROD],
    );
    assert.equal(failed[0]?.problem, "price: must be a whole number");
  });
});

describe("the store items as every agent reads the goal", () => {
  it("are sold in this build whatever the cut list says, each with its id", () => {
    const scope = createScope({
      asked: [ASK],
      inScope: ["cast, hook, reel and catch"],
      cut: ["Nex payments"],
      store: ["Fishing Rod for 300 Nex (listed: local_abcdefghijkl)"],
    });
    const lines = scopeLines({ scope });
    assert.match(lines, /GENEX STORE.*Fishing Rod for 300 Nex \(listed: local_abcdefghijkl\)/);
    assert.match(lines, /buy\(\).*getEntitlements\(\)|getEntitlements\(\).*buy\(\)/);
    assert.match(lines, /picture.*shop set/, "each item gets its picture");
    assert.deepEqual(restoreScope(JSON.parse(JSON.stringify(scope)))?.store, scope.store, "a journal keeps them");
  });

  it("leave a scope without store items as it was", () => {
    const scope = createScope({ asked: [ASK], inScope: ["fishing"], cut: [] });
    assert.equal("store" in scope, false);
    assert.doesNotMatch(scopeLines({ scope }), /GENEX STORE/);
  });
});

describe("a Loop launch with store items", () => {
  it("lists them in the chat before it promises the build, and its run's scope carries them", async () => {
    const order: string[] = [];
    // The run handleRunStart reserves, as the chat launched it.
    const reserved: Array<{ scope?: { store?: string[] } }> = [];
    class Reservations extends Map<string, { run: { scope?: { store?: string[] } } }> {
      override set(key: string, value: { run: { scope?: { store?: string[] } } }) {
        reserved.push(value.run);
        return super.set(key, value);
      }
    }
    const host = {
      workspace: "/nowhere",
      notify: () => {},
      heartbeat: () => {},
      call: async (method: string, params: Record<string, unknown>) => {
        if (method === HostMethod.GameList) return [{ name: "fishing-rod" }];
        if (method === HostMethod.GameValidate) return { contract: "loaded", problems: [] };
        if (method === HostMethod.PluginsInvoke) {
          order.push(`listed ${String((params.args as Record<string, unknown>).args)}`);
          return LOCAL(params.args as Record<string, unknown>);
        }
        if (method === HostMethod.EventsAppend) order.push("chat");
        return null;
      },
    };
    const ctx = { ...host, threadId: "t-1", cancelled: false, setStatus: () => {} };
    const studio = {
      host,
      cancels: new Set<string>(),
      moodBoards: new Map(),
      activeRuns: new Map(),
      startingRuns: new Reservations(),
      orphanRuns: new Map(),
      scoped: () => ctx,
    };
    const spec = { goal: ASK, storeItems: [ROD], reference: { name: "cozy lake", shots: [] } };
    await launchFromIntake(
      studio as never,
      ctx as never,
      { threadId: "t-1", project: "fishing-rod", text: ASK } as never,
      spec,
    );
    assert.deepEqual(order.slice(0, 2), ["listed Fishing Rod", "chat"], "listed before the chat's promise");
    await setImmediate();
    assert.deepEqual(reserved[0]?.scope?.store, ["Fishing Rod for 300 Nex (listed: local_11abcdefghijk)"]);
  });
});
