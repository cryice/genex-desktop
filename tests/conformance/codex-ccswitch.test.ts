import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import {
  CcswitchAbsence,
  PROVIDER_KEY_ENV,
  ccswitchConnectionSettings,
  ccswitchLaunchEnv,
  ccswitchModels,
  ccswitchProviderArgs,
  readCcswitchConfig,
  type CcswitchProvider,
} from "../../src/substrate/engines/codex-ccswitch.ts";
import { CodexConnection } from "../../src/shared/codex-connection.ts";
import { tmpDir } from "../helpers/tmp.ts";

/**
 * cc-switch conformance — the config cc-switch writes, read the way the engine will read it.
 *
 * cc-switch (farion1231/cc-switch) manages Codex providers by rewriting
 * `~/.codex/config.toml`: a top-level `model_provider` naming one `[model_providers.<id>]`
 * table, plus the key — inline (`experimental_bearer_token`), through `env_key`, in
 * `auth.json`'s `OPENAI_API_KEY`, or in a header. Genex is the consumer of that file: it
 * never writes it, it re-reads it on every "Check again", and anything it cannot read
 * cleanly is "nothing to run", never a guess. The `codex` CLI itself is not exercised
 * here — what is asserted is *our* half: what we extract, what we refuse, and the argv
 * and environment the launch gets.
 */

/** The shape cc-switch leaves on this Mac: the provider tables beside everything else Codex keeps. */
const REAL_SHAPE = `model_provider = "custom"
model = "gpt-6-astra"
model_reasoning_effort = "low"

notify = [ "C:\\\\Users\\\\chenm\\\\AppData\\\\Local\\\\OpenAI\\\\Codex\\\\runtimes\\\\cua_node\\\\78fb63cda1a9e2b2\\\\bin\\\\codex-computer-use.exe", "turn-ended" ]
[model_providers.custom]
name = "My Codex"
base_url = "https://relay.example.test/v1"
wire_api = "responses"
requires_openai_auth = true

[mcp_servers]

[mcp_servers.blender]
type = "stdio"
command = "nvx"
args = ["blender-mcp"]

[mcp_servers.node_repl]
args = []
command = 'C:\\Users\\chenm\\AppData\\Local\\OpenAI\\Codex\\runtimes\\cua_node\\78fb63cda1a9e2b2\\bin\\node_repl.exe'
env_vars = ["CODEX_WINDOWS_REGISTERED_CORE"]
startup_timeout_sec = 120

[mcp_servers.node_repl.env]
NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS = "1000"
NODE_REPL_NODE_MODULE_DIRS = 'C:\\Users\\chenm\\AppData\\Local\\OpenAI\\Codex\\runtimes\\cua_node\\78fb63cda1a9e2b2\\bin\\node_modules'

[marketplaces.openai-bundled]
source_type = "local"
source = '\\\\?\\C:\\Users\\chenm\\.codex\\.tmp\\bundled-marketplaces\\openai-bundled'

[features]
js_repl = false

[windows]
sandbox = "elevated"

[projects.'d:\\data\\t2l\\ai-power\\git\\genex-desktop']
trust_level = "trusted"

[desktop]
followUpQueueMode = "queue"
open-link-in-target-preference = "in-app-browser"

[shell_environment_policy.set]
NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S = "aa6d8ffe273c2a7b1b20105a35ae49f69bdb4f025640807a31bcb47f8b67b92b"

[plugins."visualize@openai-bundled"]
enabled = true

[plugins."computer-use@openai-bundled"]
enabled = true
`;

/** A codex home holding `config.toml` (when not null) and `auth.json` (when not null). */
async function codexHome(config: string | null, auth: unknown = null): Promise<string> {
  const home = await tmpDir("studio-ccswitch-");
  await mkdir(home, { recursive: true });
  if (config !== null) await writeFile(path.join(home, "config.toml"), config, "utf8");
  if (auth !== null) await writeFile(path.join(home, "auth.json"), JSON.stringify(auth), "utf8");
  return home;
}

const read = (home: string, env: Record<string, string | undefined> = {}) => readCcswitchConfig(home, env);

/** A provider as the engine will hold it after reading: no token fields, no key. */
const PROVIDER: CcswitchProvider = {
  id: "custom",
  name: "My Codex",
  baseUrl: "https://relay.example.test/v1",
  wireApi: "responses",
  envKey: null,
  model: "gpt-6-astra",
};

describe("cc-switch config reading", () => {
  it("reads the provider cc-switch selected, with the key from auth.json", async () => {
    const home = await codexHome(REAL_SHAPE, { OPENAI_API_KEY: "sk-upx2ndvhqlo2QFBmNNW3P03QkUPNC285lgPMHQ1vlUsOlSQW" });
    const config = await read(home);
    assert.equal(config.kind, "provider");
    if (config.kind !== "provider") return;
    assert.deepEqual(config.provider, PROVIDER);
    assert.equal(config.key, "sk-upx2ndvhqlo2QFBmNNW3P03QkUPNC285lgPMHQ1vlUsOlSQW");
  });

  it("ignores every table the file carries besides the selected provider", async () => {
    // mcp_servers, plugins, marketplaces, projects, features, windows, desktop and
    // shell_environment_policy all live in the real file; none of them may disturb the read.
    const home = await codexHome(REAL_SHAPE, { OPENAI_API_KEY: "sk-test" });
    const config = await read(home);
    assert.equal(config.kind, "provider");
    if (config.kind !== "provider") return;
    assert.equal(config.provider.id, "custom");
    assert.equal(config.provider.baseUrl, "https://relay.example.test/v1");
    assert.equal(config.key, "sk-test");
  });

  it("no config.toml is no cc-switch, not a broken one", async () => {
    const home = await codexHome(null);
    const config = await read(home);
    assert.deepEqual(config, { kind: "none", reason: CcswitchAbsence.NoFile });
  });

  it("an empty config.toml selects no provider", async () => {
    const home = await codexHome("");
    const config = await read(home);
    assert.deepEqual(config, { kind: "none", reason: CcswitchAbsence.NoProvider });
  });

  it("a config.toml with providers but no selection", async () => {
    const home = await codexHome(`model = "gpt-6-astra"
[model_providers.custom]
base_url = "https://relay.example.test/v1"
`);
    const config = await read(home);
    assert.deepEqual(config, { kind: "none", reason: CcswitchAbsence.NoProvider });
  });

  it("a selection the file does not define", async () => {
    const home = await codexHome(`model_provider = "missing"
[model_providers.custom]
base_url = "https://relay.example.test/v1"
`);
    const config = await read(home);
    assert.deepEqual(config, { kind: "none", reason: CcswitchAbsence.NoProvider });
  });

  it("a provider without a base_url is unreadable, not a default", async () => {
    const home = await codexHome(`model_provider = "custom"
[model_providers.custom]
name = "No address"
wire_api = "responses"
`);
    const config = await read(home);
    assert.deepEqual(config, { kind: "none", reason: CcswitchAbsence.Unreadable });
  });

  it("a base_url that is not http(s) is refused", async () => {
    for (const url of ["ftp://api.example/v1", "file:///etc/passwd", "javascript:alert(1)", "api.example/v1", "  "]) {
      const home = await codexHome(`model_provider = "custom"
[model_providers.custom]
base_url = "${url}"
`);
      const config = await read(home);
      assert.deepEqual(config, { kind: "none", reason: CcswitchAbsence.Unreadable }, url);
    }
  });

  it("a quoted provider id with a dot is refused: -c cannot spell it", async () => {
    // `-c model_provider=my.provider` would name the table `model_providers.my`, not `my.provider`.
    const home = await codexHome(`model_provider = "my.provider"
[model_providers."my.provider"]
base_url = "https://api.example/v1"
`);
    const config = await read(home);
    assert.deepEqual(config, { kind: "none", reason: CcswitchAbsence.Unreadable });
  });

  it("a key line with no value", async () => {
    const home = await codexHome(`model_provider =
[model_providers.custom]
base_url = "https://api.example/v1"
`);
    const config = await read(home);
    assert.deepEqual(config, { kind: "none", reason: CcswitchAbsence.Unreadable });
  });

  it("a non-string selection", async () => {
    const home = await codexHome(`model_provider = 42
[model_providers.custom]
base_url = "https://api.example/v1"
`);
    const config = await read(home);
    assert.deepEqual(config, { kind: "none", reason: CcswitchAbsence.Unreadable });
  });

  it("a wire_api nobody speaks is not guessed at", async () => {
    const home = await codexHome(`model_provider = "custom"
[model_providers.custom]
base_url = "https://api.example/v1"
wire_api = "grpc"
`);
    const config = await read(home);
    assert.deepEqual(config, { kind: "none", reason: CcswitchAbsence.Unreadable });
  });

  it("binary garbage is unreadable", async () => {
    const home = await tmpDir("studio-ccswitch-");
    await mkdir(home, { recursive: true });
    await writeFile(path.join(home, "config.toml"), Buffer.from([0x00, 0xff, 0xfe, 0x00, 0x80, 0x7f]));
    const config = await read(home);
    assert.deepEqual(config, { kind: "none", reason: CcswitchAbsence.Unreadable });
  });

  it("an oversized config.toml is refused, not slurped", async () => {
    const home = await codexHome(`model_provider = "custom"\n${"# padding ".repeat(200_000)}\n`);
    const config = await read(home);
    assert.deepEqual(config, { kind: "none", reason: CcswitchAbsence.Unreadable });
  });

  it("comments, blank lines, CRLF and a BOM", async () => {
    const home = await codexHome(
      '\uFEFF# cc-switch wrote this\r\nmodel_provider = "custom"\r\n\r\n[model_providers.custom]\r\nbase_url = "https://relay.example.test/v1"\r\n# trailing comment\r\n',
      { OPENAI_API_KEY: "sk-test" },
    );
    const config = await read(home);
    assert.equal(config.kind, "provider");
    if (config.kind !== "provider") return;
    assert.equal(config.provider.baseUrl, "https://relay.example.test/v1");
  });

  it("escaped quotes in a basic string, and a literal string that keeps its backslashes", async () => {
    const home = await codexHome(
      String.raw`model_provider = "custom"
[model_providers.custom]
base_url = "https://relay.example.test/v1"
name = "My \"Codex\" Studio"
note = 'C:\Users\chenm\.codex stays one path'
`,
      { OPENAI_API_KEY: "sk-test" },
    );
    const config = await read(home);
    assert.equal(config.kind, "provider");
    if (config.kind !== "provider") return;
    assert.equal(config.provider.name, 'My "Codex" Studio');
  });

  it("a dotted key writes the provider table", async () => {
    const home = await codexHome(
      `model_provider = "custom"
model_providers.custom.base_url = "https://relay.example.test/v1"
model_providers.custom.wire_api = "chat"
`,
      { OPENAI_API_KEY: "sk-test" },
    );
    const config = await read(home);
    assert.equal(config.kind, "provider");
    if (config.kind !== "provider") return;
    assert.equal(config.provider.baseUrl, "https://relay.example.test/v1");
    assert.equal(config.provider.wireApi, "chat");
  });

  it("arrays of tables are ignored whole", async () => {
    const home = await codexHome(
      `model_provider = "custom"
[[model_providers.archive]]
base_url = "https://old.example/v1"
name = "an old relay"
[model_providers.custom]
base_url = "https://relay.example.test/v1"
`,
      { OPENAI_API_KEY: "sk-test" },
    );
    const config = await read(home);
    assert.equal(config.kind, "provider");
    if (config.kind !== "provider") return;
    assert.equal(config.provider.baseUrl, "https://relay.example.test/v1");
    assert.equal(config.provider.name, null);
  });

  it("a multiline string is one value, not a table header and a comment", async () => {
    const home = await codexHome(
      `model_provider = "custom"
[model_providers.custom]
base_url = "https://relay.example.test/v1"
name = """line one
line two # not a comment
[not a table]"""
`,
      { OPENAI_API_KEY: "sk-test" },
    );
    const config = await read(home);
    assert.equal(config.kind, "provider");
    if (config.kind !== "provider") return;
    assert.equal(config.provider.name, "line one\nline two # not a comment\n[not a table]");
  });

  it("a duplicated provider table keeps the last definition", async () => {
    const home = await codexHome(
      `model_provider = "custom"
[model_providers.custom]
base_url = "https://first.example/v1"
[model_providers.custom]
base_url = "https://second.example/v1"
`,
      { OPENAI_API_KEY: "sk-test" },
    );
    const config = await read(home);
    assert.equal(config.kind, "provider");
    if (config.kind !== "provider") return;
    assert.equal(config.provider.baseUrl, "https://second.example/v1");
  });
});

describe("cc-switch key resolution", () => {
  const withKey = async (providerTable: string, auth: unknown = null, env: Record<string, string | undefined> = {}) =>
    read(await codexHome(`model_provider = "custom"\n${providerTable}`, auth), env);

  it("an inline bearer token is the key", async () => {
    const config = await withKey(
      `[model_providers.custom]\nbase_url = "https://relay.example.test/v1"\nexperimental_bearer_token = "sk-inline"\n`,
    );
    assert.equal(config.kind, "provider");
    if (config.kind !== "provider") return;
    assert.equal(config.key, "sk-inline");
  });

  it("the env_key's variable, read from the environment Genex was given", async () => {
    const config = await withKey(
      `[model_providers.custom]\nbase_url = "https://relay.example.test/v1"\nenv_key = "MY_RELAY_KEY"\n`,
      null,
      { MY_RELAY_KEY: "sk-from-env" },
    );
    assert.equal(config.kind, "provider");
    if (config.kind !== "provider") return;
    assert.equal(config.key, "sk-from-env");
  });

  it("an env_key whose variable is not set leaves no key", async () => {
    const config = await withKey(
      `[model_providers.custom]\nbase_url = "https://relay.example.test/v1"\nenv_key = "MY_RELAY_KEY"\n`,
      { OPENAI_API_KEY: "sk-auth" },
      {},
    );
    assert.deepEqual(config, { kind: "none", reason: CcswitchAbsence.NoKey });
  });

  it("auth.json's OPENAI_API_KEY", async () => {
    const config = await withKey(`[model_providers.custom]\nbase_url = "https://relay.example.test/v1"\n`, {
      OPENAI_API_KEY: "sk-auth",
    });
    assert.equal(config.kind, "provider");
    if (config.kind !== "provider") return;
    assert.equal(config.key, "sk-auth");
  });

  it("a header's bearer", async () => {
    const config = await withKey(`[model_providers.custom]
base_url = "https://relay.example.test/v1"
[model_providers.custom.headers]
authorization = "Bearer test-header"
`);
    assert.equal(config.kind, "provider");
    if (config.kind !== "provider") return;
    assert.equal(config.key, "test-header");
  });

  it("an inline bearer beats the env_key, the env_key beats auth.json, auth.json beats the header", async () => {
    const table = `[model_providers.custom]
base_url = "https://relay.example.test/v1"
experimental_bearer_token = "sk-inline"
env_key = "MY_RELAY_KEY"
[model_providers.custom.headers]
authorization = "Bearer test-header"
`;
    const all = await withKey(table, { OPENAI_API_KEY: "sk-auth" }, { MY_RELAY_KEY: "sk-env" });
    assert.equal(all.kind, "provider");
    if (all.kind !== "provider") return;
    assert.equal(all.key, "sk-inline");

    const noInline = await withKey(
      `[model_providers.custom]\nbase_url = "https://relay.example.test/v1"\nenv_key = "MY_RELAY_KEY"\n[model_providers.custom.headers]\nauthorization = "Bearer test-header"\n`,
      { OPENAI_API_KEY: "sk-auth" },
      { MY_RELAY_KEY: "sk-env" },
    );
    assert.equal(noInline.kind, "provider");
    if (noInline.kind !== "provider") return;
    assert.equal(noInline.key, "sk-env");

    const noEnv = await withKey(
      `[model_providers.custom]\nbase_url = "https://relay.example.test/v1"\n[model_providers.custom.headers]\nauthorization = "Bearer test-header"\n`,
      { OPENAI_API_KEY: "sk-auth" },
    );
    assert.equal(noEnv.kind, "provider");
    if (noEnv.kind !== "provider") return;
    assert.equal(noEnv.key, "sk-auth");
  });

  it("an empty token is no token: the next source answers", async () => {
    const config = await withKey(
      `[model_providers.custom]\nbase_url = "https://relay.example.test/v1"\nexperimental_bearer_token = ""\nenv_key = "MY_RELAY_KEY"\n`,
      null,
      { MY_RELAY_KEY: "sk-from-env" },
    );
    assert.equal(config.kind, "provider");
    if (config.kind !== "provider") return;
    assert.equal(config.key, "sk-from-env");
  });

  it("no key anywhere is its own answer, distinct from no provider", async () => {
    const config = await withKey(`[model_providers.custom]\nbase_url = "https://relay.example.test/v1"\n`);
    assert.deepEqual(config, { kind: "none", reason: CcswitchAbsence.NoKey });
  });

  it("a broken auth.json is no key, not a crash", async () => {
    const home = await tmpDir("studio-ccswitch-");
    await mkdir(home, { recursive: true });
    await writeFile(
      path.join(home, "config.toml"),
      `model_provider = "custom"\n[model_providers.custom]\nbase_url = "https://relay.example.test/v1"\n`,
    );
    await writeFile(path.join(home, "auth.json"), "{ not json");
    const config = await read(home);
    assert.deepEqual(config, { kind: "none", reason: CcswitchAbsence.NoKey });
  });
});

describe("the launch the provider is handed", () => {
  it("the provider travels as CLI overrides, never as a file the CLI would have to read", async () => {
    assert.deepEqual(ccswitchProviderArgs(PROVIDER), [
      "-c",
      "model_provider=custom",
      "-c",
      'model_providers.custom.name="My Codex"',
      "-c",
      "model_providers.custom.base_url=https://relay.example.test/v1",
      "-c",
      "model_providers.custom.wire_api=responses",
      "-c",
      `model_providers.custom.env_key=${PROVIDER_KEY_ENV}`,
      "-c",
      "model_providers.custom.requires_openai_auth=false",
    ]);
  });

  it("a provider without a name falls back to its id: the CLI refuses an empty one", () => {
    // `--ignore-user-config` means the name can only arrive as this override; an empty value is
    // the CLI's `provider name must not be empty`, which fails the whole turn.
    const args = ccswitchProviderArgs({ ...PROVIDER, name: null });
    assert.ok(args.includes('model_providers.custom.name="custom"'));
  });

  it("chat wire api is passed through", async () => {
    const args = ccswitchProviderArgs({ ...PROVIDER, wireApi: "chat" });
    assert.ok(args.includes("model_providers.custom.wire_api=chat"));
  });

  it("requires_openai_auth is forced off, whatever cc-switch wrote", async () => {
    // The selected provider on this Mac carries requires_openai_auth = true (cc-switch writes
    // it for relays). Genex supplies the key itself, through its own env var: the CLI must not
    // demand a ChatGPT login the isolated home does not have.
    const home = await codexHome(REAL_SHAPE, { OPENAI_API_KEY: "sk-upx2" });
    const config = await read(home);
    assert.equal(config.kind, "provider");
    if (config.kind !== "provider") return;
    const args = ccswitchProviderArgs(config.provider);
    assert.ok(args.includes("model_providers.custom.requires_openai_auth=false"));
    assert.ok(!args.includes("model_providers.custom.requires_openai_auth=true"));
  });

  it("the key is in the environment, never in the argv", async () => {
    const home = await codexHome(
      `model_provider = "custom"\n[model_providers.custom]\nbase_url = "https://relay.example.test/v1"\nexperimental_bearer_token = "test-inline-secret"\n`,
    );
    const config = await read(home);
    assert.equal(config.kind, "provider");
    if (config.kind !== "provider") return;
    const args = ccswitchProviderArgs(config.provider);
    assert.ok(!args.some((arg) => arg.includes("test-inline-secret")), JSON.stringify(args));
    assert.ok(!args.some((arg) => arg.includes("GENEX_CODEX_PROVIDER_KEY=sk")), "the env var is a name, not a value");
    assert.deepEqual(ccswitchLaunchEnv(config.key ?? ""), { [PROVIDER_KEY_ENV]: "test-inline-secret" });
  });

  it("a trailing slash on the base_url is taken off", async () => {
    const home = await codexHome(
      `model_provider = "custom"\n[model_providers.custom]\nbase_url = "https://relay.example.test/v1/"\n`,
      { OPENAI_API_KEY: "sk-test" },
    );
    const config = await read(home);
    assert.equal(config.kind, "provider");
    if (config.kind !== "provider") return;
    assert.equal(config.provider.baseUrl, "https://relay.example.test/v1");
  });
});

describe("cc-switch connection settings", () => {
  it("remembers the cc-switch connection and forgets it back to the subscription", async () => {
    const home = await tmpDir("studio-ccswitch-");
    await mkdir(home, { recursive: true });
    const settings = ccswitchConnectionSettings(path.join(home, "ccswitch.json"));
    assert.equal(await settings.read(), CodexConnection.Subscription);
    await settings.write(CodexConnection.Ccswitch);
    assert.equal(await settings.read(), CodexConnection.Ccswitch);
    await settings.write(CodexConnection.Subscription);
    assert.equal(await settings.read(), CodexConnection.Subscription);
  });

  it("a file that is not a connection is the subscription, never a crash", async () => {
    const home = await tmpDir("studio-ccswitch-");
    await mkdir(home, { recursive: true });
    const file = path.join(home, "ccswitch.json");
    await writeFile(file, "{ not json");
    assert.equal(await ccswitchConnectionSettings(file).read(), CodexConnection.Subscription);
    await writeFile(file, JSON.stringify({ mode: "something-else" }));
    assert.equal(await ccswitchConnectionSettings(file).read(), CodexConnection.Subscription);
  });
});

describe("cc-switch model discovery", () => {
  /** Run `fn` with `fetch` answering `answer`; the calls it saw are handed back. */
  async function withFetch(answer: () => Response | Promise<Response>, fn: () => Promise<void>) {
    const original = globalThis.fetch;
    const seen: Array<{ url: string; authorization: string | null }> = [];
    globalThis.fetch = async (input, init) => {
      seen.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
      return answer();
    };
    try {
      await fn();
    } finally {
      globalThis.fetch = original;
    }
    return seen;
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("the provider's /models becomes the picker's rows", async () => {
    const seen = await withFetch(
      () => json({ data: [{ id: "gpt-6-astra" }, { id: "gpt-5.6-sol" }] }),
      async () => {
        const models = await ccswitchModels(PROVIDER, "sk-test");
        assert.deepEqual(
          models.map((m) => m.id),
          ["gpt-6-astra", "gpt-5.6-sol"],
        );
        assert.equal(models[0]?.contextSource, "unknown");
        assert.equal(models[0]?.supportsTools, true);
      },
    );
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.url, "https://relay.example.test/v1/models");
    assert.equal(seen[0]?.authorization, "Bearer sk-test");
  });

  it("a keyless discovery carries no authorization, and an empty list keeps the config model", async () => {
    // A server that answers its (empty) model list is a working server: the config model stays.
    const seen = await withFetch(
      () => json({ data: [] }),
      async () => {
        const models = await ccswitchModels(PROVIDER, null);
        assert.deepEqual(
          models.map((m) => m.id),
          ["gpt-6-astra"],
        );
      },
    );
    assert.equal(seen[0]?.authorization, null);
  });

  it("a provider that does not answer leaves the config model as the one row", async () => {
    await withFetch(
      () => {
        throw new Error("ECONNREFUSED");
      },
      async () => {
        const models = await ccswitchModels(PROVIDER, "sk-test");
        assert.deepEqual(
          models.map((m) => m.id),
          ["gpt-6-astra"],
        );
        assert.equal(models[0]?.note, "Context size not reported");
      },
    );
  });

  it("a provider that asks for a key leaves no rows at all", async () => {
    await withFetch(
      () => json({ error: "invalid key" }, 401),
      async () => {
        // Even with a config model to fall back on: a picker must not offer what the launch fails on.
        assert.deepEqual(await ccswitchModels(PROVIDER, "sk-wrong"), []);
      },
    );
  });

  it("a provider that answers but is not OpenAI-shaped leaves no rows", async () => {
    await withFetch(
      () => new Response("<html>hi</html>", { headers: { "content-type": "text/html" } }),
      async () => {
        assert.deepEqual(await ccswitchModels(PROVIDER, "sk-test"), []);
      },
    );
  });

  it("no rows and no config model is an empty list, not a throw", async () => {
    await withFetch(
      () => {
        throw new Error("ECONNREFUSED");
      },
      async () => {
        assert.deepEqual(await ccswitchModels({ ...PROVIDER, model: null }, null), []);
      },
    );
  });
});

describe("the codex connection vocabulary", () => {
  it("names the two ways the Codex row connects", () => {
    assert.equal(CodexConnection.Subscription, "subscription");
    assert.equal(CodexConnection.Ccswitch, "ccswitch");
  });
});
