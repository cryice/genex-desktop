/** Engines and local models: what is available, re-checking sign-ins, and downloading or deleting a model. */
import { modelProgress } from "../model-progress.ts";
import { SUBSCRIPTION_ENGINES, type StudioCore } from "../studio-core.ts";
import { type ModelPullProgress, UiEvent } from "../../shared/ui-events.ts";
import type { ProviderUsageReport } from "../../shared/provider-usage.ts";
import { isBonsaiModelId } from "../../substrate/bonsai/manifest.ts";
import { BonsaiEngine } from "../../substrate/engines/bonsai.ts";
import { LocalServerEngine } from "../../substrate/engines/local-server.ts";
import { detectHardware, fitFor } from "../../substrate/hardware.ts";
import { lookupOllamaModel } from "../../substrate/ollama-registry.ts";
import { hardwareReport } from "../core/hardware-report.ts";
import type { SubscriptionEngine } from "../login-controllers.ts";
import type { OpenRouterLogin } from "../openrouter-login.ts";
import type { IpcHandle } from "./registrar.ts";
import { errorMessage } from "../../shared/errors.ts";
import { EngineId } from "../../shared/providers.ts";
import { CodexConnection } from "../../shared/codex-connection.ts";
import { type EngineStatus, EngineStatusCode } from "../../shared/engine-descriptor.ts";

/** The engines whose model list Settings may ask to refresh. */
const REFRESHABLE: ReadonlySet<string> = new Set([
  EngineId.ClaudeCode,
  EngineId.Codex,
  EngineId.OpenCode,
  EngineId.OpenRouter,
  EngineId.DeepSeek,
  EngineId.InLink,
  EngineId.LocalServer,
]);
/** The engines with no subscription sign-in: a recheck reads their models (and status) again. */
const RECHECKED_BY_MODELS: readonly string[] = [
  EngineId.OpenCode,
  EngineId.OpenRouter,
  EngineId.DeepSeek,
  EngineId.InLink,
  EngineId.LocalServer,
];

/** An engine whose API key is pasted in Settings (OpenRouter, DeepSeek, inLink). */
interface ApiKeyEngine {
  saveKey(value: unknown): Promise<EngineStatus>;
  clearKey(): Promise<EngineStatus>;
}

const isApiKeyEngine = (engine: unknown): engine is ApiKeyEngine =>
  typeof (engine as Partial<ApiKeyEngine> | null)?.saveKey === "function" &&
  typeof (engine as Partial<ApiKeyEngine> | null)?.clearKey === "function";

/** The managed Bonsai runtime, or null when Bonsai is absent or is not the managed engine. */
function bonsaiRuntime(engines: StudioCore["engines"]): BonsaiEngine["runtime"] | null {
  const engine = engines.has(EngineId.Bonsai) ? engines.get(EngineId.Bonsai) : null;
  return engine instanceof BonsaiEngine ? engine.runtime : null;
}

/** Why a local model request from the renderer is refused. */
const MESSAGE = {
  unknownProvider: "Unknown coding provider",
  noKeyEngine: "OpenRouter is unavailable",
  noDeepSeekEngine: "DeepSeek is unavailable",
  noInLinkEngine: "inLink is unavailable",
  noLocalServer: "Local servers are unavailable",
  bonsaiUnavailable: "Bonsai runtime is unavailable",
  noModel: "Name the model to delete",
  cannotRemove: "This model cannot be deleted here",
} as const;

export interface ModelsIpcDeps {
  core: Pick<StudioCore, "engines" | "setCodexConnection">;
  subscription(id: string): SubscriptionEngine | null;
  pushUiEvent(event: UiEvent): void;
  /** OpenRouter's browser sign-in, which hands the key it gets to the engine. */
  openRouterLogin: OpenRouterLogin;
}

export function registerModelsIpc(
  handle: IpcHandle,
  { core, subscription, pushUiEvent, openRouterLogin }: ModelsIpcDeps,
): void {
  handle("studio:engines", async () => core.engines.describe());
  // The Codex row's connection (Settings' switcher): the subscription, or a provider cc-switch
  // manages. Anything but the cc-switch mode is the subscription: the default, never a lock.
  handle("studio:codex.connection.set", async (payload) =>
    core.setCodexConnection(
      payload?.mode === CodexConnection.Ccswitch ? CodexConnection.Ccswitch : CodexConnection.Subscription,
    ),
  );
  handle("studio:models.refresh", async (payload) => {
    const provider = payload?.provider;
    if (typeof provider !== "string" || !REFRESHABLE.has(provider) || !core.engines.has(provider))
      throw new Error(MESSAGE.unknownProvider);
    await core.engines.get(provider).refreshModels?.(true);
    return true;
  });
  registerApiKeyIpc(handle, { core, pushUiEvent, openRouterLogin });
  registerDeepSeekKeyIpc(handle, { core, pushUiEvent });
  registerInLinkKeyIpc(handle, { core, pushUiEvent });
  registerLocalServerIpc(handle, { core, pushUiEvent });
  // The composer's plan limits: every signed-in subscription, read without starting a turn.
  handle("studio:provider-usage", async () => {
    const reports = await Promise.all(
      SUBSCRIPTION_ENGINES.map(async (id): Promise<ProviderUsageReport | null> => {
        if (!core.engines.has(id)) return null;
        const engine = core.engines.get(id);
        if ((await engine.status().catch(() => null))?.code !== EngineStatusCode.Ready) return null;
        return { engine: id, usage: (await engine.readUsage?.().catch(() => null)) ?? null };
      }),
    );
    return reports.filter((report): report is ProviderUsageReport => report !== null);
  });
  handle("studio:hardware", async () => hardwareReport());
  handle("studio:engines.recheck", async (payload) => {
    const ids = payload?.engine ? [payload.engine] : [...SUBSCRIPTION_ENGINES, ...RECHECKED_BY_MODELS];
    for (const id of ids) {
      const engine = subscription(id);
      if (engine) await engine.recheckLogin();
      else if (RECHECKED_BY_MODELS.includes(id) && core.engines.has(id))
        await core.engines
          .get(id)
          .refreshModels?.(true)
          .catch(() => {});
    }
    pushUiEvent({ type: UiEvent.EnginesChanged, payload: {} });
    return true;
  });

  handle("studio:model-install.status", async () => bonsaiRuntime(core.engines)?.installStatus() ?? null);
  handle("studio:cancel-model-download", async () => {
    bonsaiRuntime(core.engines)?.cancelInstall();
    return true;
  });
  // Add from Ollama: size one exact tag from the public registry, then judge it with the same fit rule.
  handle("studio:models.lookup", async (payload) => {
    const found = await lookupOllamaModel(String(payload?.model ?? ""));
    return found.ok ? { ...found, ...fitFor(found.sizeGb, await detectHardware()) } : found;
  });
  // Delete: Bonsai ids go to the managed runtime, every other name to Ollama, which lists what it has.
  handle("studio:models.remove", async (payload) => {
    const model = payload?.model;
    if (typeof model !== "string" || !model) throw new Error(MESSAGE.noModel);
    const id = isBonsaiModelId(model) ? EngineId.Bonsai : EngineId.Ollama;
    const engine = core.engines.has(id) ? core.engines.get(id) : null;
    if (!engine?.removeModel) throw new Error(MESSAGE.cannotRemove);
    await engine.removeModel(model);
    pushUiEvent({ type: UiEvent.EnginesChanged, payload: { engine: id } });
    return true;
  });
  handle("studio:pull-model", async (payload) => {
    const progressUpdates = modelProgress((progress) =>
      pushUiEvent({ type: UiEvent.ModelPull, payload: { model: payload.model, progress } }),
    );
    if (isBonsaiModelId(payload.model)) {
      const engine = core.engines.get(EngineId.Bonsai);
      if (!(engine instanceof BonsaiEngine)) throw new Error(MESSAGE.bonsaiUnavailable);
      const unsubscribe = engine.runtime.onInstall((job) => pushUiEvent({ type: UiEvent.ModelInstall, payload: job }));
      try {
        await engine.runtime.install(payload.model, progressUpdates.update);
        progressUpdates.flush();
        pushUiEvent({ type: UiEvent.EnginesChanged, payload: { engine: EngineId.Bonsai } });
        return true;
      } catch (err) {
        progressUpdates.flush();
        pushUiEvent({
          type: UiEvent.ModelPull,
          payload: { model: payload.model, progress: { status: "error", error: errorMessage(err) } },
        });
        throw err;
      } finally {
        unsubscribe();
      }
    }
    const engine = core.engines.get(EngineId.Ollama) as unknown as {
      client: { pull: (m: string) => AsyncGenerator<ModelPullProgress> };
    };
    try {
      for await (const progress of engine.client.pull(payload.model)) progressUpdates.update(progress);
    } finally {
      progressUpdates.flush();
    }
    return true;
  });
}

/** The engine that holds a pasted key, or a failure naming the provider as unavailable. */
function pastedKeyEngine(core: ModelsIpcDeps["core"], id: string, unavailable: string): ApiKeyEngine {
  const engine = core.engines.has(id) ? core.engines.get(id) : null;
  if (!isApiKeyEngine(engine)) throw new Error(unavailable);
  return engine;
}

/**
 * The OpenRouter key, pasted or got by the browser sign-in: checked with OpenRouter, kept in the OS
 * secret store, never sent back.
 */
function registerApiKeyIpc(
  handle: IpcHandle,
  { core, pushUiEvent, openRouterLogin }: Pick<ModelsIpcDeps, "core" | "pushUiEvent" | "openRouterLogin">,
): void {
  const keyEngine = (): ApiKeyEngine => pastedKeyEngine(core, EngineId.OpenRouter, MESSAGE.noKeyEngine);
  handle("studio:openrouter.key.save", async (payload) => {
    const status = await keyEngine().saveKey(payload?.key);
    pushUiEvent({ type: UiEvent.EnginesChanged, payload: { engine: EngineId.OpenRouter } });
    return status;
  });
  handle("studio:openrouter.key.clear", async () => {
    const status = await keyEngine().clearKey();
    pushUiEvent({ type: UiEvent.EnginesChanged, payload: { engine: EngineId.OpenRouter } });
    return status;
  });
  handle("studio:openrouter.signin", async () => {
    const engine = keyEngine();
    const result = await openRouterLogin.start((key) => engine.saveKey(key));
    pushUiEvent({ type: UiEvent.EnginesChanged, payload: { engine: EngineId.OpenRouter } });
    return result;
  });
  handle("studio:openrouter.signin.reopen", async () => openRouterLogin.reopen());
  handle("studio:openrouter.signin.cancel", async () => openRouterLogin.cancel());
}

/**
 * The DeepSeek key, pasted in Settings: checked with DeepSeek, kept in the OS secret store, never
 * sent back. DeepSeek has no browser sign-in, so there are only these two channels.
 */
function registerDeepSeekKeyIpc(
  handle: IpcHandle,
  { core, pushUiEvent }: Pick<ModelsIpcDeps, "core" | "pushUiEvent">,
): void {
  const keyEngine = (): ApiKeyEngine => pastedKeyEngine(core, EngineId.DeepSeek, MESSAGE.noDeepSeekEngine);
  handle("studio:deepseek.key.save", async (payload) => {
    const status = await keyEngine().saveKey(payload?.key);
    pushUiEvent({ type: UiEvent.EnginesChanged, payload: { engine: EngineId.DeepSeek } });
    return status;
  });
  handle("studio:deepseek.key.clear", async () => {
    const status = await keyEngine().clearKey();
    pushUiEvent({ type: UiEvent.EnginesChanged, payload: { engine: EngineId.DeepSeek } });
    return status;
  });
}

/**
 * The inLink key, pasted in Settings: checked with the gateway, kept in the OS secret store, never
 * sent back. The gateway has no browser sign-in, so there are only these two channels.
 */
function registerInLinkKeyIpc(
  handle: IpcHandle,
  { core, pushUiEvent }: Pick<ModelsIpcDeps, "core" | "pushUiEvent">,
): void {
  const keyEngine = (): ApiKeyEngine => pastedKeyEngine(core, EngineId.InLink, MESSAGE.noInLinkEngine);
  handle("studio:inlink.key.save", async (payload) => {
    const status = await keyEngine().saveKey(payload?.key);
    pushUiEvent({ type: UiEvent.EnginesChanged, payload: { engine: EngineId.InLink } });
    return status;
  });
  handle("studio:inlink.key.clear", async () => {
    const status = await keyEngine().clearKey();
    pushUiEvent({ type: UiEvent.EnginesChanged, payload: { engine: EngineId.InLink } });
    return status;
  });
}

/**
 * The person's own model server: connect it (its address checked as local, its key kept in the OS
 * secret store, neither saved unless the server answers), forget it, or find one on this computer.
 */
function registerLocalServerIpc(
  handle: IpcHandle,
  { core, pushUiEvent }: Pick<ModelsIpcDeps, "core" | "pushUiEvent">,
): void {
  const localServer = (): LocalServerEngine => {
    const engine = core.engines.has(EngineId.LocalServer) ? core.engines.get(EngineId.LocalServer) : null;
    if (!(engine instanceof LocalServerEngine)) throw new Error(MESSAGE.noLocalServer);
    return engine;
  };
  const changed = (): void => pushUiEvent({ type: UiEvent.EnginesChanged, payload: { engine: EngineId.LocalServer } });
  handle("studio:local-server.connect", async (payload) => {
    const result = await localServer().connect({ url: payload?.url, key: payload?.key });
    if (result.ok) changed();
    return result;
  });
  handle("studio:local-server.forget", async () => {
    const status = await localServer().forget();
    changed();
    return status;
  });
  handle("studio:local-server.find", async () => localServer().find());
}
