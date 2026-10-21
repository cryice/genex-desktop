/**
 * DeepSeek: a metered API engine on the studio's own pi-ai loop, its key kept in the secret store.
 *
 * Runs pi-ai against a real local HTTP server (`helpers/fake-deepseek.ts`), so the catalog read,
 * the key check, the bearer header, streaming and the failure mapping are exercised for real.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, describe, it } from "node:test";
import { EngineRegistry } from "../../src/substrate/engines/registry.ts";
import { DEEPSEEK_FLASH, DeepSeekEngine, deepSeekModels } from "../../src/substrate/engines/deepseek.ts";
import { EngineError } from "../../src/substrate/engines/types.ts";
import { memoryKeyStore, type ApiKeyStore } from "../../src/substrate/provider-keys.ts";
import { GOOD_KEY, MODELS, startFakeDeepSeek, type FakeDeepSeek } from "../helpers/fake-deepseek.ts";
import { tmpDir } from "../helpers/tmp.ts";

const servers: FakeDeepSeek[] = [];
after(async () => {
  await Promise.all(servers.map((server) => server.close()));
});

async function fake(options?: Parameters<typeof startFakeDeepSeek>[0]): Promise<FakeDeepSeek> {
  const server = await startFakeDeepSeek(options);
  servers.push(server);
  return server;
}

async function engineFor(server: FakeDeepSeek, keys: ApiKeyStore = memoryKeyStore(GOOD_KEY)) {
  const root = await tmpDir("deepseek-");
  return new DeepSeekEngine({ root: path.join(root, "engine"), keys, baseUrl: server.baseUrl });
}

const PRO = "deepseek-v4-pro";

describe("DeepSeek", () => {
  it("lists what DeepSeek lists, with each model's context, reply cap, vision and thinking dial", () => {
    const rows = deepSeekModels({ data: MODELS });
    assert.deepEqual(
      rows.map((row) => row.id),
      [DEEPSEEK_FLASH, PRO],
    );
    const [flash, pro] = rows;
    assert.equal(flash?.label, "DeepSeek-V4.1-Flash");
    assert.equal(flash?.contextWindow, 1_000_000);
    assert.equal(flash?.maxTokens, 32_768, "the reply cap is the studio's, under the model's own 384K");
    assert.equal(flash?.supportsVision, true, "the Flash model reads images");
    assert.equal(flash?.supportsThinking, true);
    assert.deepEqual(flash?.efforts, ["low", "high", "max"]);
    assert.equal(flash?.defaultEffort, "high", "thinking is on and effort defaults to high");
    assert.equal(flash?.note, "¥1–2 in / ¥4–8 out per M tokens");
    assert.equal(pro?.label, "DeepSeek-V4-Pro-0813");
    assert.equal(pro?.supportsVision, false, "the pro model takes text alone");
  });

  it("refuses a list that is not one, and skips entries it cannot use", () => {
    for (const body of [null, {}, { data: "x" }, "[]"])
      assert.throws(() => deepSeekModels(body), /could not be read/, JSON.stringify(body));
    const rows = deepSeekModels({
      data: [null, 7, { id: 3 }, { id: "quiet", output_modalities: ["text"] }, MODELS[0]],
    });
    assert.deepEqual(
      rows.map((row) => row.id),
      ["quiet", DEEPSEEK_FLASH],
      "a listing that names no output is taken as text",
    );
  });

  it("reads the list from DeepSeek with the saved key, and keeps a key only when DeepSeek takes it", async () => {
    const server = await fake();
    const keys = memoryKeyStore(null);
    const engine = await engineFor(server, keys);
    assert.equal((await engine.status()).code, "needs_login", "no key is saved yet");
    assert.equal((await engine.saveKey("sk-deepseek-wrong-key-000000000000000")).code, "needs_login");
    assert.equal(await keys.read(), null, "a refused key is not kept");
    assert.equal((await engine.saveKey(`  ${GOOD_KEY}\n`)).code, "ready");
    assert.equal(await keys.read(), GOOD_KEY, "kept trimmed");

    await engine.refreshModels(true);
    assert.deepEqual(
      (await engine.models()).map((row) => row.id),
      [DEEPSEEK_FLASH, PRO],
    );
    const reads = server.requests.filter((request) => request.path === "/models" && request.authorization);
    assert.equal(reads.at(-1)?.authorization, `Bearer ${GOOD_KEY}`, "the list is read with the key");

    assert.equal((await engine.clearKey()).code, "needs_login");
    assert.deepEqual(await engine.models(), [], "and a signed-out engine lists nothing");
  });

  it("streams a completion with the key as a bearer, and refuses a model DeepSeek does not offer", async () => {
    const server = await fake({ replies: [{ text: "Hello from DeepSeek" }] });
    const engine = await engineFor(server);
    await engine.refreshModels(true);
    const response = await engine.complete({ model: DEEPSEEK_FLASH, messages: [{ role: "user", content: "hi" }] });
    assert.equal(response.message.content, "Hello from DeepSeek");
    assert.equal(response.engine, "deepseek");
    assert.equal(response.usage.cost_usd, 0, "DeepSeek quotes CNY, so no dollar cost is claimed");
    const call = server.requests.find((request) => request.path === "/chat/completions");
    assert.equal(call?.authorization, `Bearer ${GOOD_KEY}`);
    assert.equal((call?.body as { model?: string } | undefined)?.model, DEEPSEEK_FLASH);
    await assert.rejects(engine.complete({ messages: [{ role: "user", content: "x" }] }), /Pick a DeepSeek model/);
    await assert.rejects(
      engine.complete({ model: "deepseek-v4-flash", messages: [{ role: "user", content: "x" }] }),
      (err) => err instanceof EngineError && err.kind === "unavailable",
      "a name DeepSeek no longer lists is refused",
    );
  });

  it("is a metered session engine in the registry, and never a fallback", async () => {
    const registry = new EngineRegistry();
    registry.register(await engineFor(await fake(), memoryKeyStore(null)));
    const [described] = await registry.describe();
    assert.equal(described?.id, "deepseek");
    assert.equal(described?.kind, "direct");
    assert.equal(described?.supportsSessions, true);
    assert.equal(described?.status.code, "needs_login");
    assert.equal(described?.provider?.billing, "metered");
    assert.equal(described?.defaultModel, null, "no model is picked for the person");
    assert.deepEqual(await registry.fallbackFor("claude-code", { kind: "rate_limit" }), []);
    assert.equal(await registry.firstReady(), null);
  });
});
