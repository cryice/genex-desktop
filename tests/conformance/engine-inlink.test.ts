/**
 * inLink: a metered engine on the studio's own pi-ai loop, its key kept in the secret store.
 *
 * Runs pi-ai against a real local HTTP server (`helpers/fake-inlink.ts`), so the one-token key
 * check, the Bearer header, streaming and the inline `<think>` split are exercised for real.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, describe, it } from "node:test";
import { EngineRegistry } from "../../src/substrate/engines/registry.ts";
import { InLinkEngine, cleanApiKey, inLinkModel, inLinkModels } from "../../src/substrate/engines/inlink.ts";
import { EngineError } from "../../src/substrate/engines/types.ts";
import { memoryKeyStore, type ApiKeyStore } from "../../src/substrate/provider-keys.ts";
import { GOOD_KEY, startFakeInLink, type FakeInLink } from "../helpers/fake-inlink.ts";
import { tmpDir } from "../helpers/tmp.ts";

const MODEL = "deepseek-v4-pro";
/** The gateway's flagship, first in the table, and the one the studio builds on: the row that sees. */
const QWEN = "qwen3.8-max";
const servers: FakeInLink[] = [];
after(async () => {
  await Promise.all(servers.map((server) => server.close()));
});

async function fake(options?: Parameters<typeof startFakeInLink>[0]): Promise<FakeInLink> {
  const server = await startFakeInLink(options);
  servers.push(server);
  return server;
}

async function engineFor(server: FakeInLink, keys: ApiKeyStore = memoryKeyStore(GOOD_KEY)) {
  const root = await tmpDir("inlink-");
  return new InLinkEngine({ root: path.join(root, "engine"), keys, baseUrl: server.baseUrl });
}

describe("inLink", () => {
  it("carries the gateway's models, and keeps a pasted key only when the gateway reads it", async () => {
    assert.deepEqual(
      inLinkModels().map((row) => row.id),
      [QWEN, MODEL],
    );
    assert.equal(inLinkModel(QWEN)?.supportsVision, true, "the flagship sees, so a build gets its screenshots");
    assert.equal(inLinkModel(MODEL)?.supportsVision, false, "and the other states no vision");
    assert.equal(cleanApiKey("short"), null, "a value that cannot be a key is refused before anyone is asked");

    const server = await fake();
    const keys = memoryKeyStore(null);
    const engine = await engineFor(server, keys);
    const missing = await engine.status();
    assert.equal(missing.code, "needs_login");
    assert.match(missing.remedy ?? "", /Settings › Model Providers/);

    assert.equal((await engine.saveKey("inlink-a-key-the-gateway-refuses")).code, "needs_login");
    assert.equal(await keys.read(), null, "a refused key is not kept");
    assert.equal((await engine.saveKey(`  ${GOOD_KEY}\n`)).code, "ready");
    assert.equal(await keys.read(), GOOD_KEY, "kept trimmed");
    assert.equal((await engine.clearKey()).code, "needs_login");

    // The gateway's only endpoint is the chat one, so an error about the model still means it read the key.
    const grumpy = await engineFor(
      await fake({ accepted: { status: 400, body: '{"error":{"message":"no such model"}}' } }),
    );
    assert.equal((await grumpy.saveKey(GOOD_KEY)).code, "ready");
  });

  it("streams a completion with the key as a bearer, and splits the gateway's inline thinking out", async () => {
    const server = await fake({ replies: [{ text: "<think>the person said hi</think>Hello!" }] });
    const engine = await engineFor(server);
    const deltas: string[] = [];
    const response = await engine.complete({
      model: MODEL,
      messages: [{ role: "user", content: "hi" }],
      onDelta: (delta) => deltas.push(delta),
    });
    assert.equal(response.message.content, "Hello!", "the chat shows the answer, not the thought");
    assert.equal(response.message.reasoning, "the person said hi");
    assert.equal(deltas.join(""), "Hello!");
    assert.equal(response.engine, "inlink");
    assert.equal(response.usage.cost_usd, 0, "the gateway quotes no price, so none is claimed");
    const call = server.requests.find((request) => (request.body as { stream?: boolean } | null)?.stream !== false);
    assert.equal(call?.authorization, `Bearer ${GOOD_KEY}`);
    assert.equal((call?.body as { model?: string } | undefined)?.model, MODEL);

    await assert.rejects(engine.complete({ messages: [{ role: "user", content: "x" }] }), /Pick an inLink model/);
    await assert.rejects(
      engine.complete({ model: "gpt-9", messages: [{ role: "user", content: "x" }] }),
      (err) => err instanceof EngineError && err.kind === "unavailable",
    );
  });

  it("reports the gateway's web firewall as the block it is, never as a refused key", async () => {
    // The firewall answers 403 with its own HTML page and no content type, unlike the gateway's JSON.
    const page = "<!DOCTYPE html><html><body>Knownsec CloudWAF: suspected hacking</body></html>";
    const engine = await engineFor(await fake({ accepted: { status: 403, body: page, contentType: null } }));
    const blocked = await engine.saveKey(GOOD_KEY);
    assert.equal(blocked.code, "error", "a blocked check is not a key the gateway refused");
    assert.match(blocked.detail, /firewall/);
    await assert.rejects(
      engine.complete({ model: MODEL, messages: [{ role: "user", content: "<script>x</script>" }] }),
      (err) =>
        err instanceof EngineError &&
        err.kind === "other" &&
        /firewall/.test(err.message) &&
        !/not authorised/.test(err.message),
    );
  });

  it("sends a request the firewall blocked again with a gzipped body, which gets through", async () => {
    const server = await fake({ firewall: true, replies: [{ text: "Built it." }] });
    const engine = await engineFor(server);
    const response = await engine.complete({
      model: MODEL,
      messages: [{ role: "user", content: "<script>alert(1)</script>" }],
    });
    assert.equal(response.message.content, "Built it.");
    const attempts = server.requests.filter((request) => request.path.startsWith("/chat/completions"));
    assert.deepEqual(
      attempts.map((request) => request.encoding),
      [undefined, "gzip"],
      "the plain attempt, then the same request gzipped",
    );
    assert.equal(attempts[1]?.authorization, `Bearer ${GOOD_KEY}`, "the retry keeps the key");
  });

  it("is a metered session engine in the registry, and never a fallback", async () => {
    const registry = new EngineRegistry();
    registry.register(await engineFor(await fake(), memoryKeyStore(null)));
    const [described] = await registry.describe();
    assert.equal(described?.id, "inlink");
    assert.equal(described?.kind, "direct");
    assert.equal(described?.supportsSessions, true);
    assert.equal(described?.status.code, "needs_login");
    assert.equal(described?.provider?.billing, "metered");
    assert.equal(described?.defaultModel, null, "no model is picked for the person");
    assert.deepEqual(await registry.fallbackFor("claude-code", { kind: "rate_limit" }), []);
    assert.equal(await registry.firstReady(), null);
  });
});
